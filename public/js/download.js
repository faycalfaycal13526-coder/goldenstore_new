/* Store APK landing page — counted redirect and localized download total. */
(function () {
  'use strict';

  var btn = document.getElementById('downloadBtn');
  var count = document.getElementById('downloadCount');
  var countLabel = document.getElementById('downloadCountLabel');
  var help = document.getElementById('downloadHelp');
  var countLabelText = 'إجمالي التنزيلات';
  var t = window.GSI18N && typeof window.GSI18N.t === 'function'
    ? window.GSI18N.t
    : function (s) { return s; };

  if (countLabel) countLabel.textContent = t(countLabelText);
  if (btn) btn.addEventListener('click', function (event) {
    if (btn.getAttribute('aria-disabled') === 'true') event.preventDefault();
  });

  var switcherHost = document.getElementById('languageSwitcher');
  if (switcherHost && window.GSI18N && typeof window.GSI18N.switcherEl === 'function') {
    switcherHost.append(window.GSI18N.switcherEl());
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
    btn.classList.remove('no-link');
    btn.removeAttribute('aria-disabled');
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
      if (!btn || btn.classList.contains('no-link')) {
        if (help) help.textContent = t('الرابط غير متاح حالياً');
      }
      if (data.version_name) document.title = 'Golden Store ' + data.version_name;
    })
    .catch(function () {
      if (count) count.textContent = '—';
      if (help) help.textContent = t('تحقّق من اتصالك بالإنترنت ثمّ حدّث الصفحة.');
    });
})();
