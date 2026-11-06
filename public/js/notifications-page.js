/* Golden Store — standalone full-page notification center.
   Replaces the old small dialog. Uses the same curated baseline as the bell. */
(function () {
  'use strict';
  const S = window.Store;
  if (!S) return;
  const { el, ico, t, formatDate } = S;
  const root = document.getElementById('root');

  function icon(name, extra) { return ico(name, extra || 'icon'); }

  function typeOf(n) {
    const v = n && n.type;
    return v === 'new_app' || v === 'update' || v === 'announcement' ? v : 'announcement';
  }

  function summaryCard(count) {
    return el('section', { class: 'gs-notif-summary', 'data-noi18n': '' },
      el('div', { class: 'gs-notif-summary-ico' }, icon('bell')),
      el('div', null,
        el('h2', null, t('مركز الإشعارات')),
        el('p', null, t('آخر أخبار المتجر والتحديثات والتطبيقات الجديدة.')),
      ),
      el('span', { class: 'gs-check-version', style: { margin: '0', flex: '0 0 auto' } }, String(count)),
    );
  }

  function item(n) {
    const type = typeOf(n);
    let node;
    const updateData = type === 'update' && n.data && n.data.apk_url ? n.data : null;
    if (updateData) {
      node = el('a', { class: `gs-notif-item is-update`, href: '#', 'data-noi18n': '',
        onclick: (e) => { e.preventDefault(); S.showUpdateDialog(updateData); } });
    } else if (n.app_slug) {
      node = el('a', { class: `gs-notif-item is-${type}`, 'data-noi18n': '',
        href: `/app?slug=${encodeURIComponent(n.app_slug)}` });
    } else {
      node = el('div', { class: `gs-notif-item is-${type}`, 'data-noi18n': '' });
    }
    const label = type === 'new_app' ? t('تطبيق جديد')
      : type === 'update' ? t('تحديث المتجر') : t('إعلان');
    node.append(
      el('div', { class: 'gs-notif-ico' },
        icon(type === 'new_app' ? 'package' : type === 'update' ? 'download' : 'bell')),
      el('div', { class: 'gs-notif-info' },
        el('div', { class: 'gs-notif-top' },
          el('strong', null, n.title || ''),
          el('span', { class: 'gs-notif-type' }, label),
        ),
        n.body ? el('div', { class: 'gs-notif-body' }, n.body) : null,
        el('div', { class: 'gs-notif-meta' }, formatDate(n.created_at)),
        updateData ? el('div', { class: 'gs-notif-meta' }, t('تحميل التحديث')) : null,
      ),
    );
    return node;
  }

  function build() {
    root.innerHTML = '';
    root.className = 'shell';
    const body = el('main', { class: 'gs-page-body' });
    const refreshBtn = el('button', {
      class: 'icon-btn', type: 'button', title: t('تحديث الإشعارات'),
      'aria-label': t('تحديث الإشعارات'),
    }, icon('refresh'));
    root.append(
      el('div', { class: 'gs-page-head' },
        el('a', { class: 'icon-btn', href: '/', 'aria-label': t('العودة إلى الرئيسية'), title: t('العودة إلى الرئيسية') },
          icon('chevronEnd')),
        el('img', { class: 'gs-page-logo', src: '/images/logo.png', alt: 'Golden Store' }),
        el('h1', { class: 'gs-page-title' }, t('مركز الإشعارات')),
        refreshBtn,
      ),
      body,
    );
    S.bottomNav('apps');
    return { body, refreshBtn };
  }

  async function load(body, refreshBtn) {
    body.innerHTML = '';
    body.append(el('div', { class: 'gs-notif-empty' }, el('div', { class: 'spinner' }),
      el('p', null, t('جارٍ تحميل الإشعارات…'))));
    let list = [];
    try { list = await S.loadNotificationsForPage(); } catch (e) { list = []; }
    body.innerHTML = '';
    body.append(summaryCard(list.length));
    if (!list.length) {
      body.append(el('div', { class: 'gs-notif-empty', 'data-noi18n': '' },
        icon('bell', 'icon'),
        el('h2', null, t('لا توجد إشعارات بعد')),
        el('p', null, t('ستظهر هنا الإشعارات المنشورة والتنبيهات الآلية.')),
      ));
    } else {
      const wrap = el('div', { class: 'gs-notif-list' });
      list.forEach((n) => wrap.append(item(n)));
      body.append(wrap);
    }
    const checkBtn = el('button', { class: 'gs-notif-recheck', type: 'button' },
      icon('refresh'), t('التحقق من وجود تحديثات'));
    checkBtn.addEventListener('click', () => S.checkForUpdates({ button: checkBtn }));
    body.append(checkBtn);
    refreshBtn.onclick = () => load(body, refreshBtn);
  }

  S.ready(() => {
    const { body, refreshBtn } = build();
    load(body, refreshBtn);
  });
})();
