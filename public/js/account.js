// Account ("أنت") page — settings only. Library is accessed via bottom nav.
(function () {
  const S = window.Store;
  const { el, ico, formatBytes, formatDate, toast, t, getQuery } = S;
  const root = document.getElementById('root');
  // Telegram invite + one link to the standalone support chat.
  // Declared before S.ready() because its callback may run synchronously.
  const TELEGRAM_URL = 'https://t.me/goldenstore_10';
  const isNativeApp = () => !!(window.GSAndroid && typeof window.GSAndroid.downloadApk === 'function');

  // Download-manager tabs («تحميل إدارة») — declared before S.ready(), which can
  // run synchronously for a cached user.
  const DLM_TABS = [
    { key: 'current', label: 'التنزيلات الحالية' },
    { key: 'downloaded', label: 'تم التنزيل' },
    { key: 'updates', label: 'التحديثات' },
    { key: 'library', label: 'المثبة' },
  ];
  const DLM_EMPTY = 'لم يتم تنزيل أي تطبيقات';

  // Module-level refs so native package events can refresh library rows after
  // renderLibraryPage runs (bound once per page load — no listener leaks).
  let libListRef = null;
  let libRefreshRowRef = null;
  let libEventsBound = false;

  // Determine which view to show based on URL param
  const tabParam = getQuery('tab');
  const isLibraryView = tabParam === 'library';

  S.bottomNav(isLibraryView ? 'library' : 'account');

  S.ready((user) => {
    /* Owner request (round 35): «أنت» must open WITHOUT signing in. A guest now
       sees the page itself, with a sign-in row at the top that leads to the
       login page — instead of being bounced to /login straight away. */
    root.innerHTML = '';
    // Owner request: the store topbar must NOT appear on «أنت» nor «مكتبتي».
    // Both views are rendered by this same file, so we simply do not mount it.
    const content = el('div', { class: 'acct-page' });
    root.append(content);

    if (isLibraryView) {
      renderLibraryPage(content);
    } else {
      renderSettingsPage(content, user);
    }
  });

  // --- «تحميل إدارة» — the download manager (bottom nav «مكتبتي») ---
  // Layout copied from the owner's screenshot: one row with the back arrow,
  // the title «تحميل إدارة» and a search icon; then three tabs
  // (التنزيلات الحالية / تم التنزيل / المثبة) with a green underline on the
  // active one; then the list — or, when there is nothing, the big download
  // glyph with «لم يتم تنزيل أي تطبيقات».

  function renderLibraryPage(content) {
    bindLibraryPackageEvents();
    content.innerHTML = '';
    content.classList.add('dlm');

    content.append(el('div', { class: 'dlm-top' },
      el('button', {
        class: 'dlm-back', type: 'button', 'aria-label': t('رجوع'),
        onclick: () => {
          // Stack first (Android back gesture), then fall back to «أنت».
          try { if (window.history && window.history.length > 1) { window.history.back(); return; } } catch (e) {}
          location.href = '/account';
        },
      }, ico('arrowLeft', 'icon')),
      el('h1', { class: 'dlm-title' }, t('تحميل إدارة')),
      el('a', { class: 'dlm-search', href: '/search', 'aria-label': t('بحث') }, ico('search', 'icon')),
    ));

    const tabsBar = el('div', { class: 'dlm-tabs', role: 'tablist' });
    const panel = el('div', { class: 'dlm-body' });
    content.append(tabsBar, panel);

    let active = 'current';
    let teardown = null;
    const getItems = () => (S.getDownloadHistory() || []);

    function paintTabs() {
      tabsBar.innerHTML = '';
      DLM_TABS.forEach((tb) => tabsBar.append(el('button', {
        class: `dlm-tab ${tb.key === active ? 'active' : ''}`,
        type: 'button', role: 'tab', 'aria-selected': tb.key === active ? 'true' : 'false',
        onclick: () => {
          if (active === tb.key) return;
          active = tb.key;
          paintTabs();
          renderPanel();
        },
      }, el('span', { class: 'dlm-tab-in' }, t(tb.label)))));
    }

    function dlEmpty() {
      return el('div', { class: 'dlm-empty' },
        el('div', { class: 'dlm-empty-ico' }, ico('downloadThick', 'icon')),
        el('p', { class: 'dlm-empty-txt' }, t(DLM_EMPTY)),
      );
    }

    /* Device truth for one library item — full fallback chain (v1.9):
       metadata package → native slug registry → resolved package learned from
       real installs.
       SPEED: every call costs a synchronous round-trip into the Android bridge,
       which is what made «مكتبتي» feel heavy. Results are memoised for this
       page visit (and dropped whenever a package event fires), so re-rendering
       a tab or scrolling a long list does no bridge work at all. */
    const devCache = new Map();          // slug -> { installed, pkg, verified }

    /* FAST PATH — localStorage slug registry only, no Android bridge call.
       This is what the list paints with, so a long library renders instantly. */
    function fastStateFor(item) {
      const key = item.slug || item.package_name || '';
      if (devCache.has(key)) return devCache.get(key);
      const pkg = item.package_name || (S.resolvedPackageName ? S.resolvedPackageName(item.slug) : '') || '';
      let installed = false;
      try { installed = !!(S.isInstalledStored && S.isInstalledStored(item.slug)); } catch (e) { installed = false; }
      const out = { installed, pkg, verified: false };
      devCache.set(key, out);
      return out;
    }

    /* SLOW PATH — ask the real device, but only for ONE item at a time
       (used by the row buttons and by the background verification pass). */
    function deviceStateFor(item) {
      const key = item.slug || item.package_name || '';
      const hit = devCache.get(key);
      if (hit && hit.verified) return hit;
      const base = fastStateFor(item);
      let installed = base.installed;
      if (!installed && S.isSlugInstalled) {
        try { installed = !!S.isSlugInstalled(item.slug); } catch (e) {}
      }
      if (!installed && base.pkg && S.installedVersionOnDevice) {
        try { installed = !!S.installedVersionOnDevice(base.pkg); } catch (e) {}
      }
      const out = { installed, pkg: base.pkg, verified: true };
      devCache.set(key, out);
      return out;
    }
    function forgetDeviceState(key) {
      if (key) devCache.delete(key); else devCache.clear();
    }

    /* Background verification: checks every row against the device in small
       animation-frame chunks and asks for ONE repaint if anything flipped.
       The list is already on screen, so the user never waits for it. */
    let verifying = false;
    function verifyDeviceInBackground(merged, onFlip) {
      if (verifying || !isNativeApp()) return;
      verifying = true;
      let i = 0, flipped = false;
      const step = () => {
        if (!panel.isConnected) { verifying = false; return; }
        const end = Math.min(merged.length, i + 6);
        for (; i < end; i++) {
          const it = merged[i];
          if (!it || !it.slug) continue;
          const before = fastStateFor(it).installed;
          const after = deviceStateFor(it).installed;
          if (before !== after) flipped = true;
        }
        if (i < merged.length) {
          if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(step);
          else setTimeout(step, 0);
          return;
        }
        verifying = false;
        if (flipped && onFlip) onFlip();
      };
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(step);
      else setTimeout(step, 0);
    }

    // Google Play style end state for installed apps: Open + Uninstall
    // buttons directly in the row (mirrors the app detail page).
    function buildAction(item) {
      const st = deviceStateFor(item);
      if (st.installed && isNativeApp() && st.pkg) {
        return el('div', { class: 'lib-installed-actions', 'data-pkg': st.pkg },
          el('button', {
            class: 'btn btn-primary btn-sm', type: 'button',
            onclick: (e) => {
              e.preventDefault(); e.stopPropagation();
              try { window.GSAndroid.openInstalledApp(st.pkg, item.slug || ''); } catch (err) {}
            },
          }, ico('play', 'icon icon-sm'), t('فتح')),
          el('button', {
            class: 'btn btn-secondary btn-sm', type: 'button',
            onclick: (e) => {
              e.preventDefault(); e.stopPropagation();
              try {
                window.GSAndroid.uninstallApp(st.pkg, item.slug || '');
                toast(t('جارٍ إلغاء التثبيت…'), 'info');
              } catch (err) {}
            },
          }, ico('trash', 'icon icon-sm'), t('إلغاء التثبيت')),
        );
      }
      if (st.installed) {
        return el('span', { class: 'lib-installed-badge' }, ico('check', 'icon icon-sm'), t('مثبّت'));
      }
      return el('span', { class: 'lib-open-btn' }, ico('chevronStart', 'icon icon-sm'));
    }

    function libraryRow(item) {
      const row = el('a', { href: `/app?slug=${encodeURIComponent(item.slug)}`, class: 'lib-row' },
        el('div', { class: 'art' },
          item.icon_url
            ? el('img', {
                src: item.icon_url, alt: item.name, loading: 'lazy',
                decoding: 'async', width: '56', height: '56',
              })
            : ico('package', 'icon icon-lg'),
        ),
        el('div', { class: 'lib-info' },
          el('div', { class: 'nm' }, item.name),
          el('div', { class: 'sub' }, item.developer || 'Golden Store'),
          el('div', { class: 'meta' },
            el('span', null, formatBytes(item.size_bytes || 0)),
            el('span', null, '•'),
            el('span', null, formatDate(item.downloaded_at)),
          ),
        ),
        el('div', { class: 'lib-action' }, buildAction(item)),
      );
      row.setAttribute('data-slug', item.slug || '');
      return row;
    }

    // Install state changed on the device: keep the local registry in sync and
    // re-render the panel, so an app moves from «تم التنزيل» to «المثبة» (or
    // leaves «المثبة» after an uninstall) instead of lingering in the wrong tab.
    let refreshQueued = false;
    function refreshRow(slug) {
      const item = getItems().find((h) => h.slug === slug) || { slug };
      if (!panel.isConnected) return;
      const st = deviceStateFor(item);
      if (st.installed) S.markInstalledStored(slug);
      else if (S.unmarkInstalledStored) S.unmarkInstalledStored(slug);
      if (active === 'current') return;              // live panel re-renders itself
      if (refreshQueued) return;
      refreshQueued = true;
      setTimeout(() => { refreshQueued = false; if (panel.isConnected) renderPanel(); }, 60);
    }

    /* ---- ONE consistent row for every tab: same avatar, name, meta line and
       action button. Only the live bar (current tab) and the badge differ. ---- */
    function historyOf(slug) { return getItems().find((h) => h.slug === slug) || {}; }

    function libRowBase(opts) {
      const it = opts.item || {};
      const slug = it.slug || opts.slug || '';
      const name = it.name || opts.name || slug;
      const icon = it.icon_url || opts.icon_url || null;
      const row = el('a', {
        href: `/app?slug=${encodeURIComponent(slug)}`,
        class: `lib-row${opts.className ? ' ' + opts.className : ''}`,
        'data-slug': slug,
      },
        el('div', { class: 'art' },
          icon ? el('img', { src: icon, alt: name, loading: 'lazy' }) : ico('package', 'icon icon-lg')),
        el('div', { class: 'lib-info' },
          el('div', { class: 'nm' }, el('bdi', S.appNameAttrs ? S.appNameAttrs(it) : null, name)),
          el('div', { class: 'sub' }, it.developer || opts.developer || 'Golden Store'),
          opts.metaNode || el('div', { class: 'meta' },
            el('span', null, formatBytes(it.size_bytes || opts.size_bytes || 0)),
            el('span', null, '•'),
            el('span', null, formatDate(it.downloaded_at || opts.downloaded_at)),
          ),
        ),
        opts.action ? el('div', { class: 'lib-action' }, opts.action) : null,
        opts.trailing || null,
      );
      return row;
    }

    function statusChip(text, kind) {
      return el('span', { class: `dlm-chip dlm-chip-${kind}` }, text);
    }

    function renderCurrentPanel() {
      panel.innerHTML = '';
      const host = el('div', { class: 'dlm-list' });
      const empty = dlEmpty();
      panel.append(host, empty);
      const sync = (n) => {
        const count = typeof n === 'number' ? n : host.querySelectorAll('.live-dl').length;
        empty.style.display = count ? 'none' : '';
        host.style.display = count ? '' : 'none';
      };
      sync(0);
      teardown = mountLiveDownloads(host, { onChange: sync, statuses: ['downloading', 'installing'] });
      sync();
    }

    /* «تم التنزيل» = the APK is on the phone and NOT installed yet:
       exactly the finished / ready-to-install entries. */
    function renderDownloadedPanel() {
      panel.innerHTML = '';
      const map = S.getApkStateMap ? S.getApkStateMap() : {};
      const ready = Object.values(map).filter((st) => st && st.slug && st.status === 'downloaded');
      if (!ready.length) { panel.append(dlEmpty()); return; }
      const list = el('div', { class: 'lib-list dlm-list' });
      ready.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).forEach((st) => {
        const it = historyOf(st.slug);
        const file = st.filename || '';
        list.append(libRowBase({
          item: it, slug: st.slug, name: it.name || st.slug, icon_url: it.icon_url,
          metaNode: el('div', { class: 'meta' },
            el('span', null, it.size_bytes ? formatBytes(it.size_bytes) : ''),
            statusChip(t('جاهز للتثبيت'), 'ready')),
          action: el('button', {
            class: 'btn btn-primary btn-sm', type: 'button',
            onclick: (e) => {
              e.preventDefault(); e.stopPropagation();
              if (window.GSAndroid && typeof window.GSAndroid.openDownloadedApk === 'function') {
                window.GSAndroid.openDownloadedApk(file, st.slug, st.package_name || it.package_name || '');
                toast(t('جارٍ فتح مثبّت النظام…'), 'info');
              } else {
                location.href = `/app?slug=${encodeURIComponent(st.slug)}`;
              }
            },
          }, ico('download', 'icon icon-sm'), t('تثبيت')),
        }));
      });
      panel.append(list);
      libListRef = list;
    }

    /* «المثبة» = what is REALLY installed on the device, plus a SEPARATE
       «سجل التحميلات» section.

       SPEED (this is the «ثقيل» fix):
       1. render at once from what is already known — history + cached device
          state + the slug registry — with no network and no bridge calls;
       2. ask the API for ONE page (60 apps) in the background, not the whole
          catalog in a blocking loop;
       3. verify those apps against the device in the same pass and repaint only
          if something actually changed;
       4. keep the catalog in memory for the rest of the visit. */
    let catalogCache = null;      // apps already fetched this visit
    let libRun = 0;               // guards against a stale repaint
    let libVerified = false;      // device verification already scheduled once

    function paintInstalledPanel(merged, historyBySlug) {
      const run = ++libRun;
      const installed = [];
      const notInstalled = [];
      merged.forEach((app) => {
        if (fastStateFor(app).installed) installed.push(app);
        else notInstalled.push(app);
      });
      installed.sort((a, b) => (b.downloaded_at || 0) - (a.downloaded_at || 0));
      if (run !== libRun || !panel.isConnected) return;

      panel.innerHTML = '';
      const rest = notInstalled.filter((it) => historyBySlug[it.slug]);
      if (!installed.length && !rest.length) { panel.append(dlEmpty()); return; }

      if (installed.length) {
        panel.append(el('div', { class: 'dlm-sec' },
          ico('check', 'icon icon-sm'),
          el('span', null, t('المثبة على الجهاز')),
          el('span', { class: 'dlm-sec-count' }, String(installed.length))));
        const list = el('div', { class: 'lib-list dlm-list' });
        panel.append(list);
        fillList(list, installed);
        libListRef = list;
      }

      if (rest.length) {
        panel.append(el('div', { class: 'dlm-sec' },
          ico('clock', 'icon icon-sm'),
          el('span', null, t('سجل التحميلات')),
          el('span', { class: 'dlm-sec-count' }, String(rest.length))));
        const list2 = el('div', { class: 'lib-list dlm-list' });
        panel.append(list2);
        fillList(list2, rest);
        panel.append(el('div', { class: 'dlm-clear' },
          el('button', {
            class: 'btn btn-sm btn-secondary', type: 'button',
            onclick: () => {
              if (!confirm(t('حذف سجل التحميلات بالكامل؟'))) return;
              S.clearDownloadHistory();
              toast(t('تم مسح السجل'), 'success');
              renderPanel();
            },
          }, ico('trash', 'icon icon-sm'), t('مسح السجل'))));
      }
      // Honest verification after the fact: the list is already visible.
      if (!libVerified) {
        libVerified = true;
        verifyDeviceInBackground(merged, () => { if (panel.isConnected) renderPanel(); });
      }
    }

    /* The first API page is cached for the visit AND for a short while across
       visits, so opening «مكتبتي» again paints from memory instantly. */
    const CATALOG_CACHE_KEY = 'gs_lib_catalog_v1';
    function readCatalogCache() {
      try {
        const raw = JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY) || 'null');
        if (!raw || !Array.isArray(raw.apps) || !raw.apps.length) return null;
        if (Date.now() - (raw.ts || 0) > 10 * 60 * 1000) return null;   // 10 minutes
        return raw.apps;
      } catch (e) { return null; }
    }
    function writeCatalogCache(apps) {
      try { localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ ts: Date.now(), apps })); } catch (e) {}
    }

    function renderLibraryPanel() {
      if (!catalogCache) catalogCache = readCatalogCache();
      const hist = getItems();
      const historyBySlug = {};
      hist.forEach((h) => { if (h && h.slug) historyBySlug[h.slug] = h; });

      // STEP 1 — instant paint, no await, no bridge storm.
      const start = Object.keys(historyBySlug).map((slug) => ({ ...historyBySlug[slug] }));
      const known = catalogCache
        ? mergeCatalog(catalogCache, historyBySlug)
        : start;
      paintInstalledPanel(known, historyBySlug);
      if (catalogCache) return;         // already warmed in this visit

      // STEP 2 — one background page (60 apps), then verify + repaint once.
      const run = libRun;
      S.api('/api/apps?limit=60&sort=popular').then((res) => {
        const batch = (res && res.apps) || [];
        if (!batch.length) return;
        catalogCache = batch;
        writeCatalogCache(batch);
        if (run !== libRun || !panel.isConnected) return;
        paintInstalledPanel(mergeCatalog(batch, historyBySlug), historyBySlug);
      }).catch(() => {});
    }

    function mergeCatalog(catalog, historyBySlug) {
      const bySlug = {};
      catalog.forEach((a) => { if (a && a.slug) bySlug[a.slug] = a; });
      const merged = Object.keys(bySlug).map((slug) => ({ ...historyBySlug[slug], ...bySlug[slug] }));
      Object.keys(historyBySlug).forEach((slug) => {
        if (!bySlug[slug]) merged.push(historyBySlug[slug]);
      });
      return merged;
    }

    /* Renders rows in small chunks so a long list paints immediately and the
       WebView is never blocked by one big DOM pass. */
    function fillList(listEl, items, perChunk) {
      const step = perChunk || 12;
      let i = 0;
      const slice = () => {
        if (!listEl.isConnected) return;
        const frag = document.createDocumentFragment();
        const end = Math.min(items.length, i + step);
        for (; i < end; i++) frag.append(libraryRow(items[i]));
        listEl.append(frag);
        if (i < items.length) {
          if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(slice);
          else setTimeout(slice, 0);
        }
      };
      slice();
    }

    /* «التحديثات» = installed apps/games whose store build is newer than the
       copy on the device. Works in two steps so it is never slow:

       1. INSTANT: the device registry already knows which slugs are installed
          and which version each one has (recorded at install time), so the
          first paint needs no network and no Android bridge call;
       2. VERIFY: one small parallel batch asks the bridge for the real version
          of those few packages — only installed apps, never the whole catalog —
          and repaints once if the answer differs.

       When this phone has not installed anything yet there is nothing to
       update, so an honest empty state is shown instead of a spinner. */
    function installedSlugsFromHistory() {
      const out = [];
      (getItems() || []).forEach((it) => {
        if (!it || !it.slug) return;
        if (S.isInstalledStored && S.isInstalledStored(it.slug)) out.push(it.slug);
      });
      return out;
    }

    function paintUpdates(rows) {
      panel.innerHTML = '';
      if (!rows.length) {
        panel.append(el('div', { class: 'dlm-empty' },
          el('div', { class: 'dlm-empty-ico' }, ico('refresh', 'icon')),
          el('p', { class: 'dlm-empty-txt' }, t('كل تطبيقاتك محدّثة')),
        ));
        return;
      }
      panel.append(el('div', { class: 'dlm-sec' },
        ico('refresh', 'icon icon-sm'),
        el('span', null, t('تحتاج تحديث')),
        el('span', { class: 'dlm-sec-count' }, String(rows.length))));
      const list = el('div', { class: 'lib-list dlm-list' });
      panel.append(list);
      rows.forEach((r) => list.append(libRowBase({
        item: r.app, slug: r.app.slug, name: S.appName ? S.appName(r.app) : r.app.name,
        icon_url: r.app.icon_url,
        metaNode: el('div', { class: 'meta' },
          r.app.version_name ? el('span', null, 'v' + r.app.version_name) : null,
          r.app.size_bytes ? el('span', null, '•') : null,
          r.app.size_bytes ? el('span', null, formatBytes(r.app.size_bytes)) : null,
          statusChip(t('يتوفّر تحديث'), 'update')),
        action: el('a', {
          class: 'btn btn-primary btn-sm',
          href: `/app?slug=${encodeURIComponent(r.app.slug)}`,
        }, ico('download', 'icon icon-sm'), t('تحديث')),
      })));
      libListRef = list;
    }

    const verCache = new Map();     // pkg -> device version (one bridge call per app per visit)
    function deviceVersionOf(app) {
      if (!app || !app.package_name) return '';
      const pkg = app.package_name;
      if (verCache.has(pkg)) return verCache.get(pkg);
      let v = '';
      try { v = S.installedVersionOnDevice ? (S.installedVersionOnDevice(pkg) || '') : ''; } catch (e) { v = ''; }
      verCache.set(pkg, v);
      return v;
    }

    function renderUpdatesPanel() {
      const installed = installedSlugsFromHistory();
      if (!installed.length) { paintUpdates([]); return; }

      const known = catalogCache || readCatalogCache();
      const byslug = new Map();
      (known || []).forEach((a) => { if (a && a.slug) byslug.set(a.slug, a); });

      const build = (catalog) => {
        const rows = [];
        installed.forEach((slug) => {
          const app = catalog.get(slug) || (historyOf(slug) || {});
          if (!app || !app.slug) return;
          const deviceVersion = deviceVersionOf(app);
          const storeV = String(app.version_name || '').trim();
          const isNewer = deviceVersion && deviceVersion !== 'installed'
            ? S.versionIsNewer(storeV, deviceVersion)
            : (deviceVersion === 'installed' ? !!storeV && S.appHasUpdate(app) : false);
          if (isNewer) rows.push({ app, deviceVersion: deviceVersion === 'installed' ? '' : deviceVersion });
        });
        rows.sort((a, b) => (b.app.downloaded_at || 0) - (a.app.downloaded_at || 0));
        return rows;
      };

      // Step 1 (instant): paint from the registry we already have.
      paintUpdates(build(byslug));

      // Step 2 (one batch): make sure the catalog page is loaded, then verify.
      if (!catalogCache) {
        S.api('/api/apps?limit=60&sort=popular').then((res) => {
          const batch = (res && res.apps) || [];
          if (!batch.length) return;
          catalogCache = batch;
          writeCatalogCache(batch);
          if (!panel.isConnected || active !== 'updates') return;
          const cat = new Map(byslug);
          batch.forEach((a) => { if (a && a.slug) cat.set(a.slug, a); });
          paintUpdates(build(cat));
        }).catch(() => {});
      }
    }

    function renderPanel() {
      if (teardown) { try { teardown(); } catch (e) {} teardown = null; }
      libListRef = null;
      libRefreshRowRef = refreshRow;
      if (active === 'current') return renderCurrentPanel();
      if (active === 'downloaded') return renderDownloadedPanel();
      if (active === 'updates') return renderUpdatesPanel();
      return renderLibraryPanel();
    }

    paintTabs();
    renderPanel();
  }

  // --- Native package events → live library row refresh ---
  // When the user uninstalls (system dialog) or an install completes while
  // the library is open, the affected rows flip between
  // [فتح | إلغاء التثبيت] and the plain state WITHOUT a page reload.
  function bindLibraryPackageEvents() {
    if (libEventsBound) return;
    libEventsBound = true;
    window.addEventListener('gs-package-uninstalled', (e) => {
      forgetDeviceState(null);          // device truth changed: drop the cache
      try { verCache.clear(); } catch (err) {}
      const d = (e && e.detail) || {};
      const pkg = d.packageName;
      const slug = d.slug;
      if (!libListRef || !libListRef.isConnected || !libRefreshRowRef) return;
      if (slug) libRefreshRowRef(slug);
      if (pkg) {
        libListRef.querySelectorAll('.lib-installed-actions').forEach((act) => {
          if (act.getAttribute('data-pkg') !== pkg) return;
          const rowEl = act.closest('.lib-row');
          const s = rowEl && rowEl.getAttribute('data-slug');
          if (s) libRefreshRowRef(s);
        });
      }
    });
    if (S.onApkState) {
      S.onApkState((evt) => {
        const slug = evt && evt.slug;
        const status = evt && evt.status;
        if (status === 'installed' || status === 'uninstalled') forgetDeviceState(slug);
        if (!slug || !libListRef || !libListRef.isConnected || !libRefreshRowRef) return;
        if (status === 'installed' || status === 'uninstalled') libRefreshRowRef(slug);
      });
    }
  }

  // --- Live downloads section (library) ---
  // Renders downloading / downloaded / installing entries from the central
  // hub, enriched with names/icons from the download history. Re-renders on
  // every state event so progress and status stay live on this page.
  function mountLiveDownloads(body, opts) {
    const section = el('div', { class: 'live-dls' });
    const o = opts || {};
    let paintQueued = false;

    function paint() {
      paintQueued = false;
      const map = S.getApkStateMap ? S.getApkStateMap() : {};
      // Only the statuses this panel owns: «التنزيلات الحالية» owns in-flight and
      // installing entries, «تم التنزيل» owns the finished-but-not-installed ones.
      // Without this split the same app appeared in two tabs — the «mixed» feel.
      const only = Array.isArray(o.statuses) ? o.statuses : null;
      let entries = Object.values(map).filter((st) => st && st.slug
        && (!only || only.indexOf(st.status) !== -1 || (only.indexOf('installing') !== -1 && st.status === 'installing')));
      section.innerHTML = '';
      if (!entries.length) { if (o.onChange) o.onChange(0); return; }

      const historyById = {};
      S.getDownloadHistory().forEach((h) => { historyById[h.slug] = h; });

      // Self-heal FIRST — the DEVICE decides (v1.9): any "installing" or
      // "downloaded" entry whose app is REALLY installed (event lost while
      // navigating, wrong metadata, missed broadcast…) is dropped right away
      // instead of sticking on "جارٍ التثبيت…" forever. checkAppStatus also
      // resolves the REAL package from the APK file when metadata is empty.
      entries = entries.filter((st) => {
        if (st.status !== 'installing' && st.status !== 'downloaded') return true;
        const info = historyById[st.slug] || {};
        const res = S.checkAppStatus ? S.checkAppStatus(st.slug, st.package_name || info.package_name || '') : null;
        if (res && res.installed) {
          S.removeApkState(st.slug);
          S.removeActiveDownload(st.slug);
          return false;
        }
        return true;
      });
      if (!entries.length) { if (o.onChange) o.onChange(0); return; }

      section.append(el('div', { class: 'live-dls-title' },
        ico('download', 'icon'),
        el('span', null, t('جارٍ التنزيل الآن')),
        el('span', { class: 'live-count' }, String(entries.length)),
      ));

      entries
        .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
        .forEach((st) => {
          const info = historyById[st.slug] || {};
          const name = info.name || st.name || st.slug;
          const pct = st.status === 'downloading' && typeof st.progress === 'number' && st.progress >= 0
            ? Math.max(0, Math.min(100, Math.round(st.progress * 100))) : null;

          const statusText = st.status === 'downloading'
            ? (st.handed_off ? t('جارٍ التنزيل في الخلفية…')
              : (pct === null ? t('جارٍ التنزيل…') : `${t('جارٍ التنزيل…')} ${pct}%`))
            : st.status === 'downloaded' ? t('تم التنزيل — جاهز للتثبيت')
            : st.status === 'installing' ? t('جارٍ التثبيت…')
            : t('قيد المعالجة…');

          const barFill = el('span');
          if (st.status === 'downloading') {
            if (pct !== null) barFill.style.width = pct + '%';
            else barFill.style.width = '100%';
          } else if (st.status === 'installing') {
            barFill.style.width = '100%';
          } else {
            barFill.style.width = '100%';
          }
          if (st.status !== 'downloading' || pct === null) barFill.classList.add('indeterminate');

          const meta = el('div', { class: 'meta' },
            el('span', null, statusText),
            el('span', null, info.size_bytes ? formatBytes(info.size_bytes) : ''),
          );

          const infoCol = el('div', { class: 'info' },
            el('div', { class: 'nm' }, el('bdi', S.appNameAttrs ? S.appNameAttrs(it) : null, name)),
            el('div', { class: 'bar' }, barFill),
            meta,
          );

          const row = el('div', { class: `live-dl live-dl-${st.status}` },
            el('div', { class: 'art' },
              info.icon_url
                ? el('img', { src: info.icon_url, alt: '', loading: 'lazy' })
                : ico('package', 'icon icon-lg'),
            ),
            infoCol,
          );

          if (st.status === 'downloading') {
            row.append(el('button', {
              class: 'live-dl-cancel', type: 'button',
              'aria-label': t('إلغاء التنزيل'), title: t('إلغاء التنزيل'),
              onclick: (e) => {
                e.preventDefault();
                S.cancelDownload(st.slug);
                toast(t('تم إلغاء التنزيل'), 'info');
                paint();
              },
            }, ico('close', 'icon'), t('إلغاء التنزيل')));
          } else if (st.status === 'downloaded') {
            row.append(el('button', {
              class: 'live-dl-install', type: 'button',
              onclick: (e) => {
                e.preventDefault();
                if (window.GSAndroid && typeof window.GSAndroid.openDownloadedApk === 'function') {
                  window.GSAndroid.openDownloadedApk(st.filename || '', st.slug, st.package_name || info.package_name || '');
                  toast(t('جارٍ فتح مثبّت النظام…'), 'info');
                } else {
                  location.href = `/app?slug=${encodeURIComponent(st.slug)}`;
                }
              },
            }, ico('download', 'icon'), t('تثبيت')));
          }
          section.append(row);
        });
      if (o.onChange) o.onChange(section.querySelectorAll('.live-dl').length);
    }

    function queuePaint() {
      if (paintQueued) return;
      paintQueued = true;
      requestAnimationFrame(paint);
    }

    const offState = S.onApkState ? S.onApkState(() => queuePaint()) : null;
    const offDl = S.onActiveDownloadsChange ? S.onActiveDownloadsChange(() => queuePaint()) : null;
    // Stop listening when navigating away (page unload clears everything).
    const onHide = () => {
      if (offState) offState();
      if (offDl) offDl();
    };
    window.addEventListener('pagehide', onHide, { once: true });

    body.append(section);
    paint();
    if (o.onChange) o.onChange(section.querySelectorAll('.live-dl').length);
    // Explicit teardown: the download manager swaps tabs without reloading.
    return () => {
      window.removeEventListener('pagehide', onHide);
      onHide();
    };
  }

  // --- Settings page (profile + settings) ---
  function renderSettingsPage(content, user) {
    /* Owner request (round 35): the header is now a plain placeholder avatar +
       «تسجيل الدخول» — never the Google/e-mail picture — and it is a real link
       to the sign-in page. When signed in, the same row shows the name and
       «الإعدادات», still linking to the account. */
    if (user) {
      content.append(
        el('div', { class: 'acct-head' },
          el('div', { class: 'avatar avatar-lg is-placeholder' }, ico('user', 'icon')),
          el('div', { class: 'acct-info' },
            el('div', { class: 'nm' }, (user.displayName || t('مستخدم') + ' Golden Store')),
            el('div', { class: 'acct-email-row' },
              el('div', { class: 'em acct-email', 'data-noi18n': '' }, user.email || ''),
            ),
          ),
        ),
      );
    } else {
      content.append(
        el('a', { class: 'acct-head acct-head--guest', href: '/login?next=%2Faccount', 'aria-label': t('تسجيل الدخول') },
          el('div', { class: 'avatar avatar-lg is-placeholder' }, ico('user', 'icon')),
          el('div', { class: 'acct-info' },
            el('div', { class: 'nm' }, t('تسجيل الدخول')),
            el('div', { class: 'acct-email-row' },
              el('div', { class: 'em acct-email' }, t('اضغط للدخول أو إنشاء حساب')),
            ),
          ),
        ),
      );
    }

    // Settings title
    // Settings title
    content.append(el('div', { class: 'page-title', style: { padding: '16px 16px 0' } }, t('الإعدادات')));

    const settingsBody = el('div', { class: 'acct-body' });
    content.append(settingsBody);

    function renderSettings() {
      settingsBody.innerHTML = '';
      settingsBody.append(
        el('div', { class: 'acct-list' },
          settingItem('moon', t('المظهر'), S.currentTheme() === 'light' ? t('فاتح') : t('غامق'), () => {
            S.toggleTheme();
            renderSettings();
          }),
          langSettingItem(),
          settingItem('refresh', t('التحقق من وجود تحديثات'),
            t('الإصدار') + ' ' + (S.getCurrentAppVersion ? S.getCurrentAppVersion() : '—'),
            () => { if (S.checkForUpdates) S.checkForUpdates({}); }),
        ),
        telegramCard(),
        supportEntry(),
        legalLinksCard(),
        el('div', { class: 'account-actions' },
          user
            ? el('button', { class: 'btn btn-outline btn-block', type: 'button', onclick: () => confirmSignOut() },
                ico('logout', 'icon icon-sm'), t('تسجيل الخروج'))
            /* Guest: the same slot invites signing in, and goes to /login. */
            : el('a', { class: 'btn btn-primary btn-block', href: '/login?next=%2Faccount' },
                ico('user', 'icon icon-sm'), t('تسجيل الدخول')),
        ),
      );
    }


    renderSettings();
  }

  // One button, no social-media list: invite users to the Telegram channel.
  // Copy invites users to join the channel only.
  function telegramCard() {
    const card = el('section', { class: 'telegram-card', 'aria-label': t('انضموا إلى قناتنا على تليجرام') },
      el('div', { class: 'telegram-card-head' },
        el('span', { class: 'telegram-card-icon' }, ico('telegram', 'icon')),
        el('h3', null, t('انضموا إلى قناتنا على تليجرام')),
      ),
      el('p', { class: 'telegram-card-text' },
        t('تابع آخر التطبيقات والألعاب والتحديثات وأخبار المتجر على قناتنا في تليجرام.')),
      el('a', {
        class: 'telegram-cta',
        href: TELEGRAM_URL,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': t('انضم الى المجموعة'),
      },
        ico('telegram', 'icon'),
        el('span', { class: 'telegram-cta-label' }, t('انضم الى المجموعة')),
      ),
    );

    /* «نشر قولدن ستور» was removed by the owner: the Telegram card is the last
       block here, and supportEntry() follows it as before. */
    const group = document.createDocumentFragment();
    group.appendChild(card);
    return group;
  }

  function langSettingItem() {
    const langs = [
      { code: 'ar', label: 'العربية' },
      { code: 'en', label: 'English' },
      { code: 'fr', label: 'Français' },
      { code: 'es', label: 'Español' },
      { code: 'tr', label: 'Türkçe' },
      { code: 'de', label: 'Deutsch' },
      { code: 'pt', label: 'Português' },
      { code: 'ru', label: 'Русский' },
      { code: 'hi', label: 'हिन्दी' },
      { code: 'zh', label: '中文' },
    ];
    const currentLang = (window.GSI18N && window.GSI18N.lang) || 'ar';
    const current = langs.find((l) => l.code === currentLang) || langs[0];

    const dropdown = el('div', { class: 'lang-dropdown', 'data-noi18n': '' });

    const trigger = el('button', { type: 'button', class: 'lang-trigger' },
      ico('globe', 'icon'),
      el('span', { class: 'label' }, t('اللغة')),
      el('span', { class: 'lang-current' }, current.label),
      ico('chevronDown', 'icon chevron'),
    );

    const menu = el('div', { class: 'lang-menu-pop' });
    langs.forEach((l) => {
      const item = el('button', {
        type: 'button',
        class: `lang-option ${l.code === currentLang ? 'active' : ''}`,
        onclick: () => {
          if (l.code === currentLang) { dropdown.classList.remove('open'); return; }
          if (window.GSI18N && window.GSI18N.setLang) window.GSI18N.setLang(l.code);
        },
      },
        el('span', { class: 'lang-name' }, l.label),
        l.code === currentLang ? ico('check', 'icon check') : el('span'),
      );
      menu.append(item);
    });

    trigger.onclick = (e) => { e.stopPropagation(); dropdown.classList.toggle('open'); };
    document.addEventListener('click', (e) => { if (!dropdown.contains(e.target)) dropdown.classList.remove('open'); });

    dropdown.append(trigger, menu);
    return dropdown;
  }

  function confirmSignOut() {
    const overlay = el('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) close(); } });
    function close() { overlay.remove(); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    const card = el('div', { class: 'dialog-card', dir: document.documentElement.dir || 'rtl' },
      el('div', { class: 'dialog-head' },
        el('div', { class: 'dialog-title' }, ico('logout', 'icon'), t('تسجيل الخروج')),
        el('button', { class: 'dialog-close', 'aria-label': t('إغلاق'), onclick: () => close() }, ico('close')),
      ),
      el('div', { class: 'dialog-body' },
        el('p', { class: 'store-card-text' }, t('هل تريد بالتأكيد تسجيل الخروج من حسابك؟ ستحتاج لتسجيل الدخول مجدداً للوصول إلى المتجر.')),
      ),
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'btn btn-secondary', onclick: () => close() }, t('إلغاء')),
        el('button', { class: 'btn btn-danger', onclick: () => { close(); S.signOut(); } },
          ico('logout', 'icon icon-sm'), t('تسجيل الخروج')),
      ),
    );
    overlay.append(card);
    document.addEventListener('keydown', esc);
    document.body.append(overlay);
  }

  // One button in "أنت" opens the standalone, full-screen support chat.
  function supportEntry() {
    return el('a', {
      class: 'support-entry', href: '/support',
      'aria-label': t('الدعم والمساعدة'),
    },
      ico('message', 'icon'),
      el('span', { class: 'support-entry-label' }, t('الدعم والمساعدة')),
      ico('chevronEnd', 'icon support-entry-chevron'),
    );
  }

  // Legal pages: also reachable from the site footer on every store page.
  function legalLinksCard() {
    const links = [
      { icon: 'info',      label: 'من نحن',          href: '/about' },
      { icon: 'shield',    label: 'سياسة الخصوصية',   href: '/privacy' },
      { icon: 'clipboard', label: 'شروط الخدمة',      href: '/terms' },
    ];
    const list = el('div', { class: 'acct-list legal-list' });
    links.forEach((l) => {
      list.append(el('a', { class: 'acct-setting', href: l.href },
        ico(l.icon, 'icon'),
        el('span', { class: 'label' }, t(l.label)),
        ico('external', 'icon icon-sm'),
      ));
    });
    return el('div', null,
      el('div', { class: 'page-title', style: { padding: '8px 16px 0', fontSize: '15px' } }, t('الصفحات القانونية')),
      list,
    );
  }

  function settingItem(icon, label, value, onClick) {
    const attrs = { class: 'acct-setting' };
    if (onClick) attrs.onclick = onClick;
    return el('div', attrs,
      ico(icon, 'icon'),
      el('span', { class: 'label' }, label),
      el('span', { class: 'value' }, value || ''),
      onClick ? ico('chevronStart', 'icon icon-sm') : null,
    );
  }

  function langLabel() {
    const lang = (window.GSI18N && window.GSI18N.lang) || 'ar';
    const map = { ar: 'العربية', en: 'English', fr: 'Français', es: 'Español', tr: 'Türkçe', de: 'Deutsch', pt: 'Português', ru: 'Русский', hi: 'हिन्दी', zh: '中文' };
    return map[lang] || lang;
  }
})();
