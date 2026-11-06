/* Golden Store APK landing page — counted redirect, REAL durable download
   total, instant curated translation (no dependency on /api/translate),
   and a manual "check for updates" action.
   Works without store.js / Firebase: this is a public, auth-free page. */
(function () {
  'use strict';

  function t(source) {
    try {
      return window.GSI18N && typeof window.GSI18N.t === 'function'
        ? window.GSI18N.t(source) : source;
    } catch (e) { return source; }
  }

  var btn = document.getElementById('downloadBtn');
  var btnLabel = document.getElementById('downloadBtnLabel');
  var count = document.getElementById('downloadCount');
  var countLabel = document.getElementById('downloadCountLabel');
  var counter = document.getElementById('downloadCounter');
  var help = document.getElementById('downloadHelp');
  var versionEl = document.getElementById('currentVersion');
  var checkBtn = document.getElementById('checkUpdatesBtn');
  var status = document.getElementById('updateStatus');

  /* -------------------------------------------------------------------
     1) Instant, offline-capable translation. Every visible string in
        download.html carries data-i18n (or an attribute hook) and has a
        curated EN/FR/ES entry in lang.js, so switching language never
        depends on the machine-translation endpoint.
     ------------------------------------------------------------------- */
  function applyI18n() {
    var i18n = window.GSI18N;
    if (i18n) {
      document.documentElement.setAttribute('lang', i18n.lang || 'ar');
      document.documentElement.setAttribute('dir', i18n.isRTL ? 'rtl' : 'ltr');
    }
    var ATTR_HOOKS = {
      'data-i18n-content': 'content',
      'data-i18n-aria': 'aria-label',
      'data-i18n-title': 'title',
      'data-i18n-placeholder': 'placeholder',
    };
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      var key = node.getAttribute('data-i18n');
      if (key) node.textContent = t(key);
    });
    Object.keys(ATTR_HOOKS).forEach(function (hook) {
      document.querySelectorAll('[' + hook + ']').forEach(function (node) {
        var key = node.getAttribute(hook);
        if (key) node.setAttribute(ATTR_HOOKS[hook], t(key));
      });
    });
    var switcherHost = document.getElementById('languageSwitcher');
    if (switcherHost) switcherHost.setAttribute('aria-label', t('اللغة'));
  }

  // Fill the inline icon placeholders with the shared icon set.
  try {
    var svg = window.GSIcons && window.GSIcons.svg;
    if (svg) {
      document.querySelectorAll('[data-icon]').forEach(function (node) {
        // Replace the placeholder span with a real <svg class="icon"> so there
        // is no nested double-sizing and the shared icon CSS applies directly.
        var tmp = document.createElement('div');
        tmp.innerHTML = svg(node.getAttribute('data-icon'), 'icon');
        var svgNode = tmp.firstElementChild;
        if (svgNode && node.parentNode) node.parentNode.replaceChild(svgNode, node);
      });
    }
  } catch (e) {}

  applyI18n();

  var switcherHost = document.getElementById('languageSwitcher');
  if (switcherHost && window.GSI18N && typeof window.GSI18N.switcherEl === 'function') {
    switcherHost.appendChild(window.GSI18N.switcherEl());
  }

  if (btnLabel) btnLabel.textContent = t('تحميل الآن');
  if (btn) btn.addEventListener('click', function (event) {
    if (btn.getAttribute('aria-disabled') === 'true') event.preventDefault();
  });

  function formatCount(value) {
    // null/undefined/'' mean "unknown" — never render them as a fake zero.
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    try {
      var locale = (window.GSI18N && window.GSI18N.lang) || 'ar';
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 0, numberingSystem: 'latn' }).format(Math.floor(n));
    } catch (e) { return String(Math.floor(n)); }
  }

  function showCount(value) {
    if (!count) return;
    var formatted = formatCount(value);
    if (formatted === null) {
      count.textContent = '—';
      count.setAttribute('data-count', '');
      if (counter) counter.setAttribute('aria-label', t('تعذّر تحميل عدد التنزيلات'));
      return;
    }
    count.textContent = formatted;
    count.setAttribute('data-count', String(Math.max(0, Math.floor(Number(value) || 0))));
    if (counter) counter.setAttribute('aria-label', t('إجمالي التنزيلات') + ' ' + formatted);
  }

  function setDownload(enabled) {
    if (!btn || !enabled) return;
    // Route through our API so the server increments the durable counter
    // before redirecting to the published APK. Never link around it.
    btn.href = '/api/app-update/download';
    btn.classList.remove('is-disabled');
    btn.removeAttribute('aria-disabled');
  }

  function applyRelease(data) {
    if (versionEl && data.version_name) versionEl.textContent = String(data.version_name);
    document.title = t('تحميل Golden Store — أحدث إصدار')
      + (data.version_name ? ' · ' + String(data.version_name) : '');
  }

  // Relative first (same-origin on both hosts). If a proxy/CDN ever breaks
  // it, fall back to the Worker's own domain so the real total still shows.
  var API_URLS = ['/api/app-update?_=', 'https://api.goldenstore.online/api/app-update?_='];
  function fetchRelease(index) {
    var url = API_URLS[index] + Date.now();
    return fetch(url, {
      method: 'GET',
      credentials: index === 0 ? 'same-origin' : 'omit',
      cache: 'no-store',
    }).then(function (response) {
      if (!response.ok) throw new Error('app_update_unavailable');
      return response.json();
    }).then(function (data) {
      if (!data || typeof data !== 'object') throw new Error('bad_payload');
      return data;
    });
  }
  function loadRelease(index) {
    index = index || 0;
    return fetchRelease(index).catch(function () {
      if (index + 1 < API_URLS.length) return loadRelease(index + 1);
      throw new Error('app_update_unreachable');
    });
  }

  function render(data) {
    showCount(data.downloads);
    setDownload(!!(data.apk_url || data.url));
    applyRelease(data);
    if (help && (!btn || btn.classList.contains('is-disabled'))) {
      help.textContent = t('الرابط غير متاح حالياً');
    } else if (help) {
      help.textContent = '';
    }
  }

  function refresh() {
    return loadRelease(0).then(render).catch(function () {
      showCount(null);
      if (help) help.textContent = t('تحقّق من اتصالك بالإنترنت ثم أعد المحاولة.');
    });
  }

  refresh();
  // The total changes after every real download; refresh when the user comes
  // back to the tab so the number is never stale.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });

  // Manual update check — reports the latest published version without
  // forcing a download, and never blocks the main download button.
  if (checkBtn) checkBtn.addEventListener('click', function () {
    checkBtn.disabled = true;
    if (status) {
      status.textContent = t('جارٍ التحقق من التحديثات…');
      status.className = 'dl-check-status';
    }
    loadRelease(0)
      .then(function (data) {
        showCount(data.downloads);
        applyRelease(data);
        if (status) {
          status.textContent = t('أحدث إصدار متاح') + ' · ' + t('الإصدار') + ' ' + (data.version_name || '—');
          status.className = 'dl-check-status is-ok';
        }
      })
      .catch(function () {
        if (status) {
          status.textContent = t('تعذّر التحقق من التحديثات');
          status.className = 'dl-check-status is-error';
        }
      })
      .then(function () { checkBtn.disabled = false; });
  });
})();
