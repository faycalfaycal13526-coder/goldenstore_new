// Minimal search — one field, one clean result list. No sidebar, no filters,
// no autocomplete popup. Instant results with debounce + URL sync, no reload.
(function () {
  const S = window.Store;
  const { el, ico, api, t } = S;
  const root = document.getElementById('root');
  S.bottomNav('');

  const PAGE_SIZE = 20;
  const DEBOUNCE = 250;

  const state = {
    q: (new URLSearchParams(location.search).get('q') || '').trim().slice(0, 120),
    offset: 0,
  };

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
    ),
  );

  const kicker = el('div', { class: 'ms-kicker' }, 'Golden Store · ' + t('بحث'));
  const titleEl = el('h1', { class: 'ms-title' });
  const countEl = el('div', { class: 'ms-count' });
  const header = el('div', { class: 'ms-header' }, kicker, titleEl, countEl);
  const listEl = el('div', { class: 'ms-list', role: 'list' });
  const moreEl = el('div', { class: 'ms-more' });
  const main = el('main', { class: 'ms-main' }, header, listEl, moreEl);

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
        a.icon_url ? el('img', { src: a.icon_url, alt: '', loading: 'lazy' }) : ico('package', 'icon icon-lg')),
      el('span', { class: 'ms-info' },
        el('span', { class: 'ms-name' }, el('bdi', null, a.name)),
        el('span', { class: 'ms-sub' }, a.developer || S.categoryName(a.category) || t('تطبيق')),
        meta.length ? el('span', { class: 'ms-meta' }, ...meta) : null,
      ),
      ico('chevronStart', 'icon icon-sm ms-go'),
    );
  }

  function paintHeader() {
    titleEl.textContent = state.q ? t('نتائج البحث') : t('الأكثر تحميلاً');
    countEl.textContent = state.q
      ? '«' + state.q + '» · ' + S.formatCount(total) + ' ' + t('نتيجة')
      : S.formatCount(total) + ' ' + t('تطبيق');
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
    const qs = new URLSearchParams({ sort: 'popular', limit: String(PAGE_SIZE), offset: String(state.offset) });
    if (state.q) qs.set('q', state.q);
    try {
      const data = await api('/api/search?' + qs.toString(), { signal: ctrl.signal });
      if (mySeq !== seq) return;
      total = Number(data.total) || 0;
      hasMore = !!data.hasMore;
      const apps = data.apps || [];
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
    const qs = state.q ? '?q=' + encodeURIComponent(state.q) : '';
    try { history.replaceState(null, '', '/search' + qs); } catch (e) {}
  }

  let timer = null;
  input.addEventListener('input', () => {
    state.q = input.value.trim();
    syncUrl();
    clearTimeout(timer);
    timer = setTimeout(() => run(), DEBOUNCE);   // instant search, no reload
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run(); input.blur(); }
    else if (e.key === 'Escape' && state.q) {
      e.preventDefault(); input.value = ''; state.q = ''; clearTimeout(timer); syncUrl(); run();
    }
  });
  window.addEventListener('popstate', () => {
    state.q = (new URLSearchParams(location.search).get('q') || '').trim().slice(0, 120);
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
