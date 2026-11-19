/* Golden Store — notification center («مركز إعلام»).
   Layout follows the owner's reference: a compact header, three quick links,
   then one dense reverse-chronological feed where every row is
   [icon] [title / time · «انقر للتنزيل»] [red unread dot].
   Only real notifications are listed — nothing is fabricated. */
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
  function tsOf(n) { return Number((n && n.created_at) || 0) || 0; }
  /* What a row really IS, independent of the storage `type`:
       support → the user's support conversation (own message or the reply)
       like    → a like received on the user's review
       official→ everything the store itself publishes (notices + app updates) */
  function kindOf(n) {
    const d = (n && n.data) || {};
    const extra = d.extra && typeof d.extra === 'object' ? d.extra : {};
    const kind = String(d.kind || extra.kind || '');
    if (kind === 'support' || kind === 'support_reply') return 'support';
    if (kind === 'like') return 'like';
    if (/^\/support(\?|$)/.test(String(d.click_url || extra.click_url || ''))) return 'support';
    return 'official';
  }
  function isUnread(n) { return tsOf(n) > (S.notifSeenAt ? S.notifSeenAt() : 0); }

  /* «منذ ٣٨ دقيقة» / «منذ ٦ ساعات» / a plain date — relative, Play style. */
  function when(ts) {
    if (!ts) return '';
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
    const mins = Math.floor(diff / 60);
    const t1 = (ar) => t(ar);
    if (mins < 1) return t1('الآن');
    if (mins < 60) return t1('منذ') + ' ' + S.formatCount(mins) + ' ' + t1(mins === 1 ? 'دقيقة' : 'دقائق');
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t1('منذ') + ' ' + S.formatCount(hours) + ' ' + t1(hours === 1 ? 'ساعة' : 'ساعات');
    const days = Math.floor(hours / 24);
    if (days < 7) return t1('منذ') + ' ' + S.formatCount(days) + ' ' + t1(days === 1 ? 'يوم' : 'أيام');
    return formatDate(ts);
  }

  /* ---------------------------- quick links ---------------------------- */
  let filter = '';
  function quickBar(onPick) {
    /* The three quick actions filter the SAME real feed. Their names describe
       exactly what each button shows — nothing decorative:
         announcement → official notices from the store AND support messages
         update       → «رسائل الدعم»  (the user's own support conversation)
         new_app      → «الإعجابات»    (a like received on the user's review) */
    const items = [
      { key: 'official', label: 'اشعار رسمي', icon: 'bell', tone: 'violet' },
      { key: 'support', label: 'رسائل الدعم', icon: 'message', tone: 'amber' },
      { key: 'like', label: 'الإعجابات', icon: 'heart', tone: 'rose' },
    ];
    const bar = el('div', { class: 'noi-quick', role: 'tablist' });
    items.forEach((it) => {
      bar.append(el('button', {
        class: 'noi-quick-item' + (filter === it.key ? ' is-on' : ''), type: 'button',
        role: 'tab', 'data-tone': it.tone,
        'aria-selected': filter === it.key ? 'true' : 'false',
        onclick: () => onPick(it.key),
      },
        el('span', { class: 'noi-quick-ico' }, icon(it.icon)),
        el('span', { class: 'noi-quick-label' }, t(it.label)),
      ));
    });
    return bar;
  }

  /* ------------------------------- rows -------------------------------- */
  /* The row icon is the real app icon when the notification carries one
     (app_icon / data.icon_url / a known catalog entry), otherwise a type glyph. */
  function artFor(n, type) {
    const art = el('span', { class: 'noi-row-art' });
    const url = (n && (n.app_icon || n.icon_url || (n.data && (n.data.icon_url || n.data.app_icon)))) || '';
    if (url) {
      const img = el('img', { src: String(url), alt: '', loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', () => {
        img.remove();
        art.append(icon(kindOf(n) === 'like' ? 'heart'
          : kindOf(n) === 'support' ? 'message'
          : type === 'new_app' ? 'package' : type === 'update' ? 'download' : 'bell'));
      });
      art.append(img);
      art.classList.add('has-img');
      return art;
    }
    art.append(icon(kindOf(n) === 'like' ? 'heart'
      : kindOf(n) === 'support' ? 'message'
      : type === 'new_app' ? 'package' : type === 'update' ? 'download' : 'bell'));
    return art;
  }

  /* Support notifications: tapping opens the SAME conversation thread, so the
     row is a real action and never a dead end. The target is taken from the
     row itself (data.click_url / data.thread_id) with a safe fallback. */
  function supportTarget(n) {
    const d = (n && n.data) || {};
    const extra = d.extra && typeof d.extra === 'object' ? d.extra : {};
    const raw = String(d.click_url || extra.click_url || '');
    if (/^\/support(\?|$)/.test(raw)) return raw;
    const thread = String(d.thread_id || extra.thread_id || d.ref || '');
    return thread ? `/support?thread=${encodeURIComponent(thread)}` : '/support';
  }

  function row(n) {
    const type = typeOf(n);
    const updateData = type === 'update' && n.data && n.data.apk_url ? n.data : null;
    const unread = isUnread(n);
    /* Support rows carry data.kind = support|support_reply; they must open the
       chat, not an app page. */
    const isSupport = kindOf(n) === 'support';
    let node;
    if (isSupport && !updateData) {
      node = el('a', { class: `noi-row is-support`, href: supportTarget(n),
        onclick: () => markRead(n) });
    } else if (updateData) {
      node = el('a', { class: 'noi-row is-update', href: '#',
        onclick: (e) => { e.preventDefault(); markRead(n); S.showUpdateDialog(updateData, { manual: true }); } });
    } else if (n.app_slug) {
      node = el('a', { class: `noi-row is-${type}`, href: `/app?slug=${encodeURIComponent(n.app_slug)}`,
        onclick: () => markRead(n) });
    } else {
      node = el('div', { class: `noi-row is-${type}` });
    }
    node.append(
      artFor(n, type),
      el('span', { class: 'noi-row-info' },
        el('span', { class: 'noi-row-title' }, n.title || t('إشعار')),
        el('span', { class: 'noi-row-sub' },
          el('span', { class: 'noi-row-time' }, when(tsOf(n))),
          el('span', { class: 'noi-row-cta' },
            updateData ? t('انقر للتنزيل')
              : isSupport ? t('انقر لفتح المحادثة')
              : (n.app_slug ? t('انقر للفتح') : t('انقر للتفاصيل'))),
        ),
      ),
      el('span', { class: 'noi-dot' + (unread ? ' is-new' : ''), 'aria-hidden': 'true' }),
    );
    node.setAttribute('data-unread', unread ? '1' : '0');
    return node;
  }

  function markRead(n) {
    try {
      const ts = tsOf(n);
      if (ts && S.setNotifSeenAt) S.setNotifSeenAt(ts);
    } catch (e) {}
  }

  /* -------------------------------- shell ------------------------------- */
  function build() {
    root.innerHTML = '';
    root.className = 'shell';
    const body = el('main', { class: 'gs-page-body noi-body' });
    const refreshBtn = el('button', {
      class: 'noi-refresh', type: 'button', title: t('تحديث الإشعارات'),
      'aria-label': t('تحديث الإشعارات'),
    }, icon('refresh'));
    root.append(
      el('div', { class: 'noi-head' },
        el('h1', { class: 'noi-title' }, t('مركز إعلام')),
        el('button', {
          class: 'noi-back', type: 'button', 'aria-label': t('رجوع'), title: t('رجوع'),
          onclick: () => (history.length > 1 ? history.back() : (location.href = '/')),
        }, icon('arrowRight')),
        refreshBtn,
      ),
      body,
    );
    S.bottomNav('apps');
    return { body, refreshBtn };
  }

  /* ------------------------------- render ------------------------------- */
  let all = [];
  let loadedOnce = false;

  function paint(body, refreshBtn) {
    body.innerHTML = '';
    body.append(quickBar((key) => {
      filter = filter === key ? '' : key;
      paint(body, refreshBtn);
      try {
        const feed = body.querySelector('.noi-feed');
        if (feed && feed.scrollIntoView) feed.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } catch (e) {}
    }));
    const list = el('div', { class: 'noi-feed' });
    if (!all.length) {
      list.append(el('div', { class: 'noi-empty' },
        el('span', { class: 'noi-empty-ico' }, icon('bell')),
        el('h2', null, t('لا توجد إشعارات بعد')),
        el('p', null, t('ستظهر هنا الإشعارات المنشورة والتنبيهات الآلية.')),
      ));
    } else {
      const shown = (filter ? all.filter((n) => kindOf(n) === filter) : all)
        .slice().sort((a, b) => tsOf(b) - tsOf(a));
      if (!shown.length) {
        const supportEmpty = filter === 'support';
        const likeEmpty = filter === 'like';
        list.append(el('div', { class: 'noi-empty' },
          el('span', { class: 'noi-empty-ico' }, icon(supportEmpty ? 'message' : likeEmpty ? 'heart' : 'list')),
          el('h2', null, t(supportEmpty ? 'لا توجد رسائل دعم بعد'
            : likeEmpty ? 'لا توجد إعجابات بعد'
            : 'لا توجد إشعارات في هذا القسم')),
          el('p', null, t(supportEmpty
            ? 'ستظهر هنا رسائلك مع الدعم وردود الإدارة عليها.'
            : likeEmpty
              ? 'ستظهر هنا إعجابات المستخدمين بتعليقاتك.'
              : 'اضغط نفس الزر مرة أخرى لعرض كل الإشعارات.')),
          supportEmpty ? el('a', { class: 'btn btn-secondary noi-empty-cta', href: '/support' },
            t('افتح صفحة الدعم')) : null,
        ));
      }
      shown.forEach((n) => list.append(row(n)));
    }
    body.append(list);
    refreshBtn.classList.remove('is-busy');
  }

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
