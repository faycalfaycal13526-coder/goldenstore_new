/* Golden Store — «نشر تطبيق أو لعبة» (round 42).
   The button that used to point nowhere now posts a REAL request to
   /api/publish-request, which lands in the dashboard's «الطلبات والبلاغات». */
(function () {
  'use strict';

  function t(s) {
    try { return window.GSI18N && window.GSI18N.t ? window.GSI18N.t(s) : s; }
    catch (e) { return s; }
  }

  function applyI18n() {
    try {
      var i18n = window.GSI18N;
      if (i18n && i18n.apply) { i18n.apply(); return; }
    } catch (e) {}
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (n) {
      var key = n.getAttribute('data-i18n');
      if (key) n.textContent = t(key);
    });
  }

  var form = document.getElementById('pubForm');
  var submit = document.getElementById('pubSubmit');
  var errEl = document.getElementById('pubErr');
  var okEl = document.getElementById('pubOk');
  if (!form || !submit) return;

  function fail(msg) { if (errEl) errEl.textContent = msg || ''; }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!errEl) return;
    var name = (document.getElementById('pubName').value || '').trim();
    var link = (document.getElementById('pubLink').value || '').trim();
    var contact = (document.getElementById('pubContact').value || '').trim();
    fail('');
    if (name.length < 2) { fail(t('اكتب اسم التطبيق أو اللعبة')); return; }
    if (!link && !contact) { fail(t('ضع رابط الملف أو بريداً للتواصل')); return; }

    submit.disabled = true;
    var original = submit.textContent;
    submit.textContent = t('جارٍ الإرسال…');

    fetch('/api/publish-request', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: document.getElementById('pubKind').value === 'game' ? 'game' : 'app',
        name: name,
        developer: (document.getElementById('pubDev').value || '').trim(),
        link: link,
        contact: contact,
        notes: (document.getElementById('pubNotes').value || '').trim(),
      }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error((data && data.error) || ('http_' + res.status));
        return data;
      });
    }).then(function () {
      form.style.display = 'none';
      if (okEl) okEl.classList.add('is-on');
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
    }).catch(function () {
      submit.disabled = false;
      submit.textContent = original;
      fail(t('تعذّر إرسال الطلب، حاول مرة أخرى.'));
    });
  });

  applyI18n();
})();
