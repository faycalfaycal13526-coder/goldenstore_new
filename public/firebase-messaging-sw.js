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
  var options = {
    body: String(data.body || ''),
    icon: String(data.image || data.store_logo || FALLBACK_ICON),
    badge: FALLBACK_ICON,
    dir: 'rtl',
    lang: 'ar',
    tag: String(data.notification_id || 'goldenstore-notification'),
    data: {
      type: String(data.type || ''),
      app_slug: String(data.app_slug || ''),
      notification_id: String(data.notification_id || ''),
      url: notificationTargetUrl(data),
    },
  };
  return self.registration.showNotification(title, options);
});

// Click handling: focus an already-open store tab (navigating it to the
// target page) or open a new window when the site is not open.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = (event.notification && event.notification.data) || {};
  var targetUrl = String(data.url || SITE_HOME);

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
