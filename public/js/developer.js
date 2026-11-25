/* Golden Store — «صفحة المطوّر»
   ---------------------------------------------------------------------------
   Tapping the blue developer name on an app page used to do nothing. It now
   opens this page, which lists every app and game by the same developer.

   The developer name is passed in the query string (`?name=…`) instead of the
   path, because names contain spaces, Arabic, ™ and invisible direction marks —
   a path segment would need fragile encoding. The name is normalised exactly
   the same way the API does it (strip �200e/�200f/�061c, trim).
   ------------------------------------------------------------------------- */
(function () {
  'use strict';

  const S = window.Store;
  const { el, ico, t, toast } = S;
  const root = document.getElementById('root');
  const head = document.getElementById('devHead');
  const nameEl = document.getElementById('devName');
  const countEl = document.getElementById('devCount');
  const list = document.getElementById('devList');
  const backBtn = document.getElementById('devBack');

  const INVISIBLE = /[\u200e\u200f\u061c]/g;

  function cleanName(raw) {
    return String(raw == null ? '' : raw).replace(INVISIBLE, '').trim();
  }

  /* Read ?name= (preferred) or ?developer= so an old link still works. */
  function developerFromQuery() {
    let q = '';
    try { q = new URLSearchParams(window.location.search).get('name') || ''; } catch (e) {}
    if (!q) { try { q = new URLSearchParams(window.location.search).get('developer') || ''; } catch (e) {} }
    return cleanName(q);
  }

  const developer = developerFromQuery();

  // Back goes to the previous page when we came from one, otherwise to /apps.
  backBtn.addEventListener('click', () => {
    try {
      if (window.history.length > 1) { window.history.back(); return; }
    } catch (e) {}
    window.location.href = '/apps';
  });

  function title() {
    document.title = `${developer || t('المطوّر')} — Golden Store`;
  }

  function showMessage(text) {
    list.innerHTML = '';
    list.append(el('div', { class: 'empty-state' }, el('p', null, text)));
  }

  function renderApps(apps) {
    list.innerHTML = '';
    if (!apps.length) {
      showMessage(t('لا توجد تطبيقات أخرى لهذا المطوّر'));
      return;
    }

    // Same cards the rest of the store uses, so this page cannot drift in style.
    const grid = el('div', { class: 'grid-list' });
    apps.forEach((a) => {
      try { grid.append(S.gridCard(a)); } catch (e) {}
    });
    list.append(el('div', { class: 'section' }, grid));
  }

  async function load() {
    if (!developer) {
      nameEl.textContent = t('المطوّر');
      countEl.textContent = '';
      showMessage(t('لم يتم تحديد مطوّر'));
      return;
    }

    nameEl.textContent = developer;
    // The developer name itself is content (often a brand) — never translated.
    nameEl.removeAttribute('data-i18n-content');
    countEl.textContent = t('جارٍ التحميل…');
    title();

    try {
      let apps = [];
      try {
        const res = await S.api(`/api/apps?developer=${encodeURIComponent(developer)}&limit=60`);
        apps = (res && res.apps) || [];
      } catch (e) { apps = []; }

      /* Fallback: if the server-side filter is not deployed yet (or a stored name
         carries invisible marks the SQL did not strip), scan the catalogue and
         match on the normalised name. One extra request, only when needed. */
      if (!apps.length) {
        try {
          const all = await S.api('/api/apps?limit=60');
          const wanted = developer.toLowerCase();
          apps = ((all && all.apps) || []).filter((a) => cleanName(a.developer).toLowerCase() === wanted);
        } catch (e) { apps = []; }
      }

      // The API filters by the stored name. Names in the database sometimes carry
      // invisible marks or inconsistent spacing, so the client also accepts a
      // normalised match — this keeps the page correct even for old rows.
      const wanted = developer.toLowerCase();
      const matches = apps.filter((a) => cleanName(a.developer).toLowerCase() === wanted);

      const total = matches.length || apps.length;
      countEl.textContent = total === 1
        ? t('تطبيق واحد من هذا المطوّر')
        : `${total} ${t('تطبيقات من هذا المطوّر')}`;

      renderApps(matches.length ? matches : apps);

      // Record the name so the page can be shared/opened again later.
      try {
        document.querySelector('meta[property="og:title"]');
        if (document.querySelector('meta[property="og:title"]')) {
          document.querySelector('meta[property="og:title"]').setAttribute('content', developer);
        }
      } catch (e) {}
    } catch (e) {
      countEl.textContent = '';
      showMessage(t('تعذّر تحميل تطبيقات المطوّر'));
      try { toast(t('تعذّر تحميل تطبيقات المطوّر'), 'error'); } catch (err) {}
    }
  }

  load();
})();
