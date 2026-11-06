/* Golden Store — standalone full-screen offline page.
   Intentionally independent of store.js / Firebase so it renders even when
   the network (and the auth SDK CDN) is unavailable. */
(function () {
  'use strict';
  var t = (window.GSI18N && window.GSI18N.t) || function (s) { return s; };
  var icon = (window.GSIcons && window.GSIcons.iconEl) || function () { return document.createElement('span'); };
  var root = document.getElementById('root');
  if (!root) return;

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'onclick') n.addEventListener('click', v);
      else n.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  var online = typeof navigator !== 'undefined' && navigator.onLine !== false;
  var steps = [
    t('تأكّد من تشغيل الواي فاي أو بيانات الهاتف.'),
    t('جرّب فتح صفحة أخرى للتأكد من عمل الإنترنت.'),
    t('أوقف VPN أو البروكسي مؤقتاً ثم أعد المحاولة.'),
  ];

  var card = el('div', { class: 'gs-offline-card', role: 'alert', 'aria-live': 'assertive', 'data-noi18n': '' }, [
    el('div', { class: 'gs-offline-logo' }, [
      el('img', { src: '/images/logo.png', alt: 'Golden Store', draggable: 'false' }),
    ]),
    el('div', { class: 'gs-offline-status' + (online ? ' is-online' : '') }, [
      el('span', { class: 'dot' }), t(online ? 'الاتصال غير مستقر' : 'أنت غير متصل'),
    ]),
    el('span', { class: 'gs-offline-badge' }, [t('لا يوجد اتصال بالإنترنت')]),
    el('h1', { class: 'gs-offline-title' }, [t('تعذّر الاتصال بالخادم')]),
    el('p', { class: 'gs-offline-hint' }, [t('تحقّق من اتصالك بالإنترنت ثم أعد المحاولة.')]),
    el('ol', { class: 'gs-offline-steps' }, steps.map(function (step, i) {
      return el('li', null, [el('span', { class: 'n' }, [String(i + 1)]), el('span', null, [step])]);
    })),
    el('div', { class: 'gs-offline-actions' }, [
      el('button', { class: 'gs-offline-retry', type: 'button',
        onclick: function () { try { location.reload(); } catch (e) {} } }, [
        icon('refresh', 'icon'), t('إعادة المحاولة'),
      ]),
      el('a', { class: 'gs-offline-home', href: '/' }, [
        icon('home', 'icon'), t('العودة إلى الرئيسية'),
      ]),
    ]),
  ]);

  root.appendChild(el('div', { class: 'gs-offline-wrap', 'data-noi18n': '' }, [card]));

  // Keep the status fresh if the connection comes back while the page is open.
  window.addEventListener('online', function () { try { location.reload(); } catch (e) {} });
})();
