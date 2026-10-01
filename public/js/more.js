// "See all" page — the full list behind the chevron button at the end of a
// section header (e.g. "موصى به لك" on the home page → /more?section=recommended&type=app).
// Loads the section page by page and keeps loading as the user scrolls.
//
//   /more?section=recommended&type=app|game   home / games "recommended" row
//   /more?section=top&type=all                featured page "highest rated" list
//   /more?section=popular&type=all            featured page "most popular" grid
//   /more?section=similar&type=app|game&category=<slug>&exclude=<slug>   app page "similar" row
(function () {
  const S = window.Store;
  const { el, ico, api, getQuery, t } = S;
  const root = document.getElementById('root');

  // type: app | game | all (all = apps and games together, like the featured page)
  const type = ['game', 'all'].includes(getQuery('type')) ? getQuery('type') : 'app';

  // Sections that can be opened from a "see all" chevron. `title` is keyed by type ('_' = any type).
  const SECTIONS = {
    recommended: { sort: 'popular', title: { app: 'موصى به لك', game: 'ألعاب موصى بها', _: 'موصى به لك' } },
    popular: { sort: 'popular', title: { _: 'الأكثر رواجًا' } },
    // Sorted by rating, so everything after the first unrated app is unrated too → stop there.
    top: { sort: 'rating', ratedOnly: true, title: { _: 'الأعلى تقييماً' } },
    similar: { sort: 'popular', title: { game: 'ألعاب مماثلة', _: 'تطبيقات مماثلة' } },
  };
  const sectionKey = Object.prototype.hasOwnProperty.call(SECTIONS, getQuery('section')) ? getQuery('section') : 'recommended';
  const section = SECTIONS[sectionKey];
  const title = t(section.title[type] || section.title._);
  // "similar": same category as the app being viewed, without that app itself.
  const category = sectionKey === 'similar' ? getQuery('category').slice(0, 64) : '';
  const exclude = sectionKey === 'similar' ? getQuery('exclude').slice(0, 200) : '';

  // 60 is the API's maximum page size (fewest requests — for type=app the API reads the
  // whole collection on every call) and a multiple of every grid column count (3 / 4 / 6),
  // so there is no ragged last row between pages.
  const PAGE_SIZE = 60;

  function pageUrl(offset) {
    const q = [];
    if (type !== 'all') q.push(`type=${type}`);
    if (category) q.push(`category=${encodeURIComponent(category)}`);
    q.push(`sort=${section.sort}`, `limit=${PAGE_SIZE}`, `offset=${offset}`);
    return `/api/apps?${q.join('&')}`;
  }

  // Same grid/list preference as the home and games pages.
  const VIEW_KEY = type === 'game' ? 'gs_games_view' : 'gs_home_view';

  // Bottom bar highlight and the place "back" goes to when the page was opened directly.
  S.bottomNav(sectionKey === 'recommended' ? (type === 'game' ? 'games' : 'apps') : '');
  const fallbackHref = sectionKey === 'similar' && exclude ? `/app?slug=${encodeURIComponent(exclude)}`
    : sectionKey === 'recommended' ? (type === 'game' ? '/games' : '/')
    : '/featured';
  document.title = `${title} — Golden Store`;
  // We restore the scroll position ourselves (see the snapshot below).
  try { history.scrollRestoration = 'manual'; } catch (e) {}

  function goBack() {
    let sameOrigin = false;
    try { sameOrigin = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (e) {}
    if (sameOrigin && history.length > 1) history.back();
    else location.href = fallbackHref;
  }

  S.ready(() => {
    root.innerHTML = '';

    /* ----------------------------- view mode ----------------------------- */
    let mode = 'grid';
    try { if (localStorage.getItem(VIEW_KEY) === 'list') mode = 'list'; } catch (e) {}

    const gridBtn = el('button', { type: 'button', 'aria-label': t('شبكة'), title: t('شبكة') }, ico('grid', 'icon'));
    const listBtn = el('button', { type: 'button', 'aria-label': t('قائمة'), title: t('قائمة') }, ico('list', 'icon'));
    const toggle = el('div', { class: 'view-toggle', style: { display: 'none' } }, gridBtn, listBtn);

    /* -------------------------------- layout -------------------------------- */
    const bar = el('div', { class: 'topbar-nav more-bar' },
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('رجوع'), onclick: goBack }, ico('chevronEnd')),
      el('h1', { class: 'title' }, title),
      toggle,
    );
    const list = el('div', { class: 'more-list' });
    const end = el('div', { class: 'more-end' });          // spinner / retry button / scroll sentinel
    root.append(bar, el('div', { class: 'content more-content' }, list, end));

    /* -------------------------------- state -------------------------------- */
    const apps = [];                 // every app loaded so far (de-duplicated)
    const seen = new Set();
    let wrap = null;                 // the grid / list element currently holding the cards
    let offset = 0;
    let loading = false;
    let done = false;
    let io = null;

    const card = (a) => (mode === 'grid' ? S.gridCard(a) : S.listRow(a));

    // (Re)build every card for the current view mode.
    function paint() {
      wrap = el('div', { class: mode === 'grid' ? 'grid-list' : 'applist' });
      apps.forEach((a) => wrap.append(card(a)));
      list.innerHTML = '';
      list.append(wrap);
    }

    function syncToggle() {
      gridBtn.classList.toggle('on', mode === 'grid');
      listBtn.classList.toggle('on', mode === 'list');
      gridBtn.setAttribute('aria-pressed', String(mode === 'grid'));
      listBtn.setAttribute('aria-pressed', String(mode === 'list'));
    }
    function setMode(m) {
      if (m === mode) return;
      mode = m;
      try { localStorage.setItem(VIEW_KEY, m); } catch (e) {}
      syncToggle();
      if (apps.length) paint();
    }
    gridBtn.onclick = () => setMode('grid');
    listBtn.onclick = () => setMode('list');
    syncToggle();

    /* ------------------------------ end-of-list ------------------------------ */
    function showSpinner() {
      end.innerHTML = '';
      end.append(el('div', { class: 'spinner' }));
    }
    function showButton(label) {
      end.innerHTML = '';
      end.append(el('button', { class: 'btn btn-secondary', type: 'button', onclick: loadMore }, label));
    }

    /* ------------------------------- loading ------------------------------- */
    async function loadMore() {
      if (loading || done) return;
      loading = true;
      if (apps.length) {
        showSpinner();
      } else {                                              // first page (or a retry of it)
        end.innerHTML = '';
        list.innerHTML = '';
        list.append(S.skeletonList());
      }
      try {
        const res = await api(pageUrl(offset));
        const raw = (res && res.apps) || [];
        const total = res && typeof res.total === 'number' ? res.total : null;
        offset += raw.length;
        done = raw.length < PAGE_SIZE || (total !== null && offset >= total);

        let batch = raw;
        if (section.ratedOnly) {                              // keep only apps that have ratings
          const firstUnrated = raw.findIndex((a) => S.ratingCountOf(a) <= 0);
          if (firstUnrated !== -1) { batch = raw.slice(0, firstUnrated); done = true; }
        }

        const fresh = [];
        batch.forEach((a) => {
          if (!a || !a.slug || a.slug === exclude || seen.has(a.slug)) return;
          seen.add(a.slug);
          fresh.push(a);
        });

        if (!apps.length && !fresh.length) {               // nothing to show at all
          list.innerHTML = '';
          list.append(S.emptyState(
            t(type === 'game' ? 'لا توجد ألعاب بعد' : 'لا توجد تطبيقات بعد'), null, type === 'game' ? 'gamepad' : 'package'));
          end.innerHTML = '';
          return;
        }

        const first = !apps.length;
        fresh.forEach((a) => apps.push(a));
        if (first) { toggle.style.display = ''; paint(); }
        else fresh.forEach((a) => wrap.append(card(a)));

        end.innerHTML = '';
        if (done && io) io.disconnect();
        // No IntersectionObserver (very old WebView): fall back to a manual button.
        else if (!done && !io) showButton(t('تحميل المزيد'));
      } catch (err) {
        if (!apps.length) { list.innerHTML = ''; list.append(S.errorState(err)); }
        showButton(t('إعادة المحاولة'));
      } finally {
        loading = false;
        // Re-arm the observer: if the sentinel is still on screen (short page / tall
        // screen) this fires again straight away and pulls in the next page.
        if (io && !done && !end.querySelector('button')) { io.unobserve(end); io.observe(end); }
      }
    }

    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      }, { rootMargin: '0px 0px 800px 0px' });
      io.observe(end);
    }

    /* ------------------ remember the list for the Back button ------------------ */
    // Opening an app and pressing Back reloads this page. Restore the apps that
    // were loaded and the scroll position instead of starting again from the top.
    const SNAP_KEY = `gs_more_${[sectionKey, type, category, exclude].join('|')}`;
    const SNAP_TTL_MS = 30 * 60 * 1000;
    const slim = (a) => ({
      slug: a.slug, name: a.name, icon_url: a.icon_url || null, developer: a.developer || '', category: a.category || '',
      version_name: a.version_name || '', size_bytes: a.size_bytes || 0,
      rating: a.rating || 0, rating_count: a.rating_count || 0, stars: a.stars || 0,
    });
    function isBackNavigation() {
      try {
        const nav = performance.getEntriesByType('navigation')[0];
        return !!nav && nav.type === 'back_forward';
      } catch (e) { return false; }
    }
    function saveSnapshot() {
      if (!apps.length) return;
      try {
        sessionStorage.setItem(SNAP_KEY, JSON.stringify({
          at: Date.now(), y: window.scrollY || 0, offset, done, apps: apps.map(slim),
        }));
      } catch (e) {}
    }
    function readSnapshot() {
      try {
        const s = JSON.parse(sessionStorage.getItem(SNAP_KEY) || 'null');
        if (!s || !Array.isArray(s.apps) || !s.apps.length || Date.now() - s.at > SNAP_TTL_MS) return null;
        return s;
      } catch (e) { return null; }
    }
    window.addEventListener('pagehide', saveSnapshot);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveSnapshot(); });

    /* --------------------------------- start --------------------------------- */
    const snap = isBackNavigation() ? readSnapshot() : null;
    if (snap) {
      snap.apps.forEach((a) => {
        if (a && a.slug && !seen.has(a.slug)) { seen.add(a.slug); apps.push(a); }
      });
      offset = Number(snap.offset) || apps.length;
      done = !!snap.done;
      toggle.style.display = '';
      paint();
      window.scrollTo(0, Number(snap.y) || 0);
      if (done && io) io.disconnect();
      else if (!done && !io) showButton(t('تحميل المزيد'));
    } else {
      try { sessionStorage.removeItem(SNAP_KEY); } catch (e) {}
      loadMore();
    }
  });
})();
