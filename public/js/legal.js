/* Golden Store — shared legal UI helpers.
   - Mounts the site footer / compact legal-links row.
   - Builds the mandatory Terms + Privacy consent checkbox used before sign-in.
   Loaded by the legal pages and the login page (after lang.js).
------------------------------------------------------------------------------ */
(function () {
  'use strict';

  function T(s) {
    try { return window.GSI18N && window.GSI18N.t ? window.GSI18N.t(s) : s; }
    catch (e) { return s; }
  }

  var LINKS = [
    { key: 'about',   href: '/about',   label: 'من نحن' },
    { key: 'privacy', href: '/privacy', label: 'سياسة الخصوصية' },
    { key: 'terms',   href: '/terms',   label: 'شروط الخدمة' },
  ];

  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function link(href, text, cls, external) {
    var a = make('a', cls || null, text);
    a.href = href;
    if (external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
  }

  /* Compact list of legal links — used in the login gate. */
  function linksEl(active) {
    var nav = make('nav', 'legal-links');
    nav.setAttribute('aria-label', T('روابط قانونية'));
    nav.setAttribute('data-noi18n', '');
    LINKS.forEach(function (l) {
      var a = link(l.href, T(l.label), 'legal-link');
      if (l.key === active) { a.className = 'legal-link active'; a.setAttribute('aria-current', 'page'); }
      nav.appendChild(a);
    });
    return nav;
  }

  /* Full site footer — used by the three legal HTML pages. */
  function footerEl(active) {
    var f = make('footer', 'site-footer');
    f.setAttribute('data-noi18n', '');
    var inner = make('div', 'site-footer-inner');
    inner.appendChild(make('div', 'site-footer-brand', '© Golden Store — ' + T('جميع الحقوق محفوظة')));
    inner.appendChild(linksEl(active));
    var site = make('div', 'site-footer-site');
    site.appendChild(document.createTextNode(T('الموقع الرسمي') + ': '));
    var official = link('https://goldenstore.online', 'goldenstore.online', 'legal-link', true);
    official.setAttribute('dir', 'ltr');
    site.appendChild(official);
    inner.appendChild(site);
    f.appendChild(inner);
    return f;
  }

  /* Mandatory consent row. Links are siblings of the <label> (never inside it)
     so clicking a policy link navigates instead of toggling the checkbox. */
  function consentEl(prefix) {
    var id = (prefix || 'gs') + '-legal-consent';
    var row = make('div', 'legal-consent');
    row.setAttribute('data-noi18n', '');

    var box = make('input', 'legal-consent-box');
    box.type = 'checkbox';
    box.id = id;
    box.required = true;
    box.setAttribute('aria-required', 'true');

    var label = make('label', 'legal-consent-label', T('أوافق على'));
    label.htmlFor = id;

    row.appendChild(box);
    row.appendChild(label);
    row.appendChild(link('/terms', T('شروط الخدمة'), 'legal-link'));
    row.appendChild(make('span', 'legal-consent-and', T('و')));
    row.appendChild(link('/privacy', T('سياسة الخصوصية'), 'legal-link'));
    return row;
  }

  function accepted(row) {
    var box = row && row.querySelector('input[type="checkbox"]');
    return !!(box && box.checked);
  }

  /* Best-effort server-side consent receipt. Never blocks sign-in: the UI
     checkbox is the enforcement point, the API just validates + records it. */
  function recordConsent() {
    try {
      fetch('/api/legal/consent', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true, version: '2026-11-05' }),
      }).catch(function () {});
    } catch (e) {}
  }

  function mount() {
    // Mark hosts as curated: texts are already translated with T() above, and
    // lang.js must not machine-translate them a second time.
    ['siteFooter', 'legalLinks', 'consent'].forEach(function (id) {
      var h = document.getElementById(id);
      if (h) h.setAttribute('data-noi18n', '');
    });
    var footerHost = document.getElementById('siteFooter');
    if (footerHost && footerHost.getAttribute('data-mounted') !== '1') {
      footerHost.setAttribute('data-mounted', '1');
      var built = footerEl(footerHost.getAttribute('data-active') || '');
      while (built.firstChild) footerHost.appendChild(built.firstChild);
      footerHost.className = 'site-footer';
    }
    var linksHost = document.getElementById('legalLinks');
    if (linksHost && linksHost.getAttribute('data-mounted') !== '1') {
      linksHost.setAttribute('data-mounted', '1');
      linksHost.appendChild(linksEl(linksHost.getAttribute('data-active') || ''));
    }
    var consentHost = document.getElementById('consent');
    if (consentHost && consentHost.getAttribute('data-mounted') !== '1') {
      consentHost.setAttribute('data-mounted', '1');
      var row = consentEl('login');
      while (row.childNodes.length) consentHost.appendChild(row.firstChild);
      consentHost.className = 'legal-consent';
      consentHost.id = 'consent';
      consentHost.addEventListener('change', function (e) {
        if (e.target && e.target.type === 'checkbox' && e.target.checked) recordConsent();
      });
    }
  }

  window.GSLegal = {
    LINKS: LINKS,
    links: LINKS,
    linksEl: linksEl,
    footerEl: footerEl,
    consentEl: consentEl,
    accepted: accepted,
    recordConsent: recordConsent,
    mount: mount,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
