/* eslint-env serviceworker */
// Golden Store — Firebase Cloud Messaging service worker (Web Push).
//
// Handles background delivery of Web Push notifications: data-only FCM
// messages sent by the Worker (lib/firebase.ts → sendWebPush) arrive here
// through onBackgroundMessage, and clicks are routed back to the matching
// store page.
//
// Uses the Firebase compat SDK v10.12.2 to match the rest of the site.
// NOTE: this file must stay at the site root so its scope is "/".

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

var FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCBG4zQSAeiE5cui3rFVaDEAhwF45EzPQU',
  authDomain: 'golden-store-40dd6.firebaseapp.com',
  projectId: 'golden-store-40dd6',
  storageBucket: 'golden-store-40dd6.firebasestorage.app',
  messagingSenderId: '792594765257',
  appId: '1:792594765257:web:3366da4bc6cb6971ba8418',
};

firebase.initializeApp(FIREBASE_CONFIG);

var messaging = firebase.messaging();

// Resolve targets against the SW's own origin so previews (pages.dev /
// vercel.app) behave the same as production (goldenstore.online).
var SITE_ORIGIN = self.location.origin;
var SITE_HOME = SITE_ORIGIN + '/';
var FALLBACK_ICON = SITE_ORIGIN + '/images/logo.png';

function notificationTargetUrl(data) {
  // Advanced push: honour data.click_url but keep it on our own origin so a
  // malicious payload can never turn a notification into an open redirect.
  var raw = String((data && data.click_url) || '');
  if (raw) {
    if (raw.charAt(0) === '/' && raw.charAt(1) !== '/') return SITE_ORIGIN + raw;
    try {
      var u = new URL(raw, SITE_ORIGIN);
      if (u.origin === SITE_ORIGIN) return u.toString();
    } catch (e) {}
  }
  var slug = String((data && data.app_slug) || '');
  if (slug) return SITE_HOME + 'app?slug=' + encodeURIComponent(slug);
  return SITE_HOME;
}

// Background messages: the tab is closed or not focused. The Worker sends
// data-only messages (title/body live inside `data`) so this handler fully
// controls how the notification looks and where the click leads.
messaging.onBackgroundMessage(function (payload) {
  var data = (payload && payload.data) || {};
  var title = String(data.title || 'Golden Store');
  var nid = String(data.notification_id || '');
  // One OS notification per published notification, even if an upstream
  // retry delivers the same FCM message twice. `tag` also makes the OS
  // REPLACE instead of stacking; getNotifications() closes the race where
  // two messages arrive in the same event loop.
  var tag = nid || 'goldenstore-notification';
  var options = {
    body: String(data.body || ''),
    icon: String(data.image || data.store_logo || FALLBACK_ICON),
    badge: FALLBACK_ICON,
    dir: 'rtl',
    lang: 'ar',
    tag: tag,
    renotify: false,
    data: {
      type: String(data.type || ''),
      app_slug: String(data.app_slug || ''),
      notification_id: nid,
      url: notificationTargetUrl(data),
    },
  };

  function alreadyShown() {
    try {
      if (!self.registration.getNotifications) return Promise.resolve(false);
      return self.registration.getNotifications({ tag: tag })
        .then(function (list) { return !!(list && list.length); })
        .catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  return alreadyShown().then(function (shown) {
    if (shown) return undefined;           // duplicate: do NOT display again
    return self.registration.showNotification(title, options).then(function () {
      if (!nid) return;
      try {
        fetch(SITE_ORIGIN + '/api/notifications/receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notification_id: nid, channel: 'web', event: 'displayed' }),
          keepalive: true,
        }).catch(function () {});
      } catch (e) {}
    });
  });
});

// Click handling: focus an already-open store tab (navigating it to the
// target page) or open a new window when the site is not open.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = (event.notification && event.notification.data) || {};
  var targetUrl = String(data.url || SITE_HOME);

  // Advanced push: record the click for the analytics dashboard.
  var notificationId = String(data.notification_id || '');
  if (notificationId) {
    try {
      event.waitUntil(fetch(SITE_ORIGIN + '/api/notifications/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_id: notificationId, channel: 'web', event: 'clicked' }),
        keepalive: true,
      }).catch(function () {}));
    } catch (e) {}
    try {
      event.waitUntil(fetch(SITE_ORIGIN + '/api/notifications/click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_id: notificationId, platform: 'web' }),
        keepalive: true,
      }).catch(function () {}));
    } catch (e) {}
  }

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          var isSameOrigin = false;
          try {
            isSameOrigin = new URL(client.url).origin === SITE_ORIGIN;
          } catch (e) {
            isSameOrigin = false;
          }
          if (isSameOrigin && 'focus' in client) {
            try {
              client.navigate(targetUrl).catch(function () {});
            } catch (e) {}
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(targetUrl);
      })
  );
});
