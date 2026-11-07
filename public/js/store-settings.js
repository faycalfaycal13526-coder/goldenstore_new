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
  var pending = null;
  var appliedOnce = false;

  function get(k, fallback) {
    if (!values || values[k] == null) return fallback === undefined ? '' : fallback;
    return values[k];
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
  function maintenance() {
    var existing = document.getElementById('gs-maintenance-bar');
    if (get('maintenance_mode') !== '1') {
      if (existing) existing.remove();
      document.body.classList.remove('has-maintenance-bar');
      return;
    }
    var msg = get('maintenance_message') || 'المتجر تحت الصيانة';
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'gs-maintenance-bar';
      existing.className = 'gs-maintenance-bar';
      existing.setAttribute('role', 'status');
      existing.setAttribute('data-noi18n', '');
      existing.textContent = msg;
      document.body.prepend(existing);
      document.body.classList.add('has-maintenance-bar');
    } else existing.textContent = msg;
  }
  function applyLanguage() {
    try {
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
    maintenance();
    applyLanguage();
    try { window.dispatchEvent(new CustomEvent('gs-settings-applied', { detail: values })); } catch (e) {}
    appliedOnce = true;
  }
  function load() {
    if (!pending) {
      pending = fetch('/api/settings?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { values = (d && d.settings) || {}; })
        .catch(function () { values = {}; })
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
    ready: load,
    refresh: refresh,
    apply: apply,
    isApplied: function () { return appliedOnce; },
  };
  load();
})();
