/* =========================================================================
   Golden Store — UNIFIED Notification Hub (browser + Android WebView)
   -------------------------------------------------------------------------
   One place for everything the client side needs:

   1. A stable installation id (shared with notifications.js and the APK).
   2. `GSNotify.registerNativeToken()` — the APK's FCM device token is
      registered on the SAME canonical device registry as Web Push, using the
      unified /api/notifications/register-device endpoint.
   3. An always-on IN-APP fallback: polls /api/notifications and shows each
      new notification ONCE. This is what makes the Android app receive
      notifications even before its native FCM bridge is updated, and it works
      with no notification permission at all.
   4. Client-side display dedupe shared with the foreground FCM handler
      (gs_notif_shown_v1), so an OS notification + an in-app toast never
      become two identical toasts.
   5. Display/click receipts for real diagnostics.

   Loaded on every store page; no external dependency, no network library.
   ========================================================================= */
(function () {
  'use strict';

  var SEEN_KEY = 'gs_notif_seen_v1';
  var SHOWN_KEY = 'gs_notif_shown_v1';
  var DEVICE_KEY = 'gs_device_id';
  var POLL_MS = 30000;
  var MAX_SEEN = 200;
  var GS = (window.GSNotify = window.GSNotify || {});

  function safeParse(raw, fallback) {
    try { var v = JSON.parse(raw || 'null'); return v && typeof v === 'object' ? v : fallback; }
    catch (e) { return fallback; }
  }
  function read(key, fallback) {
    try { return safeParse(localStorage.getItem(key), fallback); } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function installationId() {
    try {
      var v = localStorage.getItem(DEVICE_KEY);
      if (v) return v;
      v = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
      localStorage.setItem(DEVICE_KEY, v);
      return v;
    } catch (e) { return ''; }
  }

  /* One OS notification + at most ONE in-app toast per published id. */
  function claimShown(id) {
    if (!id) return true;
    var ids = read(SHOWN_KEY, {});
    var cutoff = Date.now() - 24 * 3600 * 1000;
    var fresh = {};
    Object.keys(ids).forEach(function (k) { if (ids[k] > cutoff) fresh[k] = ids[k]; });
    if (fresh[id]) return false;
    fresh[id] = Date.now();
    write(SHOWN_KEY, fresh);
    return true;
  }

  function report(id, event, channel) {
    if (!id) return;
    try {
      fetch('/api/notifications/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notification_id: id,
          channel: channel || 'in_app',
          event: event || 'displayed',
        }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }

  function authToken() {
    try {
      if (window.GAuth && typeof window.GAuth.getIdToken === 'function') {
        return window.GAuth.getIdToken();
      }
    } catch (e) {}
    return Promise.resolve(null);
  }

  /* ------------------------- native FCM bridge ------------------------- */
  var pendingNativeToken = null;
  function registerNativeToken(token, opts) {
    token = String(token || '').trim();
    if (!token) return Promise.resolve({ ok: false, error: 'invalid_token' });
    opts = opts || {};
    pendingNativeToken = { token: token, opts: opts };
    return authToken().then(function (idToken) {
      if (!idToken) return { ok: false, error: 'not_signed_in', queued: true };
      return fetch('/api/notifications/register-device', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + idToken,
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          token: token,
          channel: 'native',
          platform: String(opts.platform || 'android'),
          installation_id: String(opts.installation_id || installationId()),
          permission: String(opts.permission || 'granted'),
          notifications_enabled: opts.notifications_enabled !== false,
        }),
      }).then(function (res) { return res.json().catch(function () { return {}; }); })
        .then(function (data) {
          if (data && data.ok !== false) pendingNativeToken = null;
          report('', 'registered', 'native');
          return data;
        });
    }).catch(function (e) {
      return { ok: false, error: String((e && e.message) || e), queued: true };
    });
  }

  function flushPendingNative() {
    if (!pendingNativeToken) return;
    registerNativeToken(pendingNativeToken.token, pendingNativeToken.opts).catch(function () {});
  }

  /* Capacitor Push Notifications plugin (when the APK includes it). */
  function hookCapacitor() {
    try {
      var cap = window.Capacitor;
      var plugin = cap && cap.Plugins && cap.Plugins.PushNotifications;
      if (!plugin || typeof plugin.addListener !== 'function') return;
      plugin.addListener('registration', function (ev) {
        if (ev && ev.value) registerNativeToken(ev.value, { platform: 'android' });
      });
      plugin.addListener('pushNotificationReceived', function (ev) {
        var d = (ev && (ev.data || ev.notification)) || {};
        var id = String(d.notification_id || d.id || '');
        if (id && !claimShown(id)) return;   // already displayed → skip
        report(id, 'displayed', 'native');
      });
      plugin.addListener('pushNotificationActionPerformed', function (ev) {
        var d = (ev && ev.notification && ev.notification.data) || {};
        var id = String(d.notification_id || '');
        report(id, 'clicked', 'native');
        var url = String(d.click_url || (d.app_slug ? '/app?slug=' + encodeURIComponent(d.app_slug) : '/notifications.html'));
        if (url.charAt(0) === '/' && url.charAt(1) !== '/') window.location.href = url;
      });
      if (typeof plugin.register === 'function') plugin.register().catch(function () {});
    } catch (e) {}
  }

  /* Classic JS bridge: the APK injects a token at any time, even before the
     user signs in — we queue it and retry on the next auth change. */
  function hookAndroidBridge() {
    window.addEventListener('gs-fcm-token', function (e) {
      var t = e && e.detail && (e.detail.token || e.detail.value);
      if (t) registerNativeToken(t, { platform: 'android' });
    });
    try {
      var b = window.GSAndroid;
      if (b && typeof b.getFcmToken === 'function') {
        var t = b.getFcmToken();
        if (t && typeof t.then === 'function') {
          t.then(function (v) { if (v) registerNativeToken(v, { platform: 'android' }); }).catch(function () {});
        } else if (t) registerNativeToken(t, { platform: 'android' });
      }
    } catch (e) {}
    try {
      if (window.GAuth && typeof window.GAuth.onAuthChange === 'function') {
        window.GAuth.onAuthChange(function (u) { if (u) setTimeout(flushPendingNative, 400); });
      }
    } catch (e) {}
  }

  /* --------------------- in-app fallback + centre --------------------- */
  var firstRun = null;
  function seenMap() { return read(SEEN_KEY, null); }
  function markSeen(ids) {
    var map = read(SEEN_KEY, {}) || {};
    ids.forEach(function (id) { if (id) map[id] = Date.now(); });
    var keys = Object.keys(map).sort(function (a, b) { return map[b] - map[a]; });
    var out = {};
    keys.slice(0, MAX_SEEN).forEach(function (k) { out[k] = map[k]; });
    write(SEEN_KEY, out);
  }

  function toastOne(n) {
    var title = String(n.title || 'Golden Store');
    var body = String(n.body || '');
    var msg = body ? title + ' — ' + body : title;
    try {
      if (window.Store && typeof window.Store.toast === 'function') {
        window.Store.toast(msg, 'info', 6000);
      } else {
        var div = document.createElement('div');
        div.setAttribute('role', 'status');
        div.textContent = msg;
        div.style.cssText = 'position:fixed;z-index:2147483000;inset-inline:12px;bottom:76px;' +
          'padding:12px 16px;border-radius:14px;background:#151517;color:#f6d77a;' +
          'border:1px solid rgba(244,192,31,.45);box-shadow:0 12px 36px rgba(0,0,0,.45);' +
          'font:600 14px/1.5 system-ui,sans-serif;direction:rtl;text-align:center;cursor:pointer;';
        div.onclick = function () { window.location.href = '/notifications.html'; };
        (document.body || document.documentElement).appendChild(div);
        setTimeout(function () { try { div.remove(); } catch (e) {} }, 6000);
      }
    } catch (e) {}
  }

  function poll(force) {
    if (!force && document.hidden) return;   // defer toasts until the tab is visible
    fetch('/api/notifications?limit=10', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { notifications: [] }; })
      .catch(function () { return { notifications: [] }; })
      .then(function (data) {
        var list = (data && data.notifications) || [];
        var ids = list.map(function (n) { return String(n.id || ''); }).filter(Boolean);
        var seen = seenMap();
        if (seen === null) {              // first ever run: no retrospective spam
          markSeen(ids);
          firstRun = false;
          return;
        }
        var fresh = list.filter(function (n) {
          var id = String(n.id || '');
          return id && !seen[id] && claimShown(id);
        });
        markSeen(ids);
        if (!fresh.length) return;
        // ONE toast for the newest notification; the rest live in the centre.
        toastOne(fresh[0]);
        report(String(fresh[0].id || ''), 'displayed', 'in_app');
        try { window.dispatchEvent(new CustomEvent('gs-notifications-updated', { detail: fresh })); }
        catch (e) {}
        try {
          if (window.Store && typeof window.Store.fetchNotifications === 'function') {
            window.Store.fetchNotifications().catch(function () {});
          }
        } catch (e) {}
      });
  }

  GS.installationId = installationId;
  GS.claimShown = GS.claimShown || claimShown;
  GS.report = GS.report || report;
  GS.registerNativeToken = registerNativeToken;
  GS.onNativeToken = registerNativeToken;
  GS.refresh = function () { poll(true); };
  GS.start = function () {
    hookCapacitor();
    hookAndroidBridge();
    poll(false);
    setInterval(function () { poll(false); }, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) poll(true);
    });
    window.addEventListener('focus', function () { poll(true); });
    window.addEventListener('gs-notifications-refresh', function () { poll(true); });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', GS.start);
  } else {
    GS.start();
  }
})();
