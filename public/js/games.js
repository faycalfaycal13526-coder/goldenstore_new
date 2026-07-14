// Games page — same Play-style layout as home, but restricted to type=game.
(function () {
  const S = window.Store;
  const { el, ico, api, t } = S;
  const root = document.getElementById('root');

  S.bottomNav('games');

  const TOP_TABS = [
    { key: 'foryou', label: 'محتوى يهمّك' },
    { key: 'top', label: 'الأكثر رواجًا' },
    { key: 'rated', label: 'الأعلى تقييماً' },
    { key: 'categories', label: 'الفئات' },
  ];

  S.ready((user) => {
    root.innerHTML = '';
    root.append(S.topbarSearch(user));

    let topTab = 'foryou';
    const tabsBar = el('div', { class: 'tabs' });
    const content = el('div', { class: 'content' });

    function renderTabs() {
      tabsBar.innerHTML = '';
      TOP_TABS.forEach((tab) => {
        tabsBar.append(el('button', {
          class: `tab ${tab.key === topTab ? 'active' : ''}`,
          onclick: () => { if (topTab !== tab.key) { topTab = tab.key; renderTabs(); renderContent(); } },
        }, t(tab.label)));
      });
    }

    root.append(tabsBar, content);
    renderTabs();
    renderContent();

    function q(params) { return `/api/apps?type=game&${params}`; }

    async function renderContent() {
      content.innerHTML = '';
      content.append(topTab === 'categories' ? S.skeletonList() : S.skeletonHome());
      try {
        if (topTab === 'categories') return renderCategories();
        if (topTab === 'top') return renderTop();
        if (topTab === 'rated') return renderTopRated();
        return renderForYou();
      } catch (err) {
        content.innerHTML = '';
        content.append(S.errorState(err));
      }
    }

    async function renderCategories() {
      const { categories } = await api('/api/categories?type=game');
      content.innerHTML = '';
      const list = el('div', { class: 'applist', style: { marginTop: '8px' } });
      categories.forEach((c) => {
        list.append(el('a', { href: `/search?category=${c.slug}`, class: 'approw' },
          el('div', { class: 'art', style: { background: 'var(--surface-2)' } }, ico(c.icon, 'icon icon-lg')),
          el('div', { class: 'info' },
            el('div', { class: 'nm' }, c.name),
            el('div', { class: 'sub' }, `${c.count || 0} ${t('لعبة')}`),
          ),
          ico('chevronStart', 'icon'),
        ));
      });
      content.append(el('div', { class: 'section' }, list));
    }

    async function renderForYou() {
      const [recent, popular, top] = await Promise.all([
        api(q('sort=recent&limit=60')).catch(() => ({ apps: [] })),
        api(q('sort=popular&limit=30')).catch(() => ({ apps: [] })),
        api(q('sort=rating&limit=30')).catch(() => ({ apps: [] })),
      ]);
      content.innerHTML = '';

      const recentApps = recent.apps || [];
      const popularApps = popular.apps || [];
      const topApps = top.apps || [];

      if (!recentApps.length && !popularApps.length) {
        content.append(S.emptyState(t('لا توجد ألعاب بعد'), t('ميّز تطبيقاً كـ«لعبة» من لوحة التحكم لتظهر هنا.'), 'gamepad'));
        return;
      }

      const carouselApps = pickCarousel([...recentApps, ...popularApps, ...topApps]);
      if (carouselApps.length) content.append(S.featureCarousel(carouselApps));

      const recommended = (popularApps.length ? popularApps : recentApps).slice(0, 12);
      content.append(posterSection(t('ألعاب موصى بها'), recommended));

      const usedSlugs = new Set(recommended.map((a) => a.slug));
      carouselApps.forEach((a) => usedSlugs.add(a.slug));
      const rest = recentApps.filter((a) => !usedSlugs.has(a.slug));
      content.append(listSection(t('قد يعجبك أيضاً'), rest));
    }

    async function renderTop() {
      const res = await api(q('sort=popular&limit=60'));
      const apps = (res.apps || []).slice(0, 50);
      content.innerHTML = '';
      if (!apps.length) { content.append(S.emptyState(t('لا توجد ألعاب بعد'), null, 'gamepad')); return; }
      content.append(rankedList(apps));
    }

    async function renderTopRated() {
      const res = await api(q('sort=rating&limit=60'));
      const apps = (res.apps || []).filter((a) => S.ratingCountOf(a) > 0).slice(0, 50);
      content.innerHTML = '';
      if (!apps.length) { content.append(S.emptyState(t('لا توجد ألعاب مقيّمة بعد'), t('قيّم الألعاب لتظهر هنا الأعلى تقييماً.'), 'gamepad')); return; }
      content.append(rankedList(apps));
    }
  });

  function rankedList(apps) {
    const list = el('div', { class: 'applist' });
    apps.forEach((a, i) => {
      const row = S.listRow(a);
      const rank = el('div', { style: { width: '24px', textAlign: 'center', fontWeight: '700', color: 'var(--text-2)', fontSize: '15px', flexShrink: '0' } }, String(i + 1));
      row.insertBefore(rank, row.firstChild);
      list.append(row);
    });
    return el('div', { class: 'section' }, list);
  }

  function pickCarousel(pool) {
    const seen = new Set();
    const withFeat = [];
    const without = [];
    pool.forEach((a) => {
      if (!a || seen.has(a.slug)) return;
      seen.add(a.slug);
      (a.feature_url ? withFeat : without).push(a);
    });
    return [...withFeat, ...without].slice(0, 8);
  }

  function posterSection(title, apps) {
    if (!apps || !apps.length) return el('span');
    const row = el('div', { class: 'hrow' });
    apps.forEach((a) => row.append(S.posterCard(a)));
    return el('div', { class: 'section' },
      el('div', { class: 'section-head' }, el('h2', null, title), ico('chevronStart', 'icon more')),
      row,
    );
  }

  function listSection(title, apps) {
    if (!apps || !apps.length) return el('span');
    const list = el('div', { class: 'applist' });
    apps.forEach((a) => list.append(S.listRow(a)));
    return el('div', { class: 'section' },
      el('div', { class: 'section-head' }, el('h2', null, title)),
      list,
    );
  }
})();
