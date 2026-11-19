/* Golden Store — notification center (full page).
   Layout: header → one-line summary → filter chips → grouped list.
   Only real notifications are listed (no placeholder rows). */
(function () {
  'use strict';
  const S = window.Store;
  if (!S) return;
  const { el, ico, t, formatDate } = S;
  const root = document.getElementById('root');

  const KINDS = [
    { key: 'all', label: 'الكل', icon: 'bell' },
    { key: 'new_app', label: 'تطبيق جديد', icon: 'package' },
    { key: 'update', label: 'تحديثات', icon: 'download' },
    { key: 'announcement', label: 'إعلان', icon: 'message' },
  ];

  function icon(name, extra) { return ico(name, extra || 'icon'); }

  function typeOf(n) {
    const v = n && n.type;
    return v === 'new_app' || v === 'update' || v === 'announcement' ? v : 'announcement';
  }

  function typeLabel(type) {
    return type === 'new_app' ? t('تطبيق جديد')
      : type === 'update' ? t('تحديث المتجر') : t('إعلان');
  }

  /* ------------------------------- pieces ------------------------------- */
  function summary(list) {
    const unread = list.filter((n) => !n.read_at && !n.seen).length;
    return el('section', { class: 'noi-sum' },
      el('div', { class: 'noi-sum-main' },
        el('span', { class: 'noi-sum-ico' }, icon('bell')),
        el('div', { class: 'noi-sum-text' },
          el('strong', null, S.formatCount(list.length)),
          el('span', null, t(list.length === 1 ? 'إشعار' : 'إشعارات')),
        ),
      ),
      el('span', { class: 'noi-sum-dot' + (unread ? ' is-new' : ''), title: t('غير مقروء') },
        unread ? S.formatCount(unread) : '✓'),
    );
  }

  function chips(active, counts, onPick) {
    const bar = el('div', { class: 'noi-chips', role: 'tablist' });
    KINDS.forEach((k) => {
      const n = k.key === 'all' ? counts.all : (counts[k.key] || 0);
      const b = el('button', {
        class: 'noi-chip' + (k.key === active ? ' on' : ''), type: 'button', role: 'tab',
        'aria-selected': k.key === active ? 'true' : 'false',
        onclick: () => onPick(k.key),
      },
        el('span', null, t(k.label)),
        el('span', { class: 'noi-chip-n' }, S.formatCount(n)),
      );
      bar.append(b);
    });
    return bar;
  }

  function item(n) {
    const type = typeOf(n);
    const updateData = type === 'update' && n.data && n.data.apk_url ? n.data : null;
    let node;
    if (updateData) {
      node = el('a', { class: 'noi-item is-update', href: '#',
        onclick: (e) => { e.preventDefault(); S.showUpdateDialog(updateData, { manual: true }); } });
    } else if (n.app_slug) {
      node = el('a', { class: `noi-item is-${type}`,
        href: `/app?slug=${encodeURIComponent(n.app_slug)}` });
    } else {
      node = el('div', { class: `noi-item is-${type}` });
    }
    node.append(
      el('span', { class: 'noi-ico' },
        icon(type === 'new_app' ? 'package' : type === 'update' ? 'download' : 'message')),
      el('span', { class: 'noi-info' },
        el('span', { class: 'noi-top' },
          el('strong', null, n.title || ''),
          el('span', { class: 'noi-type' }, typeLabel(type)),
        ),
        n.body ? el('span', { class: 'noi-body' }, n.body) : null,
        el('span', { class: 'noi-meta' }, formatDate(n.created_at)),
      ),
      updateData ? el('span', { class: 'noi-go' }, t('تحميل التحديث')) : null,
    );
    return node;
  }

  /* -------------------------------- shell -------------------------------- */
  function build() {
    root.innerHTML = '';
    root.className = 'shell';
    const body = el('main', { class: 'gs-page-body noi-body' });
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

  /* -------------------------------- render ------------------------------- */
  let all = [];
  let filter = 'all';

  function paint(body, refreshBtn) {
    body.innerHTML = '';
    const counts = { all: all.length, new_app: 0, update: 0, announcement: 0 };
    all.forEach((n) => { counts[typeOf(n)] = (counts[typeOf(n)] || 0) + 1; });
    counts.all = all.length;
    body.append(summary(all));
    const onPick = (k) => { filter = k; paint(body, refreshBtn); };
    body.append(chips(filter, counts, onPick));

    const list = filter === 'all' ? all : all.filter((n) => typeOf(n) === filter);
    if (!list.length) {
      const isFiltered = filter !== 'all';
      body.append(el('div', { class: 'noi-empty' },
        el('span', { class: 'noi-empty-ico' }, icon(isFiltered ? 'list' : 'bell')),
        el('h2', null, isFiltered ? t('لا توجد إشعارات في هذا القسم') : t('لا توجد إشعارات بعد')),
        el('p', null, isFiltered
          ? t('جرّب قسم «الكل».')
          : t('ستظهر هنا الإشعارات المنشورة والتنبيهات الآلية.')),
      ));
    } else {
      const wrap = el('div', { class: 'noi-list' });
      list.forEach((n) => wrap.append(item(n)));
      body.append(wrap);
    }
    refreshBtn.classList.remove('is-busy');
  }

  // The page marks notifications as seen when it loads, so the list it returns
  // is remembered here — the refresh button must not empty the page.
  let loadedOnce = false;

  async function load(body, refreshBtn) {
    refreshBtn.classList.add('is-busy');
    if (!loadedOnce) {
      body.innerHTML = '';
      body.append(el('div', { class: 'noi-empty' }, el('div', { class: 'spinner' }),
        el('p', null, t('جارٍ تحميل الإشعارات…'))));
    }
    try {
      const fresh = await S.loadNotificationsForPage();
      all = (fresh || []).filter(Boolean);
      loadedOnce = true;
    } catch (e) {
      if (!loadedOnce) all = [];
    }
    paint(body, refreshBtn);
    refreshBtn.onclick = () => load(body, refreshBtn);
  }

  S.ready(() => {
    const { body, refreshBtn } = build();
    load(body, refreshBtn);
  });
})();
