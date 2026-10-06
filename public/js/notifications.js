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

  // ---------- foreground delivery ----------

  function hookForegroundMessages(messaging) {
    if (_foregroundHooked) return;
    _foregroundHooked = true;
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
    if (permission !== 'granted') return; // denied / unsupported

    var registration = await navigator.serviceWorker.register(SW_URL);

    var messaging = firebase.messaging();
    var token = await messaging.getToken({
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return;

    hookForegroundMessages(messaging);

    // Persist the token on the Worker → Firestore web_tokens/{uid}.
    var idToken = await window.GAuth.getIdToken();
    if (!idToken) return;
    var res = await fetch('/api/notifications/register-web', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + idToken,
      },
      body: JSON.stringify({ token: token }),
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

    window.GAuth.onAuthChange(function (user) {
      if (!user || !user.uid) return;          // signed out → do nothing
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
