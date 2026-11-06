/* Golden Store APK landing page — professional layout support.
   Counted redirect, localized download total, release notes, and a manual
   "check for updates" action. Works without store.js (no auth required). */
(function () {
  'use strict';

  var t = window.GSI18N && typeof window.GSI18N.t === 'function'
    ? window.GSI18N.t
    : function (s) { return s; };

  var btn = document.getElementById('downloadBtn');
  var btnLabel = document.getElementById('downloadBtnLabel');
  var count = document.getElementById('downloadCount');
  var countLabel = document.getElementById('downloadCountLabel');
  var help = document.getElementById('downloadHelp');
  var versionEl = document.getElementById('currentVersion');
  var releaseNotes = document.getElementById('releaseNotes');
  var checkBtn = document.getElementById('checkUpdatesBtn');
  var status = document.getElementById('updateStatus');

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

  if (countLabel) countLabel.textContent = t('إجمالي التنزيلات');
  if (btnLabel) btnLabel.textContent = t('تحميل الآن');
  if (btn) btn.addEventListener('click', function (event) {
    if (btn.getAttribute('aria-disabled') === 'true') event.preventDefault();
  });

  var switcherHost = document.getElementById('languageSwitcher');
  if (switcherHost && window.GSI18N && typeof window.GSI18N.switcherEl === 'function') {
    switcherHost.appendChild(window.GSI18N.switcherEl());
  }

  function formatCount(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n < 0) return '—';
    try {
      var locale = (window.GSI18N && window.GSI18N.lang) || 'ar';
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 0, numberingSystem: 'latn' }).format(Math.floor(n));
    } catch (e) {
      return String(Math.floor(n));
    }
  }

  function setDownload(enabled) {
    if (!btn || !enabled) return;
    // Route through our API so the server increments the counter before
    // redirecting to the published APK. Never link around the counter.
    btn.href = '/api/app-update/download';
    btn.classList.remove('is-disabled');
    btn.removeAttribute('aria-disabled');
  }

  function applyRelease(data) {
    if (versionEl && data.version_name) versionEl.textContent = String(data.version_name);
    if (releaseNotes && data.notes) releaseNotes.textContent = String(data.notes);
    if (data.version_name) document.title = t('تحميل Golden Store') + ' ' + data.version_name;
  }

  fetch('/api/app-update', { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) throw new Error('app_update_unavailable');
      return response.json();
    })
    .then(function (data) {
      data = data || {};
      if (count) count.textContent = formatCount(data.downloads);
      setDownload(!!(data.apk_url || data.url));
      applyRelease(data);
      if (!btn || btn.classList.contains('is-disabled')) {
        if (help) help.textContent = t('الرابط غير متاح حالياً');
      }
    })
    .catch(function () {
      if (count) count.textContent = '—';
      if (help) help.textContent = t('تحقّق من اتصالك بالإنترنت ثم أعد المحاولة.');
    });

  // Manual update check — reports the latest published version without
  // forcing a download, and never blocks the main download button.
  if (checkBtn) checkBtn.addEventListener('click', function () {
    checkBtn.disabled = true;
    if (status) {
      status.textContent = t('جارٍ التحقق من التحديثات…');
      status.className = 'dl-check-status';
    }
    fetch('/api/app-update?_=' + Date.now(), { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('unavailable'); return r.json(); })
      .then(function (data) {
        data = data || {};
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
