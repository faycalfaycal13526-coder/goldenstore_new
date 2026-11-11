/* Golden Store — applies persisted admin settings to EVERY page.
   Loaded before lang.js / store.js. Changes take effect on the next load
   because GET /api/settings is no-store. */
(function () {
  var ACCENTS = {
    gold:   { a: '#f4c01f', b: '#ffd34d', bg: 'rgba(244,192,31,.16)' },
    blue:   { a: '#4c9ffe', b: '#82baff', bg: 'rgba(76,159,254,.16)' },
    green:  { a: '#4caf50', b: '#81c784', bg: 'rgba(76,175,80,.16)' },
    purple: { a: '#a78bfa', b: '#c4b5fd', bg: 'rgba(167,139,250,.16)' },
  };
  var values = null;
  var meta = null;
  var pending = null;
  var appliedOnce = false;
  var fetchedAt = 0;

  function get(k, fallback) {
    if (!values || values[k] == null) return fallback === undefined ? '' : fallback;
    return values[k];
  }
  function tr(ar) {
    try {
      return window.GSI18N && typeof window.GSI18N.t === 'function' ? window.GSI18N.t(ar) : ar;
    } catch (e) { return ar; }
  }
  function setVars(map) {
    try { Object.keys(map).forEach(function (k) { document.documentElement.style.setProperty(k, map[k]); }); } catch (e) {}
  }
  function safeUrl(u) {
    return /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
  }
  function textNodes(selector, text) {
    try { document.querySelectorAll(selector).forEach(function (n) { n.textContent = text; }); } catch (e) {}
  }
  function linkNodes(selector, url, label) {
    try {
      document.querySelectorAll(selector).forEach(function (n) {
        if (url) {
          if (n.tagName === 'A') { n.setAttribute('href', url); if (label) n.textContent = label; }
          else n.setAttribute('data-setting-value', url);
        } else if (n.tagName === 'A') n.style.display = 'none';
      });
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ */
  /* Centered, non-bypassable maintenance modal                          */
  /* ------------------------------------------------------------------ */
  var activeOverlay = null;
  var adminPill = null;
  var guardObserver = null;
  var guardTimer = null;
  var tickTimer = null;
  var pollTimer = null;
  var expiryRequested = false;

  function serverNow() {
    var s = Number(meta && meta.server_time) || 0;
    if (!s || !fetchedAt) return Date.now() / 1000;
    return s + (Date.now() - fetchedAt) / 1000;
  }
  function endAt() {
    return Number((meta && meta.maintenance_end_at) || get('maintenance_end_at', 0) || 0);
  }
  function isActive() {
    if (meta && typeof meta.maintenance_active === 'boolean') return meta.maintenance_active;
    if (get('maintenance_mode', '0') !== '1') return false;
    var end = endAt();
    return !(end > 0 && end <= serverNow());
  }
  function isBypass() { return !!(meta && meta.maintenance_bypass === true); }
  function isMaintenancePage() {
    try {
      if (document.body && document.body.getAttribute('data-page') === 'maintenance') return true;
      return /\/maintenance(?:\.html)?(?:\/|$)/i.test(window.location.pathname || '');
    } catch (e) { return false; }
  }
  function isAdminConsole() {
    try {
      if (document.body && document.body.getAttribute('data-page') === 'admin') return true;
      return /gs-admin-[a-z0-9]+\.html/i.test(window.location.pathname || '');
    } catch (e) { return false; }
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtRemaining(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor((sec % 3600) / 60)) + ':' + pad(sec % 60);
  }
  function fmtEnd(end) {
    if (!end || end <= 0) return '';
    try {
      return new Date(end * 1000).toLocaleString(document.documentElement.lang || 'ar',
        { dateStyle: 'medium', timeStyle: 'short', numberingSystem: 'latn' });
    } catch (e) { return ''; }
  }
  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function iconNode(name) {
    try {
      if (window.GSIcons && typeof window.GSIcons.iconEl === 'function') {
        var el = window.GSIcons.iconEl(name, 'icon');
        if (el) return el;
      }
    } catch (e) {}
    return node('span', 'icon');
  }
  function changeLang(code) {
    try { localStorage.setItem('gs_lang', code); } catch (e) {}
    try {
      var i18n = window.GSI18N;
      if (i18n && typeof i18n.setLang === 'function') {
        var before = i18n.lang;
        i18n.setLang(code);
        if (before !== code) return;      // setLang() reloads the page
      }
    } catch (e) {}
    try { window.location.reload(); } catch (e) {}
  }
  function currentLang() {
    try { return (window.GSI18N && window.GSI18N.lang) || 'ar'; } catch (e) { return 'ar'; }
  }
  function languageSwitcher() {
    var wrap = node('div', 'gs-modal-lang');
    wrap.setAttribute('data-noi18n', '');
    var btn = node('button', 'gs-modal-btn gs-modal-lang-btn');
    btn.type = 'button';
    btn.setAttribute('aria-label', tr('اللغة'));
    btn.setAttribute('aria-haspopup', 'true');
    btn.appendChild(iconNode('globe'));
    btn.appendChild(node('span', 'gs-modal-lang-code', String(currentLang()).toUpperCase()));
    var menu = node('div', 'gs-modal-lang-menu');
    [['ar', 'العربية'], ['en', 'English'], ['fr', 'Français'], ['es', 'Español']].forEach(function (pair) {
      var it = node('button', 'gs-modal-lang-item' + (pair[0] === currentLang() ? ' is-on' : ''), pair[1]);
      it.type = 'button';
      it.onclick = function (e) { e.stopPropagation(); changeLang(pair[0]); };
      menu.appendChild(it);
    });
    btn.onclick = function (e) { e.stopPropagation(); wrap.classList.toggle('is-open'); };
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) wrap.classList.remove('is-open');
    });
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  }
  function telegramButton() {
    // The admin configures this URL in Settings Center; safeUrl blocks javascript:.
    var url = safeUrl(get('telegram_url')) || 'https://t.me/goldenstore_10';
    var a = document.createElement('a');
    a.className = 'gs-modal-btn gs-modal-telegram';
    a.setAttribute('href', url);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.setAttribute('aria-label', tr('المزيد من الأخبار'));
    a.setAttribute('data-noi18n', '');
    a.appendChild(iconNode('send'));
    a.appendChild(document.createTextNode(tr('المزيد من الأخبار')));
    return a;
  }
  function modalExtras() {
    var row = node('div', 'gs-modal-extras');
    row.setAttribute('data-noi18n', '');
    row.appendChild(languageSwitcher());
    row.appendChild(telegramButton());
    return row;
  }
  // Shared by store.js so BOTH popups get the same controls.
  window.GSModalTools = {
    languageSwitcher: languageSwitcher,
    telegramButton: telegramButton,
    extras: modalExtras,
    t: tr,
  };

  function buildOverlay(msg) {
    var overlay = node('div', 'gs-maintenance-overlay');
    overlay.id = 'gs-maintenance-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'gs-maintenance-title');
    overlay.setAttribute('aria-describedby', 'gs-maintenance-desc');
    overlay.setAttribute('data-noi18n', '');

    var card = node('div', 'gs-maintenance-card');
    var logo = node('div', 'gs-maintenance-logo');
    var img = document.createElement('img');
    img.setAttribute('src', '/images/logo.png');
    img.setAttribute('alt', get('store_name', 'Golden Store'));
    img.setAttribute('draggable', 'false');
    logo.appendChild(img);
    card.appendChild(logo);

    var badge = node('div', 'gs-maintenance-badge');
    badge.appendChild(node('span', 'gs-maintenance-dot'));
    badge.appendChild(node('span', null, tr('صيانة مجدولة')));
    card.appendChild(badge);

    var title = node('h1', 'gs-maintenance-title', tr('المتجر تحت الصيانة'));
    title.id = 'gs-maintenance-title';
    card.appendChild(title);
    var desc = node('p', 'gs-maintenance-desc', msg || tr('المتجر تحت الصيانة، نعود قريباً.'));
    desc.id = 'gs-maintenance-desc';
    card.appendChild(desc);

    var clock = node('div', 'gs-maintenance-clock');
    clock.appendChild(node('span', 'gs-maintenance-clock-label', tr('الوقت المتبقي')));
    var cd = node('strong', 'gs-maintenance-countdown', '--:--:--');
    cd.setAttribute('dir', 'ltr');
    cd.setAttribute('aria-live', 'off');
    clock.appendChild(cd);
    var endLine = node('span', 'gs-maintenance-end');
    endLine.appendChild(document.createTextNode(tr('ينتهي في') + ' '));
    var endValue = node('b', 'gs-maintenance-end-value', '');
    endLine.appendChild(endValue);
    clock.appendChild(endLine);
    var track = node('div', 'gs-maintenance-track');
    track.appendChild(node('i', 'gs-maintenance-fill'));
    clock.appendChild(track);
    card.appendChild(clock);

    card.appendChild(modalExtras());
    card.appendChild(node('div', 'gs-maintenance-foot',
      tr('لا يمكن متابعة التصفح حتى انتهاء الصيانة')));
    overlay.appendChild(card);
    return overlay;
  }

  function applyInert() {
    if (!activeOverlay || !document.body) return;
    try {
      Array.prototype.forEach.call(document.body.children, function (n) {
        if (n === activeOverlay) {
          n.removeAttribute('inert');
          n.removeAttribute('aria-hidden');
          return;
        }
        if (!n.hasAttribute('data-gs-lock')) {
          n.setAttribute('data-gs-lock', '1');
          n.setAttribute('inert', '');
          n.setAttribute('aria-hidden', 'true');
        }
      });
    } catch (e) {}
  }
  function unlockPage() {
    try {
      Array.prototype.forEach.call(document.body.children, function (n) {
        if (n.hasAttribute('data-gs-lock')) {
          n.removeAttribute('data-gs-lock');
          n.removeAttribute('inert');
          n.removeAttribute('aria-hidden');
        }
      });
    } catch (e) {}
    document.documentElement.classList.remove('gs-maintenance-locked');
    document.body.classList.remove('gs-maintenance-locked');
    try { document.body.style.overflow = ''; } catch (e) {}
  }
  function lockPage() {
    document.documentElement.classList.add('gs-maintenance-locked');
    document.body.classList.add('gs-maintenance-locked');
    try { document.body.style.overflow = 'hidden'; } catch (e) {}
    applyInert();
  }
  function blockEvent(e) {
    if (!activeOverlay) return;
    // Controls inside the modal (language menu, Telegram) must stay usable.
    try { if (e.target && activeOverlay.contains(e.target)) return; } catch (e2) {}
    if (e.type === 'keydown') {
      var k = e.key || '';
      if (k === 'Escape' || k === 'Tab' || k === 'Enter' || k === ' ' ||
          k.indexOf('Arrow') === 0 || k === 'Backspace' || k === 'Delete') {
        try { e.preventDefault(); e.stopImmediatePropagation(); } catch (err) {}
      }
    } else {
      try { e.preventDefault(); } catch (err) {}
    }
  }
  function enforceOverlay() {
    if (!activeOverlay || !document.body) return;
    if (!activeOverlay.isConnected || activeOverlay.parentNode !== document.body) {
      document.body.appendChild(activeOverlay);
    }
    var st = activeOverlay.style;
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0' ||
        st.position === 'static') activeOverlay.removeAttribute('style');
    if (!activeOverlay.classList.contains('gs-maintenance-overlay')) {
      activeOverlay.className = 'gs-maintenance-overlay';
    }
    document.documentElement.classList.add('gs-maintenance-locked');
    document.body.classList.add('gs-maintenance-locked');
    try { document.body.style.overflow = 'hidden'; } catch (e) {}
    applyInert();
  }
  function startGuards() {
    stopGuards();
    try {
      guardObserver = new MutationObserver(function () {
        if (activeOverlay) enforceOverlay();
      });
      guardObserver.observe(document.body, { childList: true });
    } catch (e) {}
    guardTimer = setInterval(enforceOverlay, 500);
    document.addEventListener('keydown', blockEvent, true);
    document.addEventListener('keyup', blockEvent, true);
    document.addEventListener('contextmenu', blockEvent, true);
    document.addEventListener('selectstart', blockEvent, true);
    document.addEventListener('dragstart', blockEvent, true);
    document.addEventListener('copy', blockEvent, true);
  }
  function stopGuards() {
    if (guardObserver) { try { guardObserver.disconnect(); } catch (e) {} guardObserver = null; }
    if (guardTimer) clearInterval(guardTimer);
    if (tickTimer) clearInterval(tickTimer);
    guardTimer = null; tickTimer = null;
    document.removeEventListener('keydown', blockEvent, true);
    document.removeEventListener('keyup', blockEvent, true);
    document.removeEventListener('contextmenu', blockEvent, true);
    document.removeEventListener('selectstart', blockEvent, true);
    document.removeEventListener('dragstart', blockEvent, true);
    document.removeEventListener('copy', blockEvent, true);
  }
  function tick() {
    if (!activeOverlay) return;
    var end = endAt();
    var rem = end > 0 ? end - serverNow() : 0;
    var cd = activeOverlay.querySelector('.gs-maintenance-countdown');
    if (cd) cd.textContent = end > 0 ? fmtRemaining(rem) : '--:--:--';
    var ev = activeOverlay.querySelector('.gs-maintenance-end-value');
    if (ev) ev.textContent = fmtEnd(end);
    var total = Math.max(1, Number(get('maintenance_duration_minutes', 60) || 60) * 60);
    var bar = activeOverlay.querySelector('.gs-maintenance-fill');
    if (bar) bar.style.width = Math.max(0, Math.min(100, (rem / total) * 100)) + '%';
    if (end > 0 && rem <= 0 && !expiryRequested) {
      expiryRequested = true;
      var cd2 = activeOverlay.querySelector('.gs-maintenance-countdown');
      if (cd2) cd2.textContent = '00:00:00';
      var foot = activeOverlay.querySelector('.gs-maintenance-foot');
      if (foot) foot.textContent = tr('انتهت الصيانة، نعود الآن…');
      setTimeout(function () { refresh(); }, 1200);
    }
  }
  function showBlocking(msg) {
    if (!activeOverlay) {
      activeOverlay = buildOverlay(msg);
      document.body.appendChild(activeOverlay);
      lockPage();
      startGuards();
      tickTimer = setInterval(tick, 1000);
      pollTimer = setInterval(function () { refresh(); }, 20000);
      expiryRequested = false;
    }
    var desc = activeOverlay.querySelector('.gs-maintenance-desc');
    if (desc) desc.textContent = msg || tr('المتجر تحت الصيانة، نعود قريباً.');
    enforceOverlay();
    tick();
  }
  function hideBlocking() {
    if (activeOverlay) { try { activeOverlay.remove(); } catch (e) {} activeOverlay = null; }
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    stopGuards();
    unlockPage();
  }
  function showAdminPill() {
    var existing = document.getElementById('gs-maintenance-admin');
    if (!existing) {
      existing = node('div', 'gs-maintenance-bar gs-maintenance-admin');
      existing.id = 'gs-maintenance-admin';
      existing.setAttribute('role', 'status');
      existing.setAttribute('data-noi18n', '');
      existing.appendChild(node('span', 'gs-maintenance-admin-dot'));
      existing.appendChild(node('strong', 'gs-maintenance-admin-label',
        tr(isBypass() ? 'وضع الصيانة مفعّل — معاينة المدير' : 'وضع الصيانة مفعّل — الزوار محجوبون')));
      var cd = node('b', 'gs-maintenance-admin-countdown', '--:--:--');
      cd.setAttribute('dir', 'ltr');
      existing.appendChild(cd);
      if (!isAdminConsole()) {
        var a = node('a', null, tr('لوحة التحكم'));
        a.setAttribute('href', '/gs-admin-c0d982f8.html');
        existing.appendChild(a);
      }
      document.body.appendChild(existing);
    }
    adminPill = existing;
    var label = adminPill.querySelector('.gs-maintenance-admin-label');
    if (label) label.textContent = tr(isBypass()
      ? 'وضع الصيانة مفعّل — معاينة المدير' : 'وضع الصيانة مفعّل — الزوار محجوبون');
    var rem = endAt() > 0 ? endAt() - serverNow() : 0;
    var b = adminPill.querySelector('.gs-maintenance-admin-countdown');
    if (b) b.textContent = endAt() > 0 ? fmtRemaining(rem) : '—';
  }
  function hideAdminPill() {
    if (adminPill) { try { adminPill.remove(); } catch (e) {} adminPill = null; }
    var existing = document.getElementById('gs-maintenance-admin');
    if (existing) existing.remove();
  }
  function maintenance() {
    // Remove the legacy top banner from older cached builds.
    var legacy = document.getElementById('gs-maintenance-bar');
    if (legacy && legacy.id === 'gs-maintenance-bar' && !legacy.classList.contains('gs-maintenance-admin')) legacy.remove();
    document.body.classList.remove('has-maintenance-bar');
    if (!isActive()) { hideBlocking(); hideAdminPill(); return; }
    // The standalone /maintenance page IS the maintenance screen: never put a
    // second overlay on top of it.
    if (isMaintenancePage()) { hideBlocking(); hideAdminPill(); return; }
    var msg = get('maintenance_message') || tr('المتجر تحت الصيانة، نعود قريباً.');
    // The console is the ONLY page that is never locked: the admin must be able
    // to sign in (or turn maintenance off) even before a session cookie exists.
    // Visitors still cannot read anything: every /api/admin/* route is 401 and
    // every public API route is 503 without a verified admin session.
    if (isBypass() || isAdminConsole()) { hideBlocking(); showAdminPill(); return; }
    hideAdminPill();
    showBlocking(msg);
  }

  function applyLanguage() {
    try {
      if (isActive() && !isBypass()) return;   // never reload a locked maintenance screen
      if (localStorage.getItem('gs_lang')) return;                 // explicit user choice wins
      var want = get('default_language', 'ar');
      if (!want || want === 'ar') return;
      if (sessionStorage.getItem('gs_default_lang_applied') === want) return;
      if (!window.GSI18N || typeof window.GSI18N.setLang !== 'function') return;
      sessionStorage.setItem('gs_default_lang_applied', want);
      localStorage.setItem('gs_lang', want);
      window.GSI18N.setLang(want);                                 // reloads once
    } catch (e) {}
  }
  function applyTheme() {
    try {
      if (localStorage.getItem('gs_theme')) return;                // explicit user choice wins
      var want = get('theme_default', 'dark');
      if (want === 'system') want = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', want === 'light' ? 'light' : 'dark');
    } catch (e) {}
  }
  function apply() {
    if (!values) return;
    applyTheme();
    var acc = ACCENTS[get('accent', 'gold')] || ACCENTS.gold;
    setVars({ '--gold': acc.a, '--gold-2': acc.b, '--star': acc.a, '--nav-bg': acc.bg, '--gs-accent': acc.a });
    var density = get('density', 'comfortable');
    document.body.classList.toggle('gs-compact', density === 'compact');
    document.body.classList.toggle('admin-compact', density === 'compact');
    document.body.classList.toggle('gs-hide-downloads', get('show_download_counter', '1') !== '1');
    document.body.classList.toggle('gs-reviews-off', get('allow_reviews', '1') !== '1');

    var name = get('store_name', 'Golden Store');
    var tag = get('tagline', '');
    if (name) {
      textNodes('[data-store-name]', name);
      try {
        document.title = /Golden Store/i.test(document.title)
          ? document.title.replace(/Golden Store/gi, name)
          : name + ' — ' + document.title;
      } catch (e) {}
      try {
        document.querySelectorAll('.site-footer-brand').forEach(function (n) {
          n.textContent = '© ' + name;
        });
      } catch (e) {}
    }
    if (tag) {
      try {
        var m = document.querySelector('meta[name="description"]');
        if (m) m.setAttribute('content', tag);
      } catch (e) {}
      textNodes('[data-store-tagline]', tag);
    }
    var official = safeUrl(get('official_url'));
    if (official) {
      linkNodes('[data-setting="official_url"]', official);
      try {
        document.querySelectorAll('.site-footer-site a').forEach(function (a) {
          a.setAttribute('href', official);
          a.textContent = official.replace(/^https?:\/\//, '').replace(/\/$/, '');
        });
      } catch (e) {}
    }
    var telegram = safeUrl(get('telegram_url'));
    linkNodes('[data-setting="telegram_url"]', telegram);
    try {
      document.querySelectorAll('.acct-telegram-btn, [data-setting="telegram_url"]').forEach(function (a) {
        if (telegram && a.tagName === 'A') a.setAttribute('href', telegram);
        else if (!telegram) a.style.display = 'none';
      });
    } catch (e) {}
    var email = String(get('support_email', '')).trim();
    linkNodes('[data-setting="support_email"]', email ? 'mailto:' + email : '', email);
    applyLanguage();
    maintenance();
    try { window.dispatchEvent(new CustomEvent('gs-settings-applied', { detail: values })); } catch (e) {}
    appliedOnce = true;
  }
  /* ------------------------------------------------------------------
     Resilient website delivery. On the website the settings request may be
     stale-cached or proxied while the native app still gets the Worker 503.
     Any /api/* 503 with error:'maintenance' is therefore enough to show the
     exact same full-screen screen, even without a successful settings read.
     ------------------------------------------------------------------ */
  function forceFromMaintenanceResponse(m) {
    if (m && m.active === false) return;
    if (!values) values = {};
    if (!meta) meta = {};
    meta.maintenance_active = true;
    meta.maintenance_end_at = Number((m && m.end_at) || meta.maintenance_end_at || 0);
    meta.maintenance_remaining = Number((m && m.remaining) || 0);
    meta.server_time = Number((m && m.server_time) || 0);
    if (m && m.message) values.maintenance_message = m.message;
    fetchedAt = Date.now();
    try { maintenance(); } catch (e) {}
  }
  function installFetchGuard() {
    if (typeof window.fetch !== 'function' || window.__gsMaintFetchGuard) return;
    window.__gsMaintFetchGuard = true;
    var original = window.fetch;
    window.fetch = function () {
      var args = arguments;
      var p;
      try { p = original.apply(window, args); } catch (e) { return Promise.reject(e); }
      if (!p || typeof p.then !== 'function') return p;
      return p.then(function (res) {
        try {
          if (res && res.status === 503) {
            var raw = String((args[0] && args[0].url) || args[0] || '');
            if (raw.indexOf('/api/') !== -1 && typeof res.clone === 'function') {
              res.clone().json().then(function (d) {
                if (d && d.error === 'maintenance') forceFromMaintenanceResponse(d.maintenance || {});
              }).catch(function () {});
            }
          }
        } catch (e2) {}
        return res;
      });
    };
  }
  function load() {
    if (!pending) {
      pending = fetch('/api/settings?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('settings_unavailable')); })
        .catch(function () {
          // Retry with an absolute origin: some website deployments proxy /api
          // differently from the native WebView. Never leave the site unlocked.
          try {
            return fetch(location.origin + '/api/settings?_=' + Date.now(), { cache: 'no-store' })
              .then(function (r2) { return r2.ok ? r2.json() : null; })
              .catch(function () { return null; });
          } catch (e) { return null; }
        })
        .then(function (d) {
          values = (d && d.settings) || {};
          meta = d || {};
          fetchedAt = Date.now();
        })
        .catch(function () { values = {}; meta = {}; fetchedAt = Date.now(); })
        .then(function () {
          if (document.readyState === 'loading') {
            return new Promise(function (resolve) {
              document.addEventListener('DOMContentLoaded', function () { apply(); resolve(values); }, { once: true });
            });
          }
          apply();
          return values;
        });
    }
    return pending;
  }
  function refresh() {
    pending = null;
    return load();
  }
  window.GSSettings = {
    get: get,
    all: function () { return values || {}; },
    meta: function () { return meta || {}; },
    ready: load,
    refresh: refresh,
    apply: apply,
    isApplied: function () { return appliedOnce; },
    maintenanceActive: isActive,
  };
  installFetchGuard();
  load();
})();
