// Golden Store — Web Push (FCM) registration for the browser storefront.
//
// - Skipped inside the Capacitor/Android app: the native app registers its
//   own FCM device token and receives pushes via the native plugin, so
//   registering a web token there would conflict with Capacitor Push
//   Notifications and cause duplicate notifications.
// - Runs only after the user has signed in (bound to window.GAuth.onAuthChange).
// - Uses the Firebase compat SDK v10.12.2 loaded from CDN in the HTML pages
//   (firebase-app-compat.js + firebase-auth-compat.js + firebase-messaging-compat.js).

(function () {
  'use strict';

  var VAPID_KEY =
    'BNh23c8K3bApuo1UR8J5PuZg08pdmxoJwNMk0-Vet6qkmYEf4DRB3zOiF2VblHMYOEhvoCVGMcAVPk4pb-8G9ZQ';
  var SW_URL = '/firebase-messaging-sw.js';
  var LOGO_URL = '/images/logo.png';

  var _attemptedUid = null;   // uid we already ran registration for (per page)
  var _foregroundHooked = false; // onMessage listener is attached only once

  // ---------- runtime detection ----------

  // True inside the Capacitor Android app (native bridge, Capacitor global on
  // a native platform, or the GoldenStoreApp user agent).
  function isCapacitorApp() {
    try {
      if (typeof window.GSAndroid !== 'undefined') return true;
      if (window.Capacitor) {
        if (typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) return true;
        if (typeof window.Capacitor.getPlatform === 'function' && window.Capacitor.getPlatform() !== 'web') return true;
      }
    } catch (e) {}
    return /GoldenStoreApp/i.test(navigator.userAgent || '');
  }

  function isBrowserWithPushSupport() {
    return (
      'serviceWorker' in navigator &&
      'Notification' in window &&
      typeof window.firebase !== 'undefined' &&
      typeof window.firebase.messaging === 'function'
    );
  }

  // ---------- permission ----------

  function ensureNotificationPermission() {
    if (!('Notification' in window)) return Promise.resolve('unsupported');
    if (Notification.permission === 'granted') return Promise.resolve('granted');
    if (Notification.permission === 'denied') return Promise.resolve('denied');
    try {
      var p = Notification.requestPermission();
      // Older browsers (Safari < 16) return undefined instead of a promise.
      if (p && typeof p.then === 'function') return p;
    } catch (e) {
      // Safari rejects requestPermission() when called without a user gesture.
    }
    return Promise.resolve(Notification.permission || 'default');
  }

  // Browsers (notably Safari) refuse to prompt outside a user gesture. Retry
  // the whole flow on the first click/tap/keypress instead of giving up.
  function retryOnUserGesture(fn) {
    var events = ['click', 'touchend', 'keydown'];
    function handler() {
      events.forEach(function (ev) {
        window.removeEventListener(ev, handler, true);
      });
      fn();
    }
    events.forEach(function (ev) {
      window.addEventListener(ev, handler, { capture: true, passive: true });
    });
  }

  // ---------- permission persistence (Android 13+ / browser) ----------
  // The backend must target opted-in users ONLY. Notification.permission is a
  // device-local fact, so we mirror it into D1 on every page load and on every
  // change. Without this, a user who revokes POST_NOTIFICATIONS still has a
  // stored token and would keep being counted as eligible.
  async function syncPermissionState(permission, enabled) {
    try {
      if (!window.GAuth || typeof window.GAuth.getIdToken !== 'function') return;
      var idToken = await window.GAuth.getIdToken();
      if (!idToken) return;
      await fetch('/api/notifications/preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({
          permission: permission,
          notifications_enabled: enabled,
          platform: 'web',   // never let a browser tab disable the Android device
        }),
        credentials: 'same-origin',
      });
    } catch (e) {
      console.warn('[notifications] permission sync failed:', (e && e.message) || e);
    }
  }

  function currentPermission() {
    try { return Notification.permission || 'default'; } catch (e) { return 'default'; }
  }

  // Chrome/Android exposes a `change` event on the Notifications permission.
  function watchPermissionChanges() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return;
      navigator.permissions.query({ name: 'notifications' }).then(function (status) {
        if (!status || typeof status.addEventListener !== 'function') return;
        status.addEventListener('change', function () {
          var p = currentPermission();
          syncPermissionState(p, p === 'granted', 'web');
          if (p === 'denied') _attemptedUid = null;
        });
      }).catch(function () {});
    } catch (e) {}
  }

  // ---------- foreground delivery ----------

  function hookForegroundMessages(messaging, user) {
    if (_foregroundHooked) return;
    _foregroundHooked = true;
    // FCM can rotate the registration token at any moment (app reinstall,
    // token expiry, clearing data). Re-register the new one immediately.
    try {
      if (typeof messaging.onTokenRefresh === 'function') {
        messaging.onTokenRefresh(function () { registerWebPush(user); });
      }
    } catch (e) {}
    messaging.onMessage(function (payload) {
      try {
        var data = (payload && payload.data) || {};
        var note = (payload && payload.notification) || {};
        var title = String(data.title || note.title || 'Golden Store');
        var body = String(data.body || note.body || '');
        var slug = String(data.app_slug || '');
        // Showing via the service worker keeps a single click handler
        // (notificationclick in firebase-messaging-sw.js) for every case.
        navigator.serviceWorker.ready
          .then(function (reg) {
            return reg.showNotification(title, {
              body: body,
              icon: String(data.image || data.store_logo || LOGO_URL),
              badge: LOGO_URL,
              dir: 'rtl',
              lang: 'ar',
              tag: String(data.notification_id || 'goldenstore-notification'),
              data: {
                type: String(data.type || ''),
                app_slug: slug,
                notification_id: String(data.notification_id || ''),
                url: slug ? '/app?slug=' + encodeURIComponent(slug) : '/',
              },
            });
          })
          .catch(function () {});
      } catch (e) {}
    });
  }

  // ---------- registration ----------

  async function registerWebPush(user) {
    var permission = await ensureNotificationPermission();
    if (permission === 'default') {
      // No prompt was allowed right now (e.g. Safari outside a user gesture) —
      // retry inside the next click/tap/keypress, where prompting is allowed.
      retryOnUserGesture(function () {
        registerWebPush(user).catch(function (err) {
          console.warn('[notifications] permission retry failed:', (err && err.message) || err);
        });
      });
      return;
    }
    if (permission !== 'granted') {
      // Explicit refusal (or unsupported): mark the user as opted-out in D1
      // so the backend never counts this device as eligible.
      if (permission === 'denied') await syncPermissionState('denied', false, 'web');
      return;
    }

    // Mirror the granted permission before attempting to get a token.
    await syncPermissionState('granted', true, 'web');

    var registration = await navigator.serviceWorker.register(SW_URL);

    var messaging = firebase.messaging();
    var token = await messaging.getToken({
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return;

    hookForegroundMessages(messaging, user);

    // Persist the token in D1 web_tokens (the same table sendWebPush reads).
    var idToken = await window.GAuth.getIdToken();
    if (!idToken) return;
    var res = await fetch('/api/notifications/register-web', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + idToken,
      },
      body: JSON.stringify({
        token: token,
        platform: 'web',
        permission: 'granted',
        notifications_enabled: true,
      }),
      credentials: 'same-origin',
    });
    if (!res.ok) {
      console.warn('[notifications] register-web failed:', res.status);
    }
  }

  // ---------- entry point (bound to auth state) ----------

  function start() {
    // Inside the Capacitor app, native push handles notifications — registering
    // a web token there would conflict with the Capacitor Push plugin.
    if (isCapacitorApp()) return;
    if (!isBrowserWithPushSupport()) return;
    if (!window.GAuth || typeof window.GAuth.onAuthChange !== 'function') return;

    watchPermissionChanges();
    // Re-sync every time the app/tab comes back to the foreground, so a
    // permission change made in Android settings is reflected in D1 quickly.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      var p = currentPermission();
      syncPermissionState(p, p === 'granted', 'web');
    });

    window.GAuth.onAuthChange(function (user) {
      if (!user || !user.uid) return;          // signed out → do nothing

      // Always mirror the current OS permission, even when the token is
      // already registered or when the prompt was previously dismissed.
      var p = currentPermission();
      syncPermissionState(p, p === 'granted', 'web');

      if (_attemptedUid === user.uid) return;  // already handled this user
      _attemptedUid = user.uid;
      registerWebPush(user).catch(function (err) {
        console.warn('[notifications] web push registration failed:', (err && err.message) || err);
        _attemptedUid = null; // allow a retry on the next auth event
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
