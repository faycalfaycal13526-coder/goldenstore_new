// Advanced search — Google Play-style filters, debounced instant results and
// keyboard-accessible autocomplete. All updates happen without a page reload.
(function () {
  const S = window.Store;
  const { el, ico, api, getQuery, t } = S;
  const root = document.getElementById('root');
  S.bottomNav('');

  const PAGE_SIZE = 24;
  const RESULT_DEBOUNCE = 280;   // ms — instant search
  const SUGGEST_DEBOUNCE = 130;  // ms — autocomplete is a little quicker

  const SORTS = [
    { key: 'recent',  label: 'الأحدث' },
    { key: 'popular', label: 'الأكثر شعبية' },
    { key: 'rating',  label: 'الأعلى تقييماً' },
    { key: 'name',    label: 'الاسم' },
  ];
  const TYPES = [
    { key: '',      label: 'الكل' },
    { key: 'app',   label: 'التطبيقات' },
    { key: 'game',  label: 'الألعاب' },
  ];
  const RATINGS = [
    { key: 0,   label: 'الكل' },
    { key: 3,   label: '3+' },
    { key: 4,   label: '4+' },
    { key: 4.5, label: '4.5+' },
  ];

  function readUrl() {
    const u = new URLSearchParams(location.search);
    const rawRating = Number(u.get('min_rating'));
    return {
      q: (u.get('q') || '').trim().slice(0, 120),
      category: (u.get('category') || '').trim(),
      type: TYPES.some((x) => x.key && x.key === u.get('type')) ? u.get('type') : '',
      sort: SORTS.some((x) => x.key === u.get('sort')) ? u.get('sort') : 'recent',
      min_rating: RATINGS.some((x) => x.key && x.key === rawRating) ? rawRating : 0,
    };
  }

  const state = Object.assign(readUrl(), { offset: 0, view: 'grid' });
  try { if (localStorage.getItem('gs_search_view') === 'list') state.view = 'list'; } catch (e) {}

  /* ---------------------------- DOM skeleton ---------------------------- */
  const input = el('input', {
    class: 'ph adv-input', type: 'search', placeholder: t('ابحث عن التطبيقات والألعاب'),
    value: state.q, autocomplete: 'off', spellcheck: 'false',
    'aria-label': t('بحث'), 'aria-autocomplete': 'list', 'aria-controls': 'advSuggest',
  });
  const suggestBox = el('div', { class: 'search-suggest adv-suggest', id: 'advSuggest', role: 'listbox' });
  const pill = el('div', { class: 'search-pill adv-pill' },
    el('button', { class: 's-ico', type: 'button', 'aria-label': t('رجوع'),
      onclick: () => (history.length > 1 ? history.back() : (location.href = '/')) }, ico('chevronEnd')),
    input,
    el('button', { class: 's-ico', type: 'button', 'aria-label': t('مسح'),
      onclick: () => { input.value = ''; state.q = ''; onQueryChange(true); input.focus(); } }, ico('close')),
  );
  const pillWrap = el('div', { class: 'adv-pill-wrap' }, pill, suggestBox);
  const filterToggle = el('button', {
    class: 'icon-btn adv-filter-toggle', type: 'button',
    'aria-label': t('الفلاتر'), title: t('الفلاتر'),
    'aria-expanded': 'false', 'aria-controls': 'advFilters',
  }, ico('settings'));
  const bar = el('div', { class: 'topbar adv-topbar' },
    el('div', { class: 'topbar-home', style: { gap: '8px', height: 'auto' } }, pillWrap, filterToggle),
  );

  const sidebar = el('aside', { class: 'adv-sidebar', id: 'advFilters', 'aria-label': t('تصفية النتائج') });
  const toolbar = el('div', { class: 'adv-toolbar' });
  const resultsEl = el('div', { class: 'adv-results' });
  const moreWrap = el('div', { class: 'adv-more' });
  const layout = el('div', { class: 'adv-layout' },
    sidebar,
    el('section', { class: 'adv-main' }, toolbar, resultsEl, moreWrap),
  );

  /* ------------------------------ Filters -------------------------------- */
  function field(label, control) {
    return el('div', { class: 'adv-field' }, el('label', { class: 'adv-label' }, t(label)), control);
  }
  function segmented(items, get, set) {
    const wrap = el('div', { class: 'adv-seg', role: 'group' });
    const buttons = items.map((it) => el('button', {
      type: 'button', class: 'adv-seg-btn', 'data-key': String(it.key),
      onclick: () => { if (get() === it.key) return; set(it.key); paint(); onFilterChange(); },
    }, t(it.label)));
    function paint() {
      const cur = String(get());
      buttons.forEach((b) => {
        const on = b.getAttribute('data-key') === cur;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
    }
    buttons.forEach((b) => wrap.append(b));
    paint();
    return wrap;
  }

  const catSelect = el('select', { class: 'adv-select', 'aria-label': t('التصنيف') },
    el('option', { value: '' }, t('كل التصنيفات')));
  const sortSelect = el('select', { class: 'adv-select', 'aria-label': t('الترتيب') },
    ...SORTS.map((s) => el('option', { value: s.key }, t(s.label))));
  const typeSeg = segmented(TYPES, () => state.type, (v) => { state.type = v; });
  const ratingSeg = segmented(RATINGS, () => state.min_rating, (v) => { state.min_rating = v; });
  const resetBtn = el('button', {
    class: 'btn btn-outline btn-block adv-reset', type: 'button',
    onclick: () => {
      state.q = ''; state.category = ''; state.type = ''; state.sort = 'recent'; state.min_rating = 0;
      input.value = ''; catSelect.value = ''; sortSelect.value = 'recent';
      syncControls(); syncUrl(); run();
    },
  }, ico('refresh', 'icon icon-sm'), t('مسح الفلاتر'));

  sidebar.append(
    el('div', { class: 'adv-sidebar-head' },
      el('h2', null, t('تصفية النتائج')),
      el('button', { class: 'icon-btn adv-sidebar-close', type: 'button', 'aria-label': t('إغلاق'),
        onclick: () => toggleFilters(false) }, ico('close')),
    ),
    field('التصنيف', catSelect),
    field('النوع', typeSeg),
    field('الترتيب', sortSelect),
    field('أقل تقييم', ratingSeg),
    resetBtn,
  );

  catSelect.addEventListener('change', () => { state.category = catSelect.value; onFilterChange(); });
  sortSelect.addEventListener('change', () => { state.sort = sortSelect.value; onFilterChange(); });
  filterToggle.addEventListener('click', () => toggleFilters(!sidebar.classList.contains('open')));

  function toggleFilters(open) {
    sidebar.classList.toggle('open', open);
    filterToggle.setAttribute('aria-expanded', String(open));
  }
  function syncControls() {
    catSelect.value = state.category;
    sortSelect.value = state.sort;
    // Rebuild pressed states from data-key (used after reset / back navigation).
    typeSeg.querySelectorAll('.adv-seg-btn').forEach((b) => {
      const on = b.getAttribute('data-key') === String(state.type);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
    ratingSeg.querySelectorAll('.adv-seg-btn').forEach((b) => {
      const on = b.getAttribute('data-key') === String(state.min_rating);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
  }

  /* --------------------------- Categories load --------------------------- */
  let categoriesLoaded = false;
  async function loadCategories() {
    if (categoriesLoaded) return;
    try {
      const { categories } = await api('/api/categories');
      const appsGroup = el('optgroup', { label: t('التطبيقات') });
      const gamesGroup = el('optgroup', { label: t('الألعاب') });
      (categories || []).forEach((c) => {
        const opt = el('option', { value: c.slug }, S.categoryName(c.slug) || t(c.name));
        (String(c.slug).indexOf('game_') === 0 ? gamesGroup : appsGroup).append(opt);
      });
      catSelect.append(appsGroup, gamesGroup);
      catSelect.value = state.category;
      categoriesLoaded = true;
    } catch (e) { /* filters still work without the list */ }
  }

  /* ----------------------------- URL sync -------------------------------- */
  function queryString(extra) {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category) p.set('category', state.category);
    if (state.type) p.set('type', state.type);
    if (state.sort && state.sort !== 'recent') p.set('sort', state.sort);
    if (state.min_rating) p.set('min_rating', String(state.min_rating));
    if (extra && extra.offset) p.set('offset', String(state.offset));
    return p.toString();
  }
  function syncUrl() {
    const qs = queryString();
    try { history.replaceState(null, '', '/search' + (qs ? '?' + qs : '')); } catch (e) {}
  }

  /* --------------------------- Results rendering ------------------------- */
  // Store.api() wraps an AbortError into Error('timeout') with status 0.
  function isAbort(err) {
    return !!err && (err.name === 'AbortError' || (err.status === 0 && err.message === 'timeout'));
  }

  let seq = 0;
  let resultCtrl = null;
  let lastTotal = 0;
  let lastHasMore = false;

  function activeChips() {
    const chips = [];
    const add = (label, clear) => chips.push(el('button', {
      class: 'adv-chip', type: 'button', onclick: () => { clear(); syncControls(); syncUrl(); run(); },
    }, label, ico('close', 'icon icon-sm')));
    if (state.q) add(`«${state.q}»`, () => { state.q = ''; input.value = ''; });
    if (state.category) add(S.categoryName(state.category) || state.category, () => { state.category = ''; });
    if (state.type) add(t(state.type === 'game' ? 'الألعاب' : 'التطبيقات'), () => { state.type = ''; });
    if (state.min_rating) add(`${state.min_rating}+ ★`, () => { state.min_rating = 0; });
    return chips;
  }

  function paintToolbar() {
    toolbar.textContent = '';
    const count = el('div', { class: 'adv-count' },
      t('نتائج البحث') + ' · ' + S.formatCount(lastTotal) + ' ' + t('نتيجة'));
    const chips = el('div', { class: 'adv-chips' }, ...activeChips());
    const views = el('div', { class: 'view-toggle adv-view' },
      el('button', { type: 'button', class: state.view === 'grid' ? 'on' : '', 'aria-label': t('شبكة'),
        title: t('شبكة'), onclick: () => setView('grid') }, ico('grid')),
      el('button', { type: 'button', class: state.view === 'list' ? 'on' : '', 'aria-label': t('قائمة'),
        title: t('قائمة'), onclick: () => setView('list') }, ico('list')),
    );
    toolbar.append(count, chips, views);
  }
  function setView(v) {
    if (state.view === v) return;
    state.view = v;
    try { localStorage.setItem('gs_search_view', v); } catch (e) {}
    renderApps(currentApps, false);
  }

  let currentApps = [];
  function renderApps(apps, append) {
    if (!append) { resultsEl.textContent = ''; currentApps = []; }
    currentApps = currentApps.concat(apps);
    const wrapClass = state.view === 'grid' ? 'grid-list adv-grid' : 'applist adv-list';
    let wrap = resultsEl.querySelector('.' + (state.view === 'grid' ? 'adv-grid' : 'adv-list'));
    if (!wrap) {
      wrap = el('div', { class: wrapClass });
      resultsEl.append(wrap);
    }
    apps.forEach((a) => wrap.append(state.view === 'grid' ? S.gridCard(a) : S.listRow(a)));
    paintToolbar();
    moreWrap.textContent = '';
    if (lastHasMore) {
      moreWrap.append(el('button', {
        class: 'btn btn-secondary adv-more-btn', type: 'button',
        onclick: () => { state.offset = currentApps.length; run(true); },
      }, t('عرض المزيد')));
    }
  }

  function showEmpty() {
    resultsEl.textContent = '';
    resultsEl.append(S.emptyState(t('لا توجد نتائج'), t('جرّب كلمات أخرى أو أزل بعض الفلاتر.'), 'search'));
    paintToolbar();
    moreWrap.textContent = '';
  }

  async function run(append) {
    const mySeq = ++seq;
    if (resultCtrl) { try { resultCtrl.abort(); } catch (e) {} }
    resultCtrl = new AbortController();
    if (!append) { state.offset = 0; resultsEl.textContent = ''; resultsEl.append(S.skeletonList()); moreWrap.textContent = ''; }
    const qs = queryString();
    try {
      const data = await api('/api/search?' + qs + '&limit=' + PAGE_SIZE + (append ? '&offset=' + state.offset : ''), { signal: resultCtrl.signal });
      if (mySeq !== seq) return;                 // stale response guard
      lastTotal = Number(data.total) || 0;
      lastHasMore = !!data.hasMore;
      const apps = data.apps || [];
      if (!apps.length && !append) { showEmpty(); return; }
      renderApps(apps, !!append);
    } catch (err) {
      if (mySeq !== seq || isAbort(err)) return;
      resultsEl.textContent = '';
      resultsEl.append(S.errorState(err));
      moreWrap.textContent = '';
    }
  }

  /* ----------------------------- Autocomplete ---------------------------- */
  let suggestCtrl = null;
  let suggestSeq = 0;
  let suggestItems = [];
  let activeIndex = -1;

  function closeSuggest() {
    suggestBox.classList.remove('open');
    suggestBox.textContent = '';
    activeIndex = -1;
    suggestItems = [];
  }
  function highlight() {
    [...suggestBox.querySelectorAll('.suggest-row')].forEach((row, i) => {
      row.classList.toggle('active', i === activeIndex);
    });
  }
  function renderSuggest(items, q) {
    suggestBox.textContent = '';
    suggestItems = items || [];
    activeIndex = -1;
    if (!q) { closeSuggest(); return; }
    if (!suggestItems.length) { suggestBox.classList.remove('open'); return; }
    suggestItems.forEach((s) => {
      suggestBox.append(el('a', {
        class: 'suggest-row', role: 'option', href: '/app?slug=' + encodeURIComponent(s.slug),
        onclick: () => closeSuggest(),
      },
        el('span', { class: 'suggest-icon' }, s.icon_url ? el('img', { src: s.icon_url, alt: '' }) : ico('package', 'icon')),
        el('span', { class: 'suggest-info' },
          el('span', { class: 'suggest-name' }, el('bdi', null, s.name)),
          el('span', { class: 'suggest-dev' }, s.developer || S.categoryName(s.category) || '')),
        ico('chevronEnd', 'icon icon-sm'),
      ));
    });
    suggestBox.append(el('a', {
      class: 'suggest-all', href: '/search?' + queryString(), onclick: () => closeSuggest(),
    }, t('عرض كل النتائج') + (q ? ' «' + q + '»' : '')));
    suggestBox.classList.add('open');
  }
  async function suggest(q) {
    const mySeq = ++suggestSeq;
    if (suggestCtrl) { try { suggestCtrl.abort(); } catch (e) {} }
    if (!q || q.length < 1) { closeSuggest(); return; }
    suggestCtrl = new AbortController();
    try {
      const data = await api('/api/search/suggest?q=' + encodeURIComponent(q) + '&limit=8', { signal: suggestCtrl.signal });
      if (mySeq !== suggestSeq) return;
      renderSuggest(data.suggestions, q);
    } catch (err) {
      if (isAbort(err)) return;
      closeSuggest();
    }
  }

  /* ------------------------------- Events -------------------------------- */
  let resultTimer = null, suggestTimer = null;
  function onQueryChange(immediate) {
    state.q = input.value.trim();
    syncUrl();
    clearTimeout(resultTimer);
    clearTimeout(suggestTimer);
    if (immediate) { run(); suggest(state.q); return; }
    resultTimer = setTimeout(() => run(), RESULT_DEBOUNCE);
    suggestTimer = setTimeout(() => suggest(state.q), SUGGEST_DEBOUNCE);
  }
  function onFilterChange() {
    state.offset = 0;
    syncUrl();
    clearTimeout(resultTimer);
    run();
  }

  input.addEventListener('input', () => onQueryChange(false));
  input.addEventListener('focus', () => { if (state.q) suggest(state.q); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSuggest(); return; }
    if (e.key === 'Enter') {
      clearTimeout(resultTimer); clearTimeout(suggestTimer);
      if (activeIndex >= 0 && suggestBox.querySelector('.suggest-row.active')) {
        e.preventDefault();
        location.href = suggestBox.querySelector('.suggest-row.active').href;
        return;
      }
      e.preventDefault(); closeSuggest(); run(); return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const rows = [...suggestBox.querySelectorAll('.suggest-row')];
      if (!rows.length) return;
      e.preventDefault();
      activeIndex = e.key === 'ArrowDown'
        ? (activeIndex + 1) % rows.length
        : (activeIndex <= 0 ? rows.length - 1 : activeIndex - 1);
      highlight();
    }
  });
  document.addEventListener('click', (e) => { if (!pillWrap.contains(e.target)) closeSuggest(); });
  window.addEventListener('popstate', () => {
    Object.assign(state, readUrl(), { offset: 0 });
    input.value = state.q;
    syncControls();
    run();
  });

  S.ready(() => {
    root.textContent = '';
    root.append(bar, layout);
    syncControls();
    loadCategories();
    run();
    if (!state.q) input.focus();
  });
})();
