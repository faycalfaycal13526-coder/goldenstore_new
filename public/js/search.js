// Search — Play-Store style: one field, a short row of type tabs right under it
// (الكل / تطبيقات / ألعاب), then a clean result list. Instant (debounced) with
// URL sync, no reload, no popup, no sidebar.
(function () {
  const S = window.Store;
  const { el, ico, api, t } = S;
  const appName = (a) => (typeof S.appName === 'function' ? S.appName(a) : ((a && a.name_t) || (a && a.name) || ''));
  const root = document.getElementById('root');
  S.bottomNav('');

  // Static head strings are translated too (lang.js only walks <body>).
  document.title = t('بحث') + ' — Golden Store';
  try {
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', t('ابحث عن التطبيقات والألعاب في Golden Store.'));
  } catch (e) {}

  const PAGE_SIZE = 20;
  const DEBOUNCE = 250;

  const qs0 = new URLSearchParams(location.search);
  const state = {
    q: (qs0.get('q') || '').trim().slice(0, 120),
    type: ['app', 'game'].indexOf(qs0.get("type")) >= 0 ? qs0.get("type") : '',
    offset: 0,
  };

  /* ---------------------- history & trending (real data) ---------------- */
  const HISTORY_KEY = 'gs_search_history';
  const HISTORY_MAX = 8;
  function readHistory() {
    try {
      const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, HISTORY_MAX) : [];
    } catch (e) { return []; }
  }
  function pushHistory(term) {
    const q = String(term || '').trim();
    if (q.length < 1) return;
    const next = [q, ...readHistory().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, HISTORY_MAX);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch (e) {}
  }
  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
    paintHistory();
  }

  /* ------------------------------- DOM ---------------------------------- */
  const input = el('input', {
    class: 'ms-input', type: 'search', value: state.q,
    placeholder: t('ابحث عن تطبيق أو لعبة أو مطوّر'),
    autocomplete: 'off', spellcheck: 'false', 'aria-label': t('بحث'),
    enterkeyhint: 'search',
  });
  const clearBtn = el('button', {
    class: 'ms-ico', type: 'button', 'aria-label': t('مسح'), title: t('مسح'),
    onclick: () => { input.value = ''; state.q = ''; syncUrl(); run(); input.focus(); },
  }, ico('close'));
  const langBox = el('div', { class: 'ms-lang' });
  let switcher = null;
  try { if (typeof S.langSwitcherEl === 'function') switcher = S.langSwitcherEl(); } catch (e) {}
  if ((!switcher || switcher.nodeType !== 1) && window.GSI18N && typeof window.GSI18N.switcherEl === 'function') {
    try { switcher = window.GSI18N.switcherEl(); } catch (e) {}
  }
  if (switcher && switcher.nodeType === 1) langBox.append(switcher);

  const bar = el('div', { class: 'ms-bar' },
    el('div', { class: 'ms-bar-inner' },
      el('button', {
        class: 'ms-ico ms-back', type: 'button', 'aria-label': t('رجوع'), title: t('رجوع'),
        onclick: () => (history.length > 1 ? history.back() : (location.href = '/')),
      }, ico('chevronEnd')),
      el('div', { class: 'ms-pill' },
        ico('search', 'icon ms-search-ico'),
        input,
        clearBtn,
      ),
      langBox,
    ),
  );

  /* --- «سجل البحث» and «عمليات البحث الرائجة» — shown while the field is
     empty, exactly like the reference layout: a header row per section, then
     wrapping pill chips. Tapping a chip searches for it immediately. --- */
  const historySection = el('section', { class: 'ms-sec ms-history' });
  const trendingSection = el('section', { class: 'ms-sec ms-trending' });
  const chipsWrap = el('div', { class: 'ms-chips' });

  function chip(label, opts = {}) {
    return el('button', {
      class: 'ms-chip' + (opts.hot ? ' is-hot' : ''), type: 'button',
      onclick: () => { applyTerm(label); },
    },
      opts.hot ? el('span', { class: 'ms-chip-flame', 'aria-hidden': 'true' }, '\u{1F525}') : null,
      el('span', { class: 'ms-chip-label', dir: 'auto' }, label),
    );
  }

  function paintHistory() {
    historySection.textContent = '';
    const items = readHistory();
    if (!items.length) { historySection.classList.add('hidden'); return; }
    /* While a query is active the results take over — the landing sections
       must never pop back on top of them. */
    if (state.q) { historySection.classList.add('hidden'); return; }
    historySection.classList.remove('hidden');
    historySection.append(el('div', { class: 'ms-sec-head' },
      ico('clock', 'icon icon-sm'),
      el('h2', null, t('سجل البحث')),
      el('button', { class: 'ms-sec-clear', type: 'button', 'aria-label': t('حذف السجل'), title: t('حذف السجل'), onclick: clearHistory },
        ico('trash', 'icon icon-sm')),
    ));
    const row = el('div', { class: 'ms-chips ms-chips-history' });
    items.forEach((term) => row.append(chip(term)));
    historySection.append(row);
  }

  let trendingLoaded = false;
  async function paintTrending(force) {
    if (trendingLoaded && !force) return;
    trendingSection.textContent = '';
    trendingSection.append(el('div', { class: 'ms-sec-head' },
      ico('trending', 'icon icon-sm'),
      el('h2', null, t('عمليات البحث الرائجة')),
    ));
    const row = el('div', { class: 'ms-chips' }, el('span', { class: 'ms-chip-skel' }), el('span', { class: 'ms-chip-skel' }), el('span', { class: 'ms-chip-skel' }));
    trendingSection.append(row);
    try {
      const data = await api('/api/search/trending?limit=14');
      const terms = (data && data.terms) || [];
      row.textContent = '';
      if (!terms.length) {
        /* Nothing to invent: say it plainly instead of showing fake chips. */
        trendingSection.classList.remove('hidden');
        trendingSection.append(el('p', { class: 'ms-sec-empty' }, t('لا توجد عمليات بحث رائجة بعد.')));
        return;
      }
      trendingSection.classList.remove('hidden');
      terms.forEach((item) => row.append(chip(item.term, { hot: true })));
      chipsWrap.textContent = '';
      trendingLoaded = true;
    } catch (e) {
      trendingSection.classList.add('hidden');
    }
  }

  /* Live suggestions while typing: real rows from the catalogue. */
  const suggestEl = el('div', { class: 'ms-suggest', role: 'listbox' });
  let suggestSeq = 0;
  let suggestTimer = null;
  async function loadSuggestions(q) {
    const mySeq = ++suggestSeq;
    if (!q) { suggestEl.textContent = ''; suggestEl.classList.add('hidden'); return; }
    try {
      const data = await api('/api/search/suggest?q=' + encodeURIComponent(q) + '&limit=6');
      if (mySeq !== suggestSeq) return;
      const rows = (data && (data.suggestions || data.apps || data.results)) || [];
      suggestEl.textContent = '';
      if (!rows.length) { suggestEl.classList.add('hidden'); return; }
      rows.forEach((r) => {
        const name = r.name || r.term || '';
        suggestEl.append(el('button', {
          class: 'ms-suggest-row', type: 'button', role: 'option',
          onclick: () => { if (r.slug) location.href = '/app?slug=' + encodeURIComponent(r.slug); else applyTerm(name); },
        },
          ico('search', 'icon icon-sm'),
          el('span', { class: 'ms-suggest-name' }, name),
          r.slug ? ico('chevronStart', 'icon icon-sm') : null,
        ));
      });
      suggestEl.classList.remove('hidden');
    } catch (e) {
      suggestEl.classList.add('hidden');
    }
  }

  function applyTerm(term) {
    const q = String(term || '').trim();
    input.value = q;
    state.q = q;
    state.offset = 0;
    pushHistory(q);
    paintHistory();
    syncUrl();
    suggestEl.classList.add('hidden');
    clearTimeout(timer);
    run();
  }

  const kickerEl = el('div', { class: 'ms-kicker' }, 'Golden Store · ' + t('بحث'));
  const head = el('div', { class: 'ms-header' },
    kickerEl,
    el('div', { class: 'ms-head-row' },
      el('h1', { class: 'ms-title' }),
      el('span', { class: 'ms-count' }),
    ),
  );
  const listEl = el('div', { class: 'ms-list', role: 'list' });
  const moreEl = el('div', { class: 'ms-more' });
  /* Order, exactly as the owner asked: «سجل البحث» first, then
     «عمليات البحث الرائجة», then the results. */
  const main = el('main', { class: 'ms-main' }, historySection, trendingSection, suggestEl, head, listEl, moreEl);

  /* ----------------------------- Results -------------------------------- */
  let seq = 0;
  let ctrl = null;
  let total = 0;
  let hasMore = false;
  let shown = 0;

  function isAbort(err) {
    return !!err && (err.name === 'AbortError' || (err.status === 0 && err.message === 'timeout'));
  }

  function row(a) {
    const rating = Number(a.rating) || 0;
    const meta = [];
    if (rating > 0) meta.push(el('span', { class: 'ms-star' }, ico('star', 'icon icon-sm'), rating.toFixed(1)));
    if (a.size_bytes) meta.push(S.formatBytes(a.size_bytes));
    return el('a', {
      class: 'ms-row', role: 'listitem',
      href: '/app?slug=' + encodeURIComponent(a.slug),
    },
      el('span', { class: 'ms-art' },
        a.icon_url ? el('img', { src: a.icon_url, alt: appName(a), loading: 'lazy' }) : ico('package', 'icon icon-lg')),
      el('span', { class: 'ms-info' },
        el('span', { class: 'ms-name' }, el('bdi', { 'data-i18n-app': a.name || '' }, appName(a))),
        el('span', { class: 'ms-sub' }, el('bdi', null, a.developer || S.categoryName(a.category) || t('تطبيق'))),
        meta.length ? el('span', { class: 'ms-meta' }, ...meta) : null,
      ),
      ico('chevronStart', 'icon icon-sm ms-go'),
    );
  }

  function paintHeader() {
    const unit = (one, many) => t(total === 1 ? one : many);
    head.querySelector('.ms-title').textContent = state.q ? t('نتائج البحث') : t('الأكثر تحميلاً');
    head.querySelector('.ms-count').textContent = state.q
      ? '«' + state.q + '» · ' + S.formatCount(total) + ' ' + unit('نتيجة', 'نتائج')
      : S.formatCount(total) + ' ' + unit('تطبيق', 'تطبيقات');
    clearBtn.classList.toggle('hidden', !state.q);
  }

  function render(apps, append) {
    if (!append) { listEl.textContent = ''; shown = 0; }
    if (!listEl.firstChild) listEl.append(el('div', { class: 'ms-group' }));
    const group = listEl.querySelector('.ms-group');
    apps.forEach((a) => group.append(row(a)));
    shown += apps.length;
    paintHeader();
    moreEl.textContent = '';
    if (hasMore) {
      moreEl.append(el('button', {
        class: 'btn btn-secondary ms-more-btn', type: 'button',
        onclick: () => { state.offset = shown; run(true); },
      }, t('عرض المزيد')));
    }
  }

  async function run(append) {
    const mySeq = ++seq;
    if (ctrl) { try { ctrl.abort(); } catch (e) {} }
    ctrl = new AbortController();
    if (!append) {
      state.offset = 0;
      listEl.textContent = '';
      listEl.append(S.skeletonList());
      moreEl.textContent = '';
    }
    /* Play-style landing: with an empty field the page shows «سجل البحث» +
       «عمليات البحث الرائجة» under the field, and the same ONE search request
       still fills the featured list underneath it. */
    const emptyField = !state.q && !append;
    historySection.classList.toggle('hidden', !emptyField || !readHistory().length);
    trendingSection.classList.toggle('hidden', !emptyField);
    if (emptyField) { paintHistory(); paintTrending(); }
    const qs = new URLSearchParams({ sort: 'popular', limit: String(PAGE_SIZE), offset: String(state.offset) });
    if (state.q) qs.set('q', state.q);
    if (state.type) qs.set('type', state.type);
    try {
      const data = await api('/api/search?' + qs.toString(), { signal: ctrl.signal });
      if (mySeq !== seq) return;
      total = Number(data.total) || 0;
      hasMore = !!data.hasMore;
      const apps = data.apps || [];
      if (state.q) { pushHistory(state.q); paintHistory(); }
      paintHeader();
      if (!apps.length && !append) {
        listEl.textContent = '';
        listEl.append(S.emptyState(
          state.q ? t('لا توجد نتائج') : t('لا توجد تطبيقات بعد'),
          state.q ? t('جرّب كلمة أخرى أو تحقّق من الكتابة.') : t('ستظهر التطبيقات هنا فور إضافتها.')
        ));
        moreEl.textContent = '';
        return;
      }
      render(apps, !!append);
    } catch (err) {
      if (mySeq !== seq || isAbort(err)) return;
      listEl.textContent = '';
      listEl.append(S.errorState(err));
      moreEl.textContent = '';
    }
  }

  /* ------------------------------- Events ------------------------------- */
  function syncUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.type) p.set('type', state.type);
    const s = p.toString();
    try { history.replaceState(null, '', '/search' + (s ? '?' + s : '')); } catch (e) {}
  }

  let timer = null;
  input.addEventListener('input', () => {
    state.q = input.value.trim();
    syncUrl();
    clearTimeout(timer);
    timer = setTimeout(() => run(), DEBOUNCE);   // instant search, no reload
    clearTimeout(suggestTimer);
    /* typing instantly swaps the landing sections for suggestions/results */
    historySection.classList.add('hidden');
    trendingSection.classList.add('hidden');

    if (!state.q) {
      suggestEl.textContent = '';
      suggestEl.classList.add('hidden');
      historySection.classList.toggle('hidden', !readHistory().length);
      trendingSection.classList.remove('hidden');
      return;
    }
    suggestTimer = setTimeout(() => loadSuggestions(state.q), 180);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run(); input.blur(); }
    else if (e.key === 'Escape' && state.q) {
      e.preventDefault(); input.value = ''; state.q = ''; clearTimeout(timer); syncUrl(); run();
    }
  });
  window.addEventListener('popstate', () => {
    const p = new URLSearchParams(location.search);
    state.q = (p.get('q') || '').trim().slice(0, 120);
    state.type = ['app', 'game'].indexOf(p.get("type")) >= 0 ? p.get("type") : '';
    input.value = state.q;
    run();
  });

  S.ready(() => {
    root.textContent = '';
    root.append(bar, main);
    paintHeader();
    run();
    if (!state.q) input.focus();
  });
})();
