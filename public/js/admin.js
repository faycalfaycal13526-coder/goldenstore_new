(async function () {
  const { api, el, ico, toast, formatBytes, formatNum, formatDate, themeToggleBtn } = window.GS;
  const C = window.GSChat;
  // Late-bound lookup: all report-tab strings (including toasts, confirmations
  // and title/aria attributes) resolve through the manual GSI18N dictionary.
  const t = (source) => {
    try {
      return window.GSI18N && typeof window.GSI18N.t === 'function'
        ? window.GSI18N.t(source) : source;
    } catch { return source; }
  };
  const root = document.getElementById('content');

  let me = null;
  let cats = [];
  let activeTab = 'dashboard';
  let newKind = 'app';
  // Live dashboard refresh: a single visibility listener (no long-lived
  // interval, so background tabs and tests never keep a timer running).
  let liveRefreshTarget = null;
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' || !liveRefreshTarget) return;
    if (!liveRefreshTarget.isConnected) return;
    renderDashboard(liveRefreshTarget);
  });

  /* ---------------- Dependency-free charts + pagination -----------------
     Vanilla JS + inline SVG only: no Chart.js, no CDN, no network requests.
     Used by the live dashboard and by the apps/users tables. */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, ...kids) {
    const n = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v != null && v !== false) n.setAttribute(k, String(v));
    });
    kids.forEach((k) => {
      if (k == null || k === false) return;
      n.append(k && k.nodeType ? k : document.createTextNode(String(k)));
    });
    return n;
  }
  function lineChartSvg(series) {
    const W = 640, H = 180, P = 22;
    const vals = (series || []).map((d) => Number(d.count || 0));
    if (!vals.length) return svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'admin-svg-chart' });
    const max = Math.max(1, ...vals);
    const step = vals.length > 1 ? (W - P * 2) / (vals.length - 1) : 0;
    const pts = vals.map((v, i) => [P + i * step, H - P - (v / max) * (H - P * 2)]);
    const d = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
    const base = H - P;
    const area = `${d} L ${pts[pts.length - 1][0].toFixed(1)} ${base} L ${P} ${base} Z`;
    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`, class: 'admin-svg-chart', role: 'img',
      'aria-label': t('منحنى التنزيلات خلال 14 يوماً'), preserveAspectRatio: 'none',
    });
    [0, 0.5, 1].forEach((f) => svg.append(svgEl('line', {
      x1: P, x2: W - P, y1: P + f * (H - 2 * P), y2: P + f * (H - 2 * P),
      class: 'admin-svg-grid',
    })));
    svg.append(svgEl('path', { d: area, class: 'admin-svg-area' }));
    svg.append(svgEl('path', { d, class: 'admin-svg-line', fill: 'none' }));
    pts.forEach((q, i) => svg.append(svgEl('circle', {
      cx: q[0], cy: q[1], r: vals[i] ? 3.2 : 2, class: 'admin-svg-dot',
    })));
    return svg;
  }
  function categoryBars(items) {
    const list = (items || []).slice(0, 8);
    const max = Math.max(1, ...list.map((x) => Number(x.count || 0)));
    if (!list.length) return el('div', { class: 'hint' }, t('لا توجد بيانات بعد'));
    return el('div', { class: 'admin-cat-bars' }, ...list.map((x) =>
      el('div', { class: 'admin-cat-bar' },
        el('span', { class: 'admin-cat-bar-label' }, t(x.key) || x.key),
        el('div', { class: 'admin-cat-bar-track' },
          el('i', { style: { width: `${Math.max(3, Math.round((Number(x.count || 0) / max) * 100))}%` } })),
        el('b', null, formatNum(x.count)))));
  }
  /* Compact sparkline + donut for the Command Center (pure inline SVG). */
  function sparklineSvg(values) {
    const W = 120, H = 34, P = 3;
    const vals = (values || []).map((v) => Number(v || 0));
    if (!vals.length) return svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cc-spark' });
    const max = Math.max(1, ...vals);
    const step = vals.length > 1 ? (W - P * 2) / (vals.length - 1) : 0;
    const pts = vals.map((v, i) => [P + i * step, H - P - (v / max) * (H - P * 2)]);
    const d = pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cc-spark', preserveAspectRatio: 'none', role: 'img' });
    svg.append(svgEl('path', { d: `${d} L ${pts[pts.length - 1][0].toFixed(1)} ${H} L ${P} ${H} Z`, class: 'cc-spark-area' }));
    svg.append(svgEl('path', { d, class: 'cc-spark-line', fill: 'none' }));
    return svg;
  }
  function donutSvg(percent, label) {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    const R = 42, C = 2 * Math.PI * R;
    const svg = svgEl('svg', { viewBox: '0 0 110 110', class: 'cc-donut', role: 'img', 'aria-label': String(label || '') });
    svg.append(svgEl('circle', { cx: 55, cy: 55, r: R, class: 'cc-donut-track' }));
    svg.append(svgEl('circle', { cx: 55, cy: 55, r: R, class: 'cc-donut-value',
      'stroke-dasharray': `${(C * p / 100).toFixed(1)} ${C.toFixed(1)}`,
      transform: 'rotate(-90 55 55)' }));
    svg.append(svgEl('text', { x: 55, y: 52, 'text-anchor': 'middle', class: 'cc-donut-num' }, `${p}%`));
    svg.append(svgEl('text', { x: 55, y: 68, 'text-anchor': 'middle', class: 'cc-donut-label' }, String(label || '')));
    return svg;
  }
  function ccCard(label, value, sub, accent, spark) {
    return el('div', { class: 'cc-card' + (accent ? ' ' + accent : '') },
      el('div', { class: 'cc-card-label' }, label),
      el('div', { class: 'cc-card-value' }, value),
      el('div', { class: 'cc-card-sub' }, sub || ''),
      spark ? el('div', { class: 'cc-card-spark' }, sparklineSvg(spark)) : null);
  }
  function ccPill(label, ok, detail) {
    return el('div', { class: 'cc-pill ' + (ok ? 'is-ok' : 'is-warn') },
      el('span', { class: 'cc-pill-dot' }), el('strong', null, label),
      el('span', null, detail || ''));
  }
  function ccAction(label, icon, handler, danger) {
    return el('button', { class: 'btn btn-sm ' + (danger ? 'btn-danger' : 'btn-secondary'), type: 'button',
      onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try { await handler(); } finally { b.disabled = false; }
      } }, ico(icon), label);
  }

  function pager(total, page, pageSize, onGo) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const box = el('div', { class: 'admin-pager', role: 'navigation', 'aria-label': t('ترقيم الصفحات') });
    const btn = (label, target, disabled, active) => el('button', {
      class: 'admin-pager-btn' + (active ? ' is-active' : ''),
      type: 'button', disabled: disabled || active,
      'aria-label': `${t('صفحة')} ${target}`,
      onclick: () => onGo(target),
    }, label);
    box.append(btn('‹', Math.max(1, page - 1), page <= 1));
    let start = Math.max(1, Math.min(page - 2, pages - 4));
    const end = Math.min(pages, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) box.append(btn(String(i), i, false, i === page));
    box.append(btn('›', Math.min(pages, page + 1), page >= pages));
    box.append(el('span', { class: 'admin-pager-info' },
      `${formatNum(total)} ${t('عنصر')} • ${t('صفحة')} ${page}/${pages}`));
    return box;
  }

  /* ---------------- Admin console: grouped navigation -------------------
     One source of truth drives the sidebar, the breadcrumb, the command
     palette and the mobile tab strip. Every item keeps the classic
     `.admin-tabs .tab` hook so existing tooling/tests stay valid. */
  const NAV_GROUPS = [
    { id: 'overview', label: 'نظرة عامة', icon: 'dashboard', items: [
      { key: 'dashboard', icon: 'dashboard', label: 'لوحة المعلومات' },
    ] },
    { id: 'content', label: 'المحتوى', icon: 'apps', items: [
      { key: 'apps', icon: 'apps', label: 'التطبيقات' },
      { key: 'games', icon: 'gamepad', label: 'الألعاب' },
      { key: 'new', icon: 'plus', label: 'إضافة جديد' },
      { key: 'quality', icon: 'shield', label: t('فحص الجودة') },
    ] },
    { id: 'community', label: 'المجتمع', icon: 'message', items: [
      { key: 'requests', icon: 'flag', label: 'الطلبات والبلاغات' },
      { key: 'reports', icon: 'message', label: t('بلاغات المراجعات') },
      { key: 'support', icon: 'message', label: t('رسائل الدعم') },
      { key: 'users', icon: 'users', label: t('المستخدمون') },
      { key: 'collect', icon: 'database', label: t('جمع المعلومات') },
    ] },
    { id: 'growth', label: 'النمو', icon: 'trending', items: [
      { key: 'notifications', icon: 'bell', label: 'الإشعارات' },
      { key: 'advanced-push', icon: 'bell', label: 'إشعارات متقدمة' },
      { key: 'analytics', icon: 'dashboard', label: 'الإحصائيات' },
      { key: 'insights', icon: 'trending', label: t('إحصائيات متقدمة') },
      { key: 'firebase', icon: 'sparkle', label: t('مركز Firebase') },
      { key: 'cloudflare', icon: 'cloud', label: t('Cloudflare Analytics') },
    ] },
    { id: 'system', label: 'النظام', icon: 'settings', items: [
      { key: 'app-update', icon: 'download', label: t('مركز التحديث') },
      { key: 'publishing', icon: 'clock', label: t('النشر والترتيب') },
      { key: 'categories', icon: 'grid', label: t('الفئات') },
      { key: 'activity', icon: 'clock', label: t('سجل النشاطات') },
      { key: 'team', icon: 'shield', label: t('المشرفون والصلاحيات') },
      { key: 'security', icon: 'lock', label: t('كلمة السر والأمان') },
      { key: 'backup', icon: 'storage', label: t('النسخ الاحتياطي') },
      { key: 'storage-cleanup', icon: 'cloud', label: t('تنظيف كلاود') },
      { key: 'cloud', icon: 'cloud', label: t('كلاود R2') },
      { key: 'preview', icon: 'external', label: t('معاينة الأجهزة') },
      { key: 'settings', icon: 'settings', label: 'إعدادات المتجر' },
      { key: 'languages', icon: 'globe', label: t('اللغات') },
    ] },
  ];
  function groupForTab(key) {
    return NAV_GROUPS.find((g) => g.items.some((i) => i.key === key)) || null;
  }
  function currentNavLabel() {
    for (const g of NAV_GROUPS) {
      const hit = g.items.find((i) => i.key === activeTab);
      if (hit) return hit.label;
    }
    if (activeTab.startsWith('edit:')) return 'تعديل عنصر';
    return 'لوحة المعلومات';
  }
  const ADMIN_ACTIVITY_KEY = 'gs_admin_activity';
  function logAdminAction(label, kind = 'info') {
    try {
      const arr = JSON.parse(localStorage.getItem(ADMIN_ACTIVITY_KEY) || '[]');
      arr.unshift({ label, kind, ts: Math.floor(Date.now() / 1000) });
      localStorage.setItem(ADMIN_ACTIVITY_KEY, JSON.stringify(arr.slice(0, 60)));
    } catch (e) {}
    // Mirror to the durable server-side log; never block the UI on it.
    try { api('/api/admin/activity', { method: 'POST', body: { action: label, kind } }).catch(() => {}); } catch (e) {}
  }
  function readAdminActivity() {
    try {
      const arr = JSON.parse(localStorage.getItem(ADMIN_ACTIVITY_KEY) || '[]');
      return Array.isArray(arr) ? arr.slice(0, 8) : [];
    } catch (e) { return []; }
  }
  function goTab(key) { activeTab = key; renderApp(); }

  /* ---------- Desktop content width (fixes the legacy 248px offset) ----------
     An old @media (min-width:960px) rule still applied
     `margin-inline-start: var(--admin-sidebar-w)` to .admin-shell, which pushed
     the whole console off-centre on desktop. We neutralise it in CSS and let
     the owner choose the exact max width here. */
  const ADMIN_WIDTH_KEY = 'gs_admin_width';
  const ADMIN_WIDTHS = { comfortable: '1200px', wide: '1440px', full: '100%' };
  function currentWidthKey() {
    try { const v = localStorage.getItem(ADMIN_WIDTH_KEY); return ADMIN_WIDTHS[v] ? v : 'wide'; } catch (e) { return 'wide'; }
  }
  function applyAdminWidth() {
    try {
      document.documentElement.style.setProperty('--admin-content-max', ADMIN_WIDTHS[currentWidthKey()]);
    } catch (e) {}
  }
  function widthSelect() {
    const sel = el('select', {
      class: 'admin-width-select', 'aria-label': t('عرض المحتوى'), title: t('عرض المحتوى'),
      onchange: () => {
        try { localStorage.setItem(ADMIN_WIDTH_KEY, sel.value); } catch (e) {}
        applyAdminWidth();
        logAdminAction(`${t('عرض المحتوى')}: ${sel.options[sel.selectedIndex].text}`);
      },
    },
      el('option', { value: 'comfortable' }, t('مريح') + ' · 1200'),
      el('option', { value: 'wide' }, t('عريض') + ' · 1440'),
      el('option', { value: 'full' }, t('عرض كامل')));
    sel.value = currentWidthKey();
    return sel;
  }

  /* ---------- Pinned sections + keyboard shortcuts + quality checks ---------- */
  const ADMIN_PINNED_KEY = 'gs_admin_pinned';
  function readPinned() {
    try { const a = JSON.parse(localStorage.getItem(ADMIN_PINNED_KEY) || '[]'); return Array.isArray(a) ? a.slice(0, 5) : []; }
    catch (e) { return []; }
  }
  function togglePin(key) {
    const a = readPinned();
    const i = a.indexOf(key);
    if (i >= 0) a.splice(i, 1); else a.push(key);
    try { localStorage.setItem(ADMIN_PINNED_KEY, JSON.stringify(a.slice(-5))); } catch (e) {}
    renderApp();
  }
  function allNavItems() {
    const out = [];
    NAV_GROUPS.forEach((g) => g.items.forEach((i) => out.push({ ...i, group: g.label })));
    return out;
  }
  function pinnedBar() {
    const keys = readPinned();
    if (!keys.length) return null;
    const items = allNavItems();
    return el('div', { class: 'admin-pinned-bar' },
      ...keys.map((k) => {
        const it = items.find((x) => x.key === k);
        if (!it) return null;
        return el('button', { class: 'admin-pinned-chip', type: 'button', onclick: () => goTab(k) },
          ico(it.icon || 'grid', 'icon'), it.label);
      }));
  }
  function showShortcutsDialog() {
    const existing = document.getElementById('admin-shortcuts');
    if (existing) { existing.remove(); return; }
    const overlay = el('div', { id: 'admin-shortcuts', class: 'admin-preview-overlay', role: 'dialog', 'aria-modal': 'true' });
    const rows = [
      ['Ctrl K', t('بحث سريع')], ['/', t('بحث')], ['?', t('اختصارات لوحة المفاتيح')],
      ['G D', 'لوحة المعلومات'], ['G A', 'التطبيقات'], ['G G', 'الألعاب'],
      ['G N', 'إضافة جديد'], ['G Q', t('فحص الجودة')], ['Esc', 'إغلاق النوافذ'],
    ];
    const card = el('div', { class: 'admin-preview-card' },
      el('div', { class: 'admin-preview-top' },
        el('div', null, el('h2', null, t('اختصارات لوحة المفاتيح')),
          el('span', null, 'Golden Store Admin')),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('إغلاق'),
          onclick: () => overlay.remove() }, ico('close'))),
      el('div', { class: 'admin-shortcuts-grid' },
        ...rows.map(([k, label]) => el('div', { class: 'admin-shortcut-row' },
          el('kbd', null, k), el('span', null, label)))));
    overlay.append(card);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.append(overlay);
  }
  function qaIssues(a) {
    const out = [];
    if (!a.icon_key && !a.icon_url) out.push(t('أيقونة مفقودة'));
    if (!a.apk_key) out.push(t('ملف APK مفقود'));
    if (!String(a.description || '').trim()) out.push(t('وصف مفقود'));
    if (!String(a.short_description || '').trim()) out.push(t('وصف مختصر مفقود'));
    if (!String(a.category || '').trim()) out.push(t('فئة مفقودة'));
    if (!String(a.version_name || '').trim()) out.push(t('إصدار مفقود'));
    if (!String(a.developer || '').trim()) out.push(t('مطوّر مفقود'));
    return out;
  }
  function qaSummary(apps) {
    let withIssues = 0, noIcon = 0, noApk = 0, noDesc = 0, total = 0;
    apps.forEach((a) => {
      const issues = qaIssues(a);
      total += issues.length;
      if (issues.length) withIssues++;
      if (issues.includes(t('أيقونة مفقودة'))) noIcon++;
      if (issues.includes(t('ملف APK مفقود'))) noApk++;
      if (issues.includes(t('وصف مفقود'))) noDesc++;
    });
    return { withIssues, noIcon, noApk, noDesc, total };
  }

  // ---------------- helpers ----------------

  function emptyMsg(title, sub) {
    return el('div', { class: 'empty-state' },
      ico('package', 'icon icon-xxl'),
      el('h3', null, title),
      sub ? el('p', null, sub) : null,
    );
  }

  function showSpinner() {
    root.innerHTML = '';
    root.append(el('div', { class: 'center-spinner' }, el('div', { class: 'spinner' })));
  }

  const MULTIPART_THRESHOLD = 10 * 1024 * 1024; // 10 MB

  function xhrPut(url, data, contentType, onProgress, timeoutMs) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      if (contentType) xhr.setRequestHeader('Content-Type', contentType);
      // Default timeout: 5 min for small files, 30 min for large parts.
      // 0 means no timeout (default for XHR). We set it to ensure uploads
      // don't hang silently forever on flaky mobile networks.
      xhr.timeout = timeoutMs > 0 ? timeoutMs : (5 * 60 * 1000);
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(e.loaded, e.total);
        };
      }
      xhr.ontimeout = () => reject(new Error('upload_timeout'));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader('ETag');
          resolve(etag);
        } else {
          reject(new Error(`upload_failed_${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('upload_error'));
      xhr.send(data);
    });
  }

  async function retryXhrPut(url, data, contentType, onProgress, maxRetries, timeoutMs) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await xhrPut(url, data, contentType, onProgress, timeoutMs);
      } catch (err) {
        lastErr = err;
        // Don't retry on 4xx (the presigned URL or its content-type is wrong,
        // retrying won't fix that). Retry on network errors and 5xx.
        if (err && err.message && /_4\d\d$/.test(err.message)) throw err;
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s, 8s…
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }
    throw lastErr;
  }

  /** A part of a multipart upload, written by the Worker on our behalf. */
  function partPutUrl(key, uploadId, partNumber) {
    const base = (window.Store && Store.apiBaseUrl && Store.apiBaseUrl()) || '';
    return `${base}/api/admin/r2/put?key=${encodeURIComponent(key)}`
      + `&upload_id=${encodeURIComponent(uploadId)}&part=${encodeURIComponent(partNumber)}`;
  }

  /** Same-origin upload target: the Worker performs the bucket write.
   *  Store.apiBaseUrl() is '' on the web (a relative URL, same origin) and the
   *  API host inside the installed app — exactly what `api()` already uses. */
  function ownOriginPutUrl(key) {
    const base = (window.Store && Store.apiBaseUrl && Store.apiBaseUrl()) || '';
    return `${base}/api/admin/r2/put?key=${encodeURIComponent(key)}`;
  }

  /* ── STAGING DRAFTS — «لماذا أعيد رفع 40 ميغابايت؟» ───────────────────────
   * A publish that loses its connection has usually already uploaded the bytes.
   * They are kept in this browser (localStorage) under a key derived from the
   * item's own fields, and the next press reuses them instead of sending them
   * again. Uploading the same file again is still harmless: the upload key is
   * deterministic per item, so the same name is written again, not a copy.
   * Only this browser sees them — nothing is published from here. */
  const DRAFT_PREFIX = 'gs_admin_draft:';
  function draftIdOf(data) {
    const base = `${data.name || ''}|${data.package_name || ''}|${data.type || 'app'}`;
    let h = 0;
    for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  const uploadedKeysOf = (kind) => uploadSession.keys
    .filter((x) => x && x.kind === kind).map((x) => x.key);
  function stashDraft(data, files) {
    try {
      const empty = !files.apk_key.length && !files.icon.length && !files.feature.length && !files.screenshots.length;
      if (empty) return;
      localStorage.setItem(DRAFT_PREFIX + draftIdOf(data), JSON.stringify({ ...files, at: Date.now() }));
    } catch (e) { /* a full quota must never break a publish */ }
  }
  /** Every key a staged draft is holding, so they can be released on cancel. */
  function releaseDraft(data) {
    try {
      const raw = localStorage.getItem(DRAFT_PREFIX + draftIdOf(data));
      if (!raw) return [];
      const d = JSON.parse(raw);
      return [
        ...(d.apk_key || []), ...(d.icon || []), ...(d.feature || []),
        ...(d.screenshots || []),
      ].filter(Boolean);
    } catch (e) { return []; }
  }
  function clearDraft(data) {
    try { localStorage.removeItem(DRAFT_PREFIX + draftIdOf(data)); } catch (e) {}
  }
  /** Was this exact file already uploaded by a previous attempt? */
  function stagedKeyFor(data, kind, file) {
    try {
      const raw = localStorage.getItem(DRAFT_PREFIX + draftIdOf(data));
      if (!raw) return '';
      const d = JSON.parse(raw);
      const want = kind === 'screenshot' ? (d.screenshots || []) : (d[kind === 'apk' ? 'apk_key' : kind] || []);
      // Only reuse a key whose tail tells us it is the same kind; the upload key
      // is deterministic per item, so one candidate per kind is enough.
      return want.length ? String(want[0]) : '';
    } catch (e) { return ''; }
  }

  async function r2Upload(file, kind, slugHint, onProgress, opts) {
    const contentType = file.type || 'application/octet-stream';

    if (file.size > MULTIPART_THRESHOLD) {
      return await r2MultipartUpload(file, kind, slugHint, contentType, onProgress, opts);
    }

    // Small file: single presigned PUT (with retry). The presign request
    // itself is retried too — transient 4xx/5xx/timeouts here used to abort
    // the whole upload.
    let presign = null;
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        presign = await api('/api/admin/upload-url', {
          method: 'POST',
          timeoutMs: 30000,
          body: {
            kind,
            filename: file.name,
            content_type: contentType,
            slug_hint: slugHint || file.name,
            ...(opts && opts.app_id ? { app_id: opts.app_id } : {}),
            ...(opts && opts.slot ? { slot: opts.slot } : {}),
          },
        });
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
    const { url, key } = presign;

    /* WHY THE BYTES GO TO /api/r2-put AND NOT TO THE BUCKET.
     *
     * «عندما أقوم بتحديث تطبيق لا يبعث إلى R2». A browser PUT to
     * `pub-….r2.dev` / `*.r2.cloudflarestorage.com` is cross-origin. When the
     * bucket's CORS rule does not allow the exact method the browser sends
     * (multipart uses POST for create/complete and DELETE for abort — the rule
     * listed only GET/PUT/HEAD), or when an extension/private-DNS resolver
     * blocks the bucket host, the request dies BEFORE it leaves the device.
     * Nothing reaches the Worker, so there is no status code to show and the
     * panel can only say «فشل».
     *
     * `/api/r2-put` is the store's own origin: the browser uploads to us and the
     * Worker writes the object. A failure is now a JSON reason with a status.
     * If the Worker itself is unreachable the presigned URL is still tried once,
     * but it is no longer the first choice: it costs the bucket's distance on
     * every byte. */
    /* SPEED: the browser sends the bytes to its nearest Cloudflare POP and the
     * Worker there writes them into the bucket. The bucket sits in one region
     * (the owner's is Western North America), so a direct upload from Algeria
     * would pay that distance on every byte of the file; through the Worker it is
     * paid once, on the Worker's own fast link, not on the phone's. The direct
     * path is used only when the same-origin one cannot work at all. */
    const progress = (loaded, total) => { if (onProgress) onProgress(loaded / total); };
    try {
      await retryXhrPut(ownOriginPutUrl(key), file, contentType, progress, 2, 30 * 60 * 1000);
    } catch (ownErr) {
      /* SPEED: the presigned PUT is NOT attempted first any more — that sent
       * every byte across the bucket's region twice on a slow link. It stays as
       * the one fallback for the case the Worker route cannot run at all (an old
       * deployment, a body the Worker will not carry), so nothing that used to
       * work breaks. A 4xx from our own route is a real refusal and is reported
       * as-is instead of being masked by a second attempt. */
      if (/_4\d\d$/.test(String(ownErr && ownErr.message))) throw ownErr;
      await retryXhrPut(url, file, contentType, progress, 2, 30 * 60 * 1000);
    }
    return trackUploaded(key, kind);
  }

  // Turn a publish failure into a plain, actionable sentence in the UI
  // language — never a raw code like `upload_failed_403`. The step names what
  // the owner was doing, so the message points at the real culprit.
  function publishErrorText(err, step, appName) {
    const st = Number(err && err.status) || 0;
    const code = String((err && err.message) || '');
    const where = {
      apk: t('ملف التطبيق'), icon: t('الأيقونة'), feature: t('الصورة العرضية'),
      screenshots: t('الصور'), create: t('إنشاء صفحة التطبيق'),
    }[step] || t('الملفات');

    if (code === 'upload_timeout' || code === 'timeout') {
      return t('انقطع الاتصال أثناء رفع') + ' ' + where + '. ' + t('أعد المحاولة — الرفع يستأنف من الصفر.');
    }
    if (/_403$/.test(code) || st === 403) {
      return t('انتهت صلاحية رابط الرفع. أعد المحاولة.');
    }
    if (/_413$/.test(code) || st === 413) {
      return t('الملف أكبر من الحد المسموح على الخادم.');
    }
    if (st === 401 || st === 403) {
      return t('انتهت جلستك في لوحة الإدارة. سجّل الدخول من جديد.');
    }
    if (st >= 500 || code === 'upload_error' || st === 0) {
      return t('تعذّر الاتصال بالخادم أثناء') + ' ' + where + '. ' + t('أعد المحاولة بعد لحظات.');
    }
    if (code === 'apk_not_found') {
      return t('لم يُعثر على ملف التطبيق بعد الرفع. أعد المحاولة.');
    }
    if (code === 'missing_fields') {
      return t('املأ الاسم واسم الحزمة وملف التطبيق.');
    }
    return t('فشل الرفع') + ' — ' + where + (st ? ` (${st})` : '');
  }

  // After a client-side timeout, decide whether the publish actually happened.
  // Prevents the old "Internet error" that showed up while the app was created.
  /* A stable key for one publish attempt: the same item + the same device for
     the same minute must never become two rows. */
  /* «تم الحذف» used to be printed even when cloud files survived. Now the
     message states the file count, and points at the cleanup panel when some
     file could not be removed. */
  /* Why a delete failed, in plain Arabic — never «فشل الحذف» on its own. */
  function deleteErrorText(err, name) {
    const st = Number(err && err.status) || 0;
    const code = String((err && err.message) || '');
    if (st === 404) return `«${name}» لم يعد موجوداً — حدّث الصفحة.`;
    if (st === 401 || st === 403) return 'انتهت جلستك. سجّل الدخول من جديد ثم أعد الحذف.';
    if (st === 0 || code === 'timeout') return 'لا اتصال بالخادم — لم يُحذف شيء. تحقّق من الشبكة.';
    if (st >= 500) return 'الخادم لم يستجب للحذف — لم يُحذف شيء، واللعبة ما زالت في المتجر. حدّث الصفحة وحاول مرة أخرى.';
    if (code === 'delete_failed') return 'قاعدة البيانات رفضت الحذف — لم يتغيّر شيء. أعد المحاولة.';
    return `تعذّر الحذف (${st || '؟'}). حدّث الصفحة وتأكّد هل بقي العنصر.`;
  }

  function deleteResultText(del) {
    if (!del || typeof del.files !== 'number') return 'تم الحذف';
    if (!del.files) return 'تم الحذف (لا ملفات مرتبطة)';
    if (del.failed_files) {
      return `تم الحذف من الموقع، لكن ${del.failed_files} ملف بقي في كلاود — شغّل «تنظيف كلاود» لإزالته`;
    }
    return `تم الحذف نهائياً — أُزيل ${del.deleted_files} ملف من كلاود`;
  }

  /* ── Keys uploaded by the current publish attempt ────────────────────────────
   * Owner: «ماذا الذي لا يحذف من اين اتى». This is where it came from.
   *
   * The publish flow uploads the APK, icon, feature image and screenshots to R2
   * BEFORE asking the server to create the row. When a later step fails — a slow
   * 4 GB upload, a 522, a validation error — the row is never created and the
   * files already in the bucket belonged to nobody. The delete path then had no
   * row to find them from, so they stayed for ever: exactly the two leftovers
   * (apk/getting-over-it-…​.apk and vthumb/video-…​.jpg) the owner kept seeing.
   *
   * Every key is now recorded here, and a failed publish removes them again. A
   * successful publish clears the list (the row now owns those keys).
   */
  const uploadSession = { keys: [] };
  function trackUploaded(key, kind) {
    if (key && typeof key === 'string') uploadSession.keys.push({ key, kind: kind || '' });
    return key;
  }
  async function discardUploadedKeys(keys) {
    const list = [...new Set((keys || []).map((k) => (k && k.key) || k).filter(Boolean))];
    if (!list.length) return { deleted: 0, failed: 0 };
    try {
      const res = await api('/api/admin/r2/delete', { method: 'POST', body: { keys: list }, timeoutMs: 60000 });
      return { deleted: Number(res && res.deleted) || 0, failed: Number(res && res.failed) || 0 };
    } catch {
      // The sweep in «ملفات غير مستخدمة» is the safety net.
      return { deleted: 0, failed: list.length };
    }
  }

  function makePublishKey(payload) {
    const stamp = (window.__gsPublishStamp || (window.__gsPublishStamp = Date.now()));
    return `${payload.package_name || payload.name || 'app'}|${payload.apk_key || ''}|${stamp}`;
  }

  async function findCreatedApp(name) {
    if (!name) return null;
    const want = String(name).trim().toLowerCase();
    const res = await api('/api/admin/apps?limit=60', { timeoutMs: 20000 }).catch(() => null);
    const list = (res && (res.apps || res)) || [];
    if (!Array.isArray(list)) return null;
    const hit = list.find((a) => String(a.name || '').trim().toLowerCase() === want);
    return hit ? { id: hit.id, slug: hit.slug } : null;
  }

  async function r2MultipartUpload(file, kind, slugHint, contentType, onProgress, opts) {
    // 1. Create multipart upload and get presigned part URLs
    const mp = await api('/api/admin/multipart/create', {
      method: 'POST',
      timeoutMs: 60000,
      body: {
        kind,
        filename: file.name,
        content_type: contentType,
        slug_hint: slugHint || file.name,
        file_size: file.size,
        ...(opts && opts.app_id ? { app_id: opts.app_id } : {}),
        ...(opts && opts.slot ? { slot: opts.slot } : {}),
      },
    });

    const { key, uploadId, partSize, parts: partUrls } = mp;

    // 2. Upload each part with retry.
    //
    // PART URLS EXPIRE AFTER ONE HOUR. A multi-GB APK on a slow mobile uplink
    // needs one to three hours, so the parts still pending when the hour ran
    // out came back 403 — and 403 was never retried, which killed the whole
    // publish on a perfectly healthy connection. The remaining URLs are now
    // re-signed before they expire (and again if a part still comes back 403),
    // so the upload simply continues from where it stopped.
    const SIGNED_URL_LIFETIME = 45 * 60 * 1000;   // renew before the 1-hour expiry
    let signedAt = Date.now();
    let pending = partUrls.map((p) => ({ partNumber: p.partNumber, url: p.url }));

    async function ressignParts(fromIndex) {
      const part_numbers = pending.slice(fromIndex).map((p) => p.partNumber);
      if (!part_numbers.length) return;
      const fresh = await api('/api/admin/multipart/sign-parts', {
        method: 'POST',
        timeoutMs: 60000,
        body: { key, uploadId, part_numbers },
      });
      const urlByNum = new Map((fresh && fresh.parts || []).map((p) => [p.partNumber, p.url]));
      for (let k = fromIndex; k < pending.length; k++) {
        const u = urlByNum.get(pending[k].partNumber);
        if (u) pending[k] = { partNumber: pending[k].partNumber, url: u };
      }
      signedAt = Date.now();
    }

    const completedParts = [];
    let doneBytes = 0;

    try {
      for (let i = 0; i < pending.length; i++) {
        const start = i * partSize;
        const end = Math.min(start + partSize, file.size);
        const chunk = file.slice(start, end);
        const partNum = pending[i].partNumber;

        if (Date.now() - signedAt > SIGNED_URL_LIFETIME) await ressignParts(i);

        let etag = null;
        for (let attempt = 0; attempt <= 1; attempt++) {
          try {
            /* A part uploads through the store's own origin first (see
             * ownOriginPutUrl): one request, no CORS preflight against the
             * bucket, no cross-origin visibility gap. The part number and the
             * upload id travel with it, so the Worker writes the same part the
             * signed URL would have written. */
            etag = await retryXhrPut(partPutUrl(key, uploadId, partNum), chunk, null, (loaded) => {
              if (onProgress) onProgress((doneBytes + loaded) / file.size);
            }, 1, 10 * 60 * 1000).catch(async (ownErr) => {
              if (/_4\d\d$/.test(String(ownErr && ownErr.message))) throw ownErr;
              // The bucket route stays as the fallback for anything the Worker
              // cannot carry (a very large part, an old deployment).
              return retryXhrPut(pending[i].url, chunk, null, (loaded) => {
                if (onProgress) onProgress((doneBytes + loaded) / file.size);
              }, 3, 10 * 60 * 1000);
            });
            break;
          } catch (e) {
            // 403 = this part's signed URL expired mid-upload. Get a fresh one
            // and try the same part again instead of failing the publish.
            if (attempt === 0 && /_403$/.test(String(e && e.message))) {
              await ressignParts(i);
              continue;
            }
            throw e;
          }
        }

        if (!etag) {
          throw new Error('upload_etag_missing');
        }

        doneBytes += (end - start);
        if (onProgress) onProgress(doneBytes / file.size);

        completedParts.push({ PartNumber: partNum, ETag: etag });
      }

      // 3. Complete multipart upload (with retry — transient failures here
      // used to leave fully-uploaded files dangling as aborted uploads).
      let completed = false;
      for (let attempt = 0; attempt <= 2 && !completed; attempt++) {
        try {
          await api('/api/admin/multipart/complete', {
            method: 'POST',
            timeoutMs: 30000,
            body: { key, uploadId, parts: completedParts },
          });
          completed = true;
        } catch (err) {
          if (attempt === 2) throw err;
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }

      return trackUploaded(key, kind);
    } catch (err) {
      // Abort multipart upload on failure (cleanup)
      api('/api/admin/multipart/abort', {
        method: 'POST',
        body: { key, uploadId },
      }).catch(() => {});
      throw err;
    }
  }

  function dropzone({ accept, multiple = false, label = 'انقر أو اسحب الملف هنا', onFiles }) {
    let chosen = [];
    const dz = el('div', { class: 'dropzone', tabindex: '0' },
      ico('upload', 'icon icon-xxl'),
      el('div', null, label),
      el('div', { class: 'filename muted' }, ''),
    );
    const list = el('div', { class: 'upload-list' });
    const wrap = el('div', null, dz, list);
    const inp = el('input', { type: 'file', accept: accept || '*/*', multiple, style: 'display:none' });

    inp.addEventListener('change', () => {
      const files = Array.from(inp.files || []);
      chosen = multiple ? files : files.slice(0, 1);
      updateUI();
      if (onFiles) onFiles(chosen);
    });
    dz.addEventListener('click', () => inp.click());
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') inp.click(); });
    ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault(); dz.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('over')));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []);
      chosen = multiple ? files : files.slice(0, 1);
      updateUI();
      if (onFiles) onFiles(chosen);
    });

    function updateUI() {
      const fn = dz.querySelector('.filename');
      if (chosen.length === 0) { fn.textContent = ''; return; }
      if (chosen.length === 1) fn.textContent = `${chosen[0].name} (${formatBytes(chosen[0].size)})`;
      else fn.textContent = `${chosen.length} ملف، ${formatBytes(chosen.reduce((s, f) => s + f.size, 0))}`;
    }

    wrap.appendChild(inp);
    wrap.getFiles = () => chosen;
    wrap.reset = () => { chosen = []; inp.value = ''; updateUI(); list.innerHTML = ''; };
    wrap.setProgress = (idx, ratio) => {
      let row = list.children[idx];
      if (!row) {
        row = el('div', { class: 'item' },
          el('span', null, chosen[idx]?.name || ''),
          el('div', { class: 'progress' }, el('div', null)),
        );
        list.append(row);
      }
      row.querySelector('.progress > div').style.width = `${Math.round(ratio * 100)}%`;
    };
    return wrap;
  }

  // ---------------- views ----------------

  async function renderLogin() {
    root.innerHTML = '';

    const passInput = el('input', {
      name: 'password',
      type: 'password',
      required: true,
      autofocus: true,
      autocomplete: 'current-password',
      placeholder: 'كلمة مرور الإدارة',
      'aria-label': 'كلمة مرور الإدارة',
    });

    const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-block btn-lg mt-md' },
      ico('shield'), 'دخول مباشر');

    function setBusy(busy) {
      submitBtn.disabled = busy;
      passInput.disabled = busy;
      submitBtn.innerHTML = '';
      if (busy) {
        submitBtn.append(el('div', { class: 'spinner', style: 'width:18px; height:18px; border-width:2px;' }));
      } else {
        submitBtn.append(ico('shield'), document.createTextNode('دخول مباشر'));
      }
    }

    // Turns a failed request into the TRUTH about what went wrong. «كلمة المرور
    // غير صحيحة» is only ever shown for a real 401 — never for a network or
    // server failure, because that used to send the owner hunting a password
    // problem that did not exist.
    function describeLoginError(err) {
      const st = err && typeof err.status === 'number' ? err.status : 0;
      if (st === 401 || st === 403) return 'كلمة المرور غير صحيحة';
      if (st === 0 || (err && err.message === 'timeout')) {
        return 'تعذّر الوصول إلى الخادم من هذا الجهاز (لا اتصال). تحقّق من الشبكة ثم أعد المحاولة.';
      }
      if (st === 522 || st === 524 || st === 504) {
        return 'الخادم متوقف مؤقتاً عند Cloudflare (رمز 522) — الموقع يفتح لكن خدمة الدخول لا تستجيب. كلمة المرور سليمة، والمشكلة ليست منك.';
      }
      if (st === 502 || st === 503) return 'بوابة Cloudflare لا تستجيب (رمز ' + st + '). كلمة المرور سليمة — الخدمة متوقفة مؤقتاً.';
      if (st === 404) return 'مسار الدخول غير موجود على الخادم (404) — النسخة المنشورة قديمة. كلمة المرور ليست السبب.';
      if (st === 500) return 'إعدادات الخادم ناقصة (500). كلمة المرور ليست السبب.';
      return 'تعذّر الدخول لسبب في الخادم (رمز ' + (st || '؟') + ') — وليس كلمة المرور.';
    }

    // One quick probe BEFORE spending the owner's password: if the API is down,
    // say so plainly instead of blaming the password.
    async function serverReachable() {
      try {
        await api('/api/settings', { timeoutMs: 6000 });
        return { ok: true };
      } catch (err) {
        const st = err && typeof err.status === 'number' ? err.status : 0;
        if (st === 0 || (err && err.message === 'timeout')) return { ok: false, kind: 'offline' };
        if (st >= 500 || st === 404) return { ok: false, kind: 'down', status: st };
        return { ok: true };
      }
    }

    const form = el('form', { class: 'form', autocomplete: 'on', onsubmit: async (e) => {
      e.preventDefault();
      const password = passInput.value;
      if (!password) { passInput.focus(); return; }
      setBusy(true);
      const health = await serverReachable();
      if (!health.ok) {
        setBusy(false);
        passInput.focus();
        toast(health.kind === 'offline'
          ? 'لا يوجد اتصال بالخادم من جهازك. كلمة المرور لم تُرسل أصلاً — تحقّق من الشبكة.'
          : 'خدمة الدخول متوقفة مؤقتاً عند Cloudflare (رمز ' + health.status + '). كلمة المرور سليمة ولم تُرسل. حاول بعد قليل.',
        'error');
        return;
      }
      // Step 1 — the password alone. Nothing else can make this look like a bad password.
      try {
        await api('/api/login', { method: 'POST', body: { password } });
      } catch (err) {
        setBusy(false);
        if (!(err && (err.status === 401 || err.status === 403))) passInput.focus();
        else passInput.select();
        toast(describeLoginError(err), 'error');
        return;
      }
      // Step 2 — the dashboard. If THIS fails the password was still correct, so
      // say exactly that instead of pretending the login was rejected.
      try {
        activeTab = 'dashboard';
        await renderApp();
      } catch (err) {
        setBusy(false);
        toast('تم الدخول بنجاح، لكن تعذّر تحميل بيانات اللوحة: ' + describeLoginError(err), 'error');
      }
    } });

    form.append(
      el('div', { class: 'field' },
        el('label', { for: 'admin-pass' }, 'كلمة المرور'),
        passInput,
        el('div', { class: 'hint' }, 'الدخول للإدارة فقط — لا يوجد تسجيل عام.'),
      ),
      submitBtn,
    );
    // Hidden username field for password-manager UX (kept off-screen).
    form.prepend(el('input', {
      type: 'text', name: 'username', value: 'admin', autocomplete: 'username',
      tabindex: '-1', 'aria-hidden': 'true',
      style: 'position:absolute; opacity:0; pointer-events:none; height:0; width:0; padding:0; margin:0; border:0;',
    }));

    const themeBtn = themeToggleBtn();
    themeBtn.classList.remove('tab');
    themeBtn.classList.add('theme-toggle-float');
    const wrap = el('div', { class: 'login-wrap' },
      themeBtn,
      el('div', { class: 'login-card' },
        el('div', { class: 'title' }, ico('shield'), ' دخول الإدارة'),
        el('div', { class: 'sub' }, 'صفحة مخصصة لمالك المتجر فقط — أدخل كلمة المرور للمتابعة.'),
        form,
      ),
    );
    root.append(wrap);
    setTimeout(() => passInput.focus(), 0);
  }

  /* Language switcher in the admin console. Reuses the storefront's
     self-contained GSI18N component (curated dictionary, no API calls). */
  function adminLangSwitcher() {
    try {
      if (window.GSI18N && typeof window.GSI18N.switcherEl === 'function') {
        const n = window.GSI18N.switcherEl();
        n.classList.add('admin-lang-switch');
        return n;
      }
    } catch (e) {}
    return el('span', { class: 'admin-lang-switch' });
  }

  /* Explicit, short-lived admin preview: visitors remain locked. The new tab
     is opened synchronously (popup-safe), then the signed cookie is issued
     before navigating it to the storefront. */
  async function openStorePreview() {
    const win = window.open('about:blank', '_blank');
    if (win) { try { win.opener = null; } catch (e) {} }
    try {
      await api('/api/admin/maintenance-preview', { method: 'POST' });
      if (win && !win.closed) win.location.replace('/');
      else window.open('/', '_blank', 'noopener');
      toast(t('معاينة المدير مفعّلة'), 'success');
    } catch (e) {
      if (win && !win.closed) { try { win.close(); } catch (e2) {} }
      toast(t('تعذّر فتح معاينة المدير'), 'error');
    }
  }
  async function endStorePreview() {
    try {
      await api('/api/admin/maintenance-preview/end', { method: 'POST' });
      toast(t('تم إنهاء معاينة المدير'), 'success');
    } catch (e) { toast(t('تعذّر إنهاء معاينة المدير'), 'error'); }
  }

  function renderTopbar() {
    const themeBtn = themeToggleBtn();
    themeBtn.classList.remove('tab');
    themeBtn.classList.add('icon-btn');
    const logoutBtn = el('button', {
      class: 'icon-btn', type: 'button', 'aria-label': 'خروج', title: 'خروج',
      onclick: async () => {
        try { await api('/api/logout', { method: 'POST' }); } catch {}
        renderLogin();
      },
    }, ico('logout'));
    const searchTrigger = el('button', {
      class: 'admin-search-trigger', type: 'button',
      'aria-label': t('بحث سريع'), title: t('بحث سريع'),
      onclick: () => openCommandPalette(),
    }, ico('search', 'icon'),
      el('span', { class: 'admin-search-trigger-label' }, t('ابحث في الأقسام والتطبيقات')),
      el('kbd', { class: 'admin-kbd' }, 'Ctrl K'));
    const storeLink = el('button', {
      class: 'icon-btn admin-preview-site-icon', type: 'button',
      'aria-label': t('دخول المتجر أثناء الصيانة'), title: t('دخول المتجر أثناء الصيانة'),
      onclick: () => openStorePreview(),
    }, ico('external'));
    const pinBtn = el('button', {
      class: 'icon-btn admin-pin-btn' + (readPinned().includes(activeTab) ? ' admin-density-btn is-on' : ''),
      type: 'button', 'aria-label': t('تثبيت القسم'), title: t('تثبيت القسم'),
      onclick: () => togglePin(activeTab),
    }, ico('star'));
    const helpBtn = el('button', {
      class: 'icon-btn admin-help-btn', type: 'button', 'aria-label': t('اختصارات لوحة المفاتيح'),
      title: t('اختصارات لوحة المفاتيح'), onclick: () => showShortcutsDialog(),
    }, ico('help'));
    const group = groupForTab(activeTab) || NAV_GROUPS[0];
    const crumb = el('div', { class: 'admin-breadcrumb' },
      el('span', null, 'Golden Store'),
      el('span', { class: 'admin-crumb-sep' }, '/'),
      el('span', null, t(group.label)),
      el('span', { class: 'admin-crumb-sep' }, '/'),
      el('strong', null, currentNavLabel()));
    return el('div', { class: 'admin-topbar' },
      el('div', { class: 'admin-topbar-inner' },
        el('a', { class: 'admin-brand', href: '/', 'aria-label': 'Golden Store' },
          el('img', { src: '/images/logo.png', alt: 'Golden Store' }),
          el('span', null, 'Golden'), el('b', null, 'Store')),
        crumb,
        el('div', { class: 'spacer' }),
        el('div', { class: 'admin-title' }, 'لوحة التحكم'),
        el('div', { class: 'admin-actions' }, adminLangSwitcher(), widthSelect(), searchTrigger, pinnedBar(), pinBtn, helpBtn, storeLink, themeBtn, logoutBtn),
      ),
    );
  }

  // ---------- Grouped sidebar (desktop) / tab strip (mobile) ----------
  function renderAdminNav() {
    const logoutTab = el('button', { class: 'tab admin-nav-logout', onclick: async () => {
      try { await api('/api/logout', { method: 'POST' }); } catch {}
      renderLogin();
    } }, ico('logout'), 'خروج');
    return el('nav', { class: 'admin-tabs', id: 'adminNav', 'aria-label': t('لوحة التحكم') },
      ...NAV_GROUPS.map((g) => el('div', { class: 'admin-nav-group', 'data-group': g.id },
        el('div', { class: 'admin-nav-label' }, ico(g.icon, 'icon'), t(g.label)),
        ...g.items.map((i) => tabBtn(i.key, i.icon, i.label)))),
      el('div', { class: 'admin-nav-foot' }, el('span', { class: 'tab-spacer' }), logoutTab),
    );
  }

  // ---------- Command palette (Ctrl+K / Cmd+K) ----------
  let paletteOpen = false;
  function openCommandPalette() {
    if (paletteOpen) return;
    paletteOpen = true;
    const overlay = el('div', { class: 'admin-palette-overlay', role: 'dialog', 'aria-modal': 'true' });
    const input = el('input', {
      class: 'admin-palette-input', type: 'search',
      placeholder: t('ابحث في الأقسام والتطبيقات'),
      'aria-label': t('بحث سريع'), autocomplete: 'off',
    });
    const list = el('div', { class: 'admin-palette-list', role: 'listbox' });
    const hint = el('div', { class: 'admin-palette-hint' }, '↑ ↓  للتنقل   ·   Enter  للفتح   ·   Esc  للإغلاق');
    const box = el('div', { class: 'admin-palette' }, input, list, hint);
    overlay.append(box);
    document.body.append(overlay);
    document.body.classList.add('admin-palette-open');
    try { input.focus(); } catch (e) {}

    const navItems = [];
    NAV_GROUPS.forEach((g) => g.items.forEach((i) => navItems.push({
      label: i.label, sub: t(g.label), icon: i.icon, run: () => goTab(i.key),
    })));
    let entries = navItems.slice();
    let cursor = 0;
    function close() {
      if (!paletteOpen) return;
      paletteOpen = false;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      document.body.classList.remove('admin-palette-open');
    }
    function render() {
      list.innerHTML = '';
      if (!entries.length) { list.append(el('div', { class: 'admin-palette-empty' }, t('لا توجد نتائج'))); return; }
      entries.slice(0, 12).forEach((e, idx) => {
        const row = el('button', {
          type: 'button', role: 'option',
          class: 'admin-palette-item' + (idx === cursor ? ' is-active' : ''),
          'aria-selected': idx === cursor ? 'true' : 'false',
          onmouseenter: () => { cursor = idx; render(); },
          onclick: () => { close(); e.run(); },
        }, ico(e.icon || 'search', 'icon'),
          el('span', { class: 'admin-palette-item-main' }, e.label),
          el('span', { class: 'admin-palette-item-sub' }, e.sub || ''));
        list.append(row);
      });
    }
    function filter() {
      const q = input.value.trim().toLowerCase();
      cursor = 0;
      entries = navItems.filter((e) => !q || (e.label + ' ' + e.sub).toLowerCase().includes(q));
      // Apps are appended asynchronously; keep nav results available instantly.
      appEntries.filter((e) => !q || e.label.toLowerCase().includes(q)).slice(0, 8).forEach((e) => entries.push(e));
      render();
    }
    let appEntries = [];
    api('/api/admin/apps').then(({ apps = [] }) => {
      appEntries = apps.map((a) => ({
        label: a.name || a.slug, sub: a.type === 'game' ? 'لعبة' : 'تطبيق', icon: 'apps',
        run: () => goTab(`edit:${a.id}`),
      }));
      filter();
    }).catch(() => {});
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); cursor = Math.min(cursor + 1, Math.min(entries.length, 12) - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = Math.max(cursor - 1, 0); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); const hit = entries[cursor]; close(); if (hit) hit.run(); }
    }
    document.addEventListener('keydown', onKey, true);
    input.addEventListener('input', filter);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    render();
  }

  async function renderApp() {
    showSpinner();
    try {
      cats = (await api('/api/categories')).categories;
    } catch {}
    root.innerHTML = '';

    const shell = el('div', { class: 'admin-shell' });
    const topbar = renderTopbar();

    const nav = renderAdminNav();
    const body = el('div', { class: 'admin-body', id: 'tab-body' });
    shell.append(topbar, nav, body);
    root.append(shell);

    if (activeTab === 'dashboard') await renderDashboard(body);
    else if (activeTab === 'apps') await renderAppsList(body, 'app');
    else if (activeTab === 'games') await renderAppsList(body, 'game');
    else if (activeTab === 'new') await renderNewApp(body);
    else if (activeTab === 'requests') await renderRequests(body);
    else if (activeTab === 'reports') await renderReports(body);
    else if (activeTab === 'support') await renderSupport(body);
    else if (activeTab === 'users') await renderUsers(body);
    else if (activeTab === 'collect') await renderCollectInfo(body);
    else if (activeTab === 'notifications') await renderNotifications(body);
    else if (activeTab === 'advanced-push') {
      if (window.GSAdminAdvanced) await window.GSAdminAdvanced.renderPush(body);
      else body.innerHTML = '<div class="hint">تعذّر تحميل وحدة الإشعارات المتقدمة — أعد تحميل الصفحة.</div>';
    }
    else if (activeTab === 'insights') await renderInsights(body);
    else if (activeTab === 'firebase') await renderFirebaseCenter(body);
    else if (activeTab === 'cloudflare') await renderCloudflareCenter(body);
    else if (activeTab === 'languages') await renderLanguages(body);
    else if (activeTab === 'analytics') {
      if (window.GSAdminAdvanced) await window.GSAdminAdvanced.renderAnalytics(body);
      else body.innerHTML = '<div class="hint">تعذّر تحميل وحدة الإحصائيات — أعد تحميل الصفحة.</div>';
    }
    else if (activeTab === 'app-update') await renderAppUpdate(body);
    else if (activeTab === 'publishing') await renderPublishing(body);
    else if (activeTab === 'categories') await renderCategories(body);
    else if (activeTab === 'activity') await renderActivity(body);
    else if (activeTab === 'team') await renderTeam(body);
    else if (activeTab === 'security') await renderSecurity(body);
    else if (activeTab === 'backup') await renderBackup(body);
    else if (activeTab === 'storage-cleanup') await renderStorageCleanup(body);
    else if (activeTab === 'cloud') await renderCloudPanel(body);
    else if (activeTab === 'quality') await renderQuality(body);
    else if (activeTab === 'preview') await renderDevicePreview(body);
    else if (activeTab === 'settings') await renderStoreSettings(body);
    else if (activeTab.startsWith('edit:')) await renderEditApp(body, activeTab.slice(5));
  }

  function tabBtn(key, icon, label) {
    return el('button', {
      class: `tab ${activeTab === key ? 'active' : ''}`,
      type: 'button', title: label,
      'data-tab': key,
      'aria-current': activeTab === key ? 'page' : null,
      onclick: () => { goTab(key); },
    }, ico(icon), el('span', { class: 'admin-tab-label' }, label));
  }

  // -------- dashboard --------
  /* One-click repair of ratings left stale by comments deleted before the
     authoritative engine existed. Shows the live drift counter from stats. */
  function ratingsRepairPanel(stats, body) {
    const note = el('div', { class: 'sub' },
      t('إعادة احتساب متوسطات التقييم من سجل التقييمات الفعلي لإزالة أثر التعليقات المحذوفة.'),
      stats && stats.ratings_drift
        ? el('span', { class: 'admin-drift-badge' }, `${formatNum(stats.ratings_drift)} ${t('تطبيق يحتاج تصحيحاً')}`)
        : el('span', { class: 'admin-drift-badge is-ok' }, t('الاحتساب مطابق للسجل')));
    const button = el('button', { class: 'btn btn-secondary btn-sm', type: 'button',
      onclick: async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        try {
          const r = await api('/api/admin/recompute-ratings', { method: 'POST', body: {} });
          logAdminAction('إعادة احتساب التقييمات');
          toast(`${t('تم تصحيح')} ${formatNum(r.changed || 0)} / ${formatNum(r.apps || 0)} ${t('تطبيق')}`, 'success');
          renderDashboard(body);
        } catch { toast(t('تعذّر إعادة الاحتساب'), 'error'); }
        btn.disabled = false;
      } }, ico('refresh'), t('إعادة احتساب التقييمات'));
    return el('div', { class: 'admin-ratings-repair' }, note, button);
  }


  /* =======================================================================
     Firebase Command Center — real FCM/credentials data, no secrets exposed.
     ======================================================================= */
  async function renderFirebaseCenter(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    let fb = { config: {}, fcm: {}, unified: {}, usage: [], registrations: [], logs: [] };
    try { fb = (await api('/api/admin/firebase/status')).firebase || fb; } catch (e) {}
    const cfg = fb.config || {}, fcm = fb.fcm || {}, uni = fb.unified || {};
    const usage = Array.isArray(fb.usage) ? fb.usage : [];
    const regs = Array.isArray(fb.registrations) ? fb.registrations : [];
    const logs = Array.isArray(fb.logs) ? fb.logs : [];
    const channels = uni.channels || {};
    const native = Number((channels.native || {}).total || 0);
    const web = Number((channels.web || {}).total || 0);
    const devices = Number(uni.devices_total || native + web || 0);
    const eligible = Number(uni.devices_eligible || 0);
    const delivery = uni.delivery || {};
    const deliveryTotal = Object.values(delivery).reduce((n, v) => n + Number(v || 0), 0);
    const failed = Number(delivery.failed || delivery.error || 0);
    const successPct = deliveryTotal ? Math.round(((deliveryTotal - failed) / deliveryTotal) * 100) : 0;
    body.innerHTML = '';

    const testResult = el('div', { class: 'cc-status-box' }, t('لم يُجرَ اختبار الاتصال بعد.'));
    async function runTest() {
      testResult.textContent = t('جارٍ اختبار بيانات الاعتماد…');
      try {
        const r = await api('/api/admin/firebase/test', { method: 'POST', body: {} });
        testResult.textContent = r.connected
          ? `${t('الاتصال ناجح')} • ${t('زمن الاستجابة')}: ${formatNum(r.latency_ms || 0)} ms • ${String(r.note || '')}`
          : `${t('تعذّر الاتصال')} • ${String(r.error || '')} ${String(r.hint || '')}`;
        testResult.classList.toggle('is-ok', !!r.connected);
        toast(r.connected ? t('Firebase متصل') : t('تعذّر الاتصال'), r.connected ? 'success' : 'error');
      } catch (e) { testResult.textContent = t('تعذّر الاتصال') + ': ' + (e.message || ''); }
    }
    const actions = [
      ccAction(t('اختبار اتصال Firebase'), 'shieldCheck', runTest),
      ccAction(t('إرسال إشعار تجريبي'), 'bell', async () => {
        try {
          const r = await api('/api/admin/push/test', { method: 'POST',
            body: { title: t('إشعار تجريبي'), body: t('اختبار من مركز Firebase') } });
          toast(`${t('تم الإرسال')}: ${formatNum((r.push && r.push.targeted) || 0)}`, 'success');
          logAdminAction('اختبار FCM من مركز Firebase');
        } catch (e) { toast(t('تعذّر إرسال الإشعار'), 'error'); }
      }),
      ccAction(t('مزامنة المواضيع'), 'refresh', async () => {
        try {
          const r = await api('/api/admin/push/sync-topics', { method: 'POST', body: { all: true } });
          toast(`${t('تمت المزامنة')}: ${formatNum(r.subscribed || 0)}`, 'success');
        } catch (e) { toast(t('تعذّر المزامنة'), 'error'); }
      }),
      ccAction(t('تفريغ الطابور'), 'upload', async () => {
        try {
          const r = await api('/api/admin/push/flush', { method: 'POST', body: {} });
          toast(`${t('تم التفريغ')}: ${formatNum(r.processed || r.drained || 0)}`, 'success');
        } catch (e) { toast(t('تعذّر التفريغ'), 'error'); }
      }),
      ccAction(t('تحديث'), 'refresh', () => renderFirebaseCenter(body)),
    ];

    const configRows = [
      [t('معرّف المشروع'), cfg.project_id || '—', !!cfg.project_id],
      [t('بريد حساب الخدمة'), cfg.client_email_masked || '—', !!cfg.client_email_masked],
      [t('مفتاح API'), cfg.api_key_present ? t('موجود') : t('غير موجود'), !!cfg.api_key_present],
      [t('مفتاح الخدمة الخاص'), cfg.private_key_source || t('غير موجود'), !!cfg.service_account_present],
      [t('جاهزية الإعداد'), cfg.configured ? t('مكتمل') : t('ناقص'), !!cfg.configured],
    ];
    const configList = el('div', { class: 'cc-config-list' },
      ...configRows.map((row) => el('div', { class: 'cc-config-row' },
        el('span', null, row[0]), el('strong', null, row[1]),
        el('i', { class: 'cc-config-dot ' + (row[2] ? 'is-ok' : 'is-warn') }))));

    const usageBars = categoryBars(usage.slice().reverse().map((u) => ({
      key: String(u.day || '').slice(5), count: Number(u.reads || 0) + Number(u.writes || 0),
    })));
    const channelDonut = donutSvg(devices ? Math.round((native / devices) * 100) : 0, t('أصلي'));
    const deliveryDonut = donutSvg(successPct, t('ناجح'));

    const regTable = el('table', { class: 'table admin-table cc-table' });
    regTable.append(el('thead', null, el('tr', null,
      el('th', null, t('القناة')), el('th', null, t('المنصة')),
      el('th', null, t('المعرّف')), el('th', null, t('التاريخ')))));
    const regBody = el('tbody');
    (regs.length ? regs : []).forEach((r) => regBody.append(el('tr', null,
      el('td', { 'data-label': t('القناة') }, String(r.channel || r.platform || '—')),
      el('td', { 'data-label': t('المنصة') }, String(r.platform || '—')),
      el('td', { 'data-label': t('المعرّف') }, String(r.uid_masked || r.installation_id || '—')),
      el('td', { 'data-label': t('التاريخ') }, r.created_at ? formatDate(r.created_at) : '—'))));
    if (!regs.length) regBody.append(el('tr', null, el('td', { colspan: '4' }, t('لا تسجيلات بعد'))));
    regTable.append(regBody);

    const logTable = el('table', { class: 'table admin-table cc-table' });
    logTable.append(el('thead', null, el('tr', null,
      el('th', null, t('الإشعار')), el('th', null, t('مستهدف')),
      el('th', null, t('ناجح')), el('th', null, t('فاشل')), el('th', null, t('التاريخ')))));
    const logBody = el('tbody');
    (logs.length ? logs : []).forEach((r) => logBody.append(el('tr', null,
      el('td', { 'data-label': t('الإشعار') }, String(r.notification_id || '—').slice(0, 22)),
      el('td', { 'data-label': t('مستهدف') }, formatNum(r.targeted)),
      el('td', { 'data-label': t('ناجح') }, formatNum(r.success)),
      el('td', { 'data-label': t('فاشل') }, formatNum(r.failure)),
      el('td', { 'data-label': t('التاريخ') }, r.created_at ? formatDate(r.created_at) : '—'))));
    if (!logs.length) logBody.append(el('tr', null, el('td', { colspan: '5' }, t('لا عمليات إرسال بعد'))));
    logTable.append(logBody);

    const deliveryLegend = el('div', { class: 'cc-donut-legend' });
    Object.keys(delivery).forEach((k) => deliveryLegend.append(
      el('div', null, `${k}: ${formatNum(delivery[k])}`)));
    if (!Object.keys(delivery).length) deliveryLegend.append(el('div', null, t('لا عمليات بعد')));
    const deliveryRatioRow = el('div', { class: 'cc-donut-row' }, deliveryDonut, deliveryLegend);

    body.append(
      el('div', { class: 'admin-page-head cc-head' },
        el('div', null,
          el('h1', { class: 'admin-page-title' }, t('مركز Firebase')),
          el('p', { class: 'admin-page-sub' }, t('حالة بيانات الاعتماد، أجهزة FCM، التسليم، والاستخدام — بيانات حقيقية بلا أسرار.'))),
        el('div', { class: 'admin-head-actions' }, ccPill(t('المشروع'), !!cfg.configured, cfg.project_id || t('غير مهيّأ')))),
      el('div', { class: 'cc-grid' },
        ccCard(t('الأجهزة الموحّدة'), formatNum(devices), t('سجل واحد لكل جهاز'), 'cc-gold', usage.map((u) => Number(u.reads || 0) + Number(u.writes || 0))),
        ccCard(t('المؤهّلة للاستقبال'), formatNum(eligible), t('إذن ممنوح وحساب مفعل'), 'cc-green'),
        ccCard(t('تسجيلات آخر 24 ساعة'), formatNum(fcm.registrations_24h || 0), t('من التطبيق والمتصفح'), 'cc-blue'),
        ccCard(t('وظائف قيد الانتظار'), formatNum(uni.pending_jobs || fcm.pending_jobs || 0), t('يُفرَغ تلقائياً عبر Cron'), 'cc-purple')),
      el('div', { class: 'cc-panel-grid' },
        el('div', { class: 'panel cc-panel' },
          el('div', { class: 'panel-head' }, ico('shieldCheck', 'icon'), t('فحص بيانات الاعتماد')),
          configList, testResult,
          el('div', { class: 'cc-actions' }, ...actions)),
        el('div', { class: 'panel cc-panel' },
          el('div', { class: 'panel-head' }, ico('android', 'icon'), t('توزيع القنوات')),
          el('div', { class: 'cc-donut-row' },
            channelDonut,
            el('div', { class: 'cc-donut-legend' },
              el('div', null, `${t('أصلي')}: ${formatNum(native)}`),
              el('div', null, `${t('ويب')}: ${formatNum(web)}`),
              el('div', null, `${t('المشتركين في الموضوع')}: ${formatNum(fcm.native_subscribed || 0)}`))),
          el('div', { class: 'panel-head' }, ico('check', 'icon'), t('نسبة التسليم')),
          deliveryRatioRow)),
      el('div', { class: 'cc-panel-grid' },
        el('div', { class: 'panel cc-panel' },
          el('div', { class: 'panel-head' }, ico('database', 'icon'), t('استخدام Firebase (7 أيام)')),
          usageBars),
        el('div', { class: 'panel cc-panel' },
          el('div', { class: 'panel-head' }, ico('clock', 'icon'), t('أحدث التسجيلات')),
          el('div', { class: 'table-wrap' }, regTable))),
      el('div', { class: 'panel cc-panel' },
        el('div', { class: 'panel-head' }, ico('send', 'icon'), t('سجل عمليات الإرسال')),
        el('div', { class: 'table-wrap' }, logTable),
        el('div', { class: 'hint' }, t('كل الأرقام من D1 و FCM v1 — لا قيم مُخمّنة.'))),
    );
  }

  /* =======================================================================
     Cloudflare GraphQL Analytics — selectable range, chart, diagnostics.
     ======================================================================= */
  async function renderCloudflareCenter(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    const rangeSel = el('select', { class: 'input admin-table-filter', 'aria-label': t('المدى الزمني') },
      el('option', { value: '7' }, '7 ' + t('أيام')),
      el('option', { value: '14' }, '14 ' + t('يوم')),
      el('option', { value: '30' }, '30 ' + t('يوم')));
    let days = 7;
    let payload = { cloudflare: {}, derived: {} };
    const load = async () => {
      try { payload = await api(`/api/admin/cloudflare/analytics?days=${days}`) || payload; }
      catch (e) { payload = { cloudflare: {}, derived: {}, error: String(e.message || e) }; }
      return payload;
    };
    await load();
    const cf = payload.cloudflare || {}, d = payload.derived || {};
    const series = Array.isArray(cf.series) ? cf.series : [];
    const cfg = cf.config || {};
    const status = el('div', { class: 'cc-status-box' });
    function showDiagnostics(x) {
      const c = x.config || cfg;
      const bits = [
        `${t('المصدر')}: ${x.source === 'zones' ? 'Zone' : x.source === 'accounts' ? 'Account' : '—'}`,
        `CF_API_TOKEN: ${c.has_token ? t('موجود') + ' (…' + (c.token_tail || '') + ')' : t('غير موجود')}`,
        `Account: ${c.has_account ? String(c.account_source || t('موجود')) : t('غير موجود')}`,
        `CF_ZONE_ID: ${c.has_zone ? t('موجود') : t('غير موجود')}`,
      ];
      if (x.from) bits.push(`${t('الفترة')}: ${x.from} → ${x.until_exclusive || ''}`);
      const attempts = x.attempts || [];
      if (attempts.length) bits.push(`${t('المحاولات')}: ` + attempts.map((a) =>
        `${a.source} HTTP ${a.status}` + ((a.errors || []).length ? ` (${String(a.errors[0]).slice(0, 60)})` : '')).join(' | '));
      let text = bits.join(' • ');
      if (x.error) text += '\n' + t('الخطأ') + ': ' + x.error;
      if (x.hint) text += '\n' + x.hint;
      status.textContent = text;
      status.classList.toggle('is-ok', !!x.source && !x.error);
    }
    showDiagnostics(cf);
    body.innerHTML = '';

    const chartHost = el('div', { class: 'admin-svg-wrap cc-chart' });
    const redrawChart = () => {
      chartHost.innerHTML = '';
      chartHost.append(series.length
        ? lineChartSvg(series.map((r) => ({ count: Number(r.requests || 0), day: r.date })))
        : el('div', { class: 'hint' }, t('لا توجد بيانات GraphQL لهذا المدى.')));
    };
    redrawChart();

    const tableWrap = el('div', { class: 'table-wrap' });
    const table = el('table', { class: 'table admin-table cc-table' });
    table.append(el('thead', null, el('tr', null,
      el('th', null, t('اليوم')), el('th', null, t('الطلبات')),
      el('th', null, t('البايتات')), el('th', null, t('مخزّنة')), el('th', null, t('التهديدات')))));
    const tbody = el('tbody');
    if (!series.length) tbody.append(el('tr', null, el('td', { colspan: '5' }, t('لا توجد بيانات بعد'))));
    else series.slice().reverse().forEach((r) => tbody.append(el('tr', null,
      el('td', { 'data-label': t('اليوم') }, String(r.date || '—')),
      el('td', { 'data-label': t('الطلبات') }, formatNum(r.requests)),
      el('td', { 'data-label': t('البايتات') }, formatBytes(r.bytes || 0)),
      el('td', { 'data-label': t('مخزّنة') }, formatNum(r.cachedRequests)),
      el('td', { 'data-label': t('التهديدات') }, formatNum(r.threats)))));
    table.append(tbody); tableWrap.append(table);

    const diagnosticsPanel = el('div', { class: 'panel cc-panel' },
      el('div', { class: 'panel-head' }, ico('wrench', 'icon'), t('تشخيص الاتصال')),
      status,
      el('div', { class: 'cc-actions' },
        ccAction(t('اختبار الاتصال / تشخيص'), 'refresh', async () => {
          status.textContent = t('جارٍ اختبار GraphQL…');
          try {
            const r = await api('/api/admin/push/cloudflare');
            showDiagnostics(r.cloudflare || {});
            toast(t('تم تحديث التشخيص'), 'success');
          } catch (e) { status.textContent = t('فشل الاختبار') + ': ' + (e.message || ''); }
        }),
        ccAction(t('تحديث'), 'cloud', async () => { await load(); renderCloudflareCenter(body); })),
      el('div', { class: 'cc-hint-code' }, 'npx wrangler secret put CF_API_TOKEN'),
      el('div', { class: 'hint' }, t('رمز Analytics: Read على الحساب أو النطاق + CF_ACCOUNT_ID / CF_ZONE_ID على الـ Worker.')));

    body.append(
      el('div', { class: 'admin-page-head cc-head' },
        el('div', null,
          el('h1', { class: 'admin-page-title' }, t('Cloudflare Analytics')),
          el('p', { class: 'admin-page-sub' }, t('بيانات GraphQL الحقيقية: الطلبات، النطاق، الكاش، والتهديدات — مع تشخيص كامل للإعداد.'))),
        el('div', { class: 'admin-head-actions' }, rangeSel,
          ccPill(t('GraphQL'), !!cf.configured, cf.source === 'zones' ? 'Zone' : cf.source === 'accounts' ? 'Account' : t('غير مهيّأ')))),
      el('div', { class: 'cc-grid' },
        ccCard(t('الطلبات'), formatNum(cf.requests || 0), `${d.days || days} ${t('يوم')}`, 'cc-gold', series.map((r) => Number(r.requests || 0))),
        ccCard(t('عرض النطاق'), formatBytes(cf.bytes || 0), `${t('متوسط')} ${formatNum(d.avg_bytes_per_request || 0)} B/${t('طلب')}`, 'cc-blue'),
        ccCard(t('نسبة الكاش'), `${formatNum(d.cache_hit_ratio || 0)}%`, `${formatNum(cf.cached_requests || 0)} ${t('طلب مخزّن')}`, 'cc-green'),
        ccCard(t('التهديدات'), formatNum(cf.threats || 0), `${t('ذروة')} ${String(d.peak_day || '—')}`, 'cc-purple')),
      el('div', { class: 'cc-panel-grid' },
        el('div', { class: 'panel cc-panel' },
          el('div', { class: 'panel-head' }, ico('trending', 'icon'), t('الطلبات اليومية (GraphQL)')),
          chartHost,
          el('div', { class: 'admin-chart-legend' },
            el('span', null, series.length ? series[0].date : '—'),
            el('span', null, series.length ? series[series.length - 1].date : '—')),
          el('div', { class: 'cc-donut-row' },
            donutSvg(Number(d.cache_hit_ratio || 0), t('كاش')),
            el('div', { class: 'cc-donut-legend' },
              el('div', null, `${t('مشاهدات الصفحات')}: ${formatNum(cf.page_views || 0)}`),
              el('div', null, `${t('ذروة اليوم')}: ${formatNum(d.peak_requests || 0)}`),
              el('div', null, `${t('أيام البيانات')}: ${formatNum(d.series_length || 0)}`)))),
        diagnosticsPanel),
      el('div', { class: 'panel cc-panel' },
        el('div', { class: 'panel-head' }, ico('calendar', 'icon'), t('التفاصيل اليومية')),
        tableWrap,
        el('div', { class: 'hint' }, t('الأصفار تعني «لا بيانات» لا «خطأ»؛ استخدم التشخيص أعلاه لمعرفة السبب.'))),
    );
    rangeSel.addEventListener('change', async () => {
      days = Number(rangeSel.value) || 7;
      await load();
      renderCloudflareCenter(body);
    });
  }


  /* ---------------- Languages: switch + curated dictionary overview -------- */
  async function renderLanguages(body) {
    const current = (window.GSI18N && window.GSI18N.lang) || 'ar';
    const langs = [
      { code: 'ar', name: t('العربية'), native: 'العربية', dir: 'RTL', flag: '🇩🇿' },
      { code: 'en', name: t('الإنجليزية'), native: 'English', dir: 'LTR', flag: '🇬🇧' },
      { code: 'fr', name: t('الفرنسية'), native: 'Français', dir: 'LTR', flag: '🇫🇷' },
      { code: 'es', name: t('الإسبانية'), native: 'Español', dir: 'LTR', flag: '🇪🇸' },
      { code: 'tr', name: t('التركية'), native: 'Türkçe', dir: 'LTR', flag: '🇹🇷' },
      { code: 'de', name: t('الألمانية'), native: 'Deutsch', dir: 'LTR', flag: '🇩🇪' },
      { code: 'pt', name: t('البرتغالية'), native: 'Português', dir: 'LTR', flag: '🇵🇹' },
      { code: 'ru', name: t('الروسية'), native: 'Русский', dir: 'LTR', flag: '🇷🇺' },
      { code: 'hi', name: t('الهندية'), native: 'हिन्दी', dir: 'LTR', flag: '🇮🇳' },
      { code: 'zh', name: t('الصينية'), native: '中文', dir: 'LTR', flag: '🇨🇳' },
    ];
    body.innerHTML = '';
    function activate(code) {
      try {
        if (window.GSI18N && typeof window.GSI18N.setLang === 'function') {
          window.GSI18N.setLang(code);   // persists + reloads the whole console
        } else { localStorage.setItem('gs_lang', code); location.reload(); }
      } catch (e) { toast(t('تعذّر تغيير اللغة'), 'error'); }
    }
    const cards = langs.map((l) => el('div', {
      class: 'admin-lang-card' + (l.code === current ? ' is-active' : ''),
    },
      el('div', { class: 'admin-lang-flag' }, l.flag),
      el('div', { class: 'admin-lang-info' },
        el('strong', null, l.native),
        el('span', null, `${l.name} • ${l.dir} • ${l.code.toUpperCase()}`)),
      l.code === current
        ? el('span', { class: 'admin-lang-badge' }, t('اللغة الحالية'))
        : el('button', { class: 'btn btn-sm btn-primary', type: 'button',
          onclick: () => activate(l.code) }, t('تفعيل'))));
    body.append(
      el('div', { class: 'admin-page-head' },
        el('div', null,
          el('h1', { class: 'admin-page-title' }, t('اللغات')),
          el('p', { class: 'admin-page-sub' }, t('بدّل لغة لوحة التحكم والمتجر من مكان واحد. عشر لغات مترجمة يدوياً، فورية وبلا خدمة ترجمة خارجية.'))),
        el('div', { class: 'admin-head-actions' }, adminLangSwitcher())),
      el('div', { class: 'admin-lang-grid' }, ...cards),
      el('div', { class: 'panel cc-panel' },
        el('div', { class: 'panel-head' }, ico('globe', 'icon'), t('كيف تعمل الترجمة')),
        el('div', { class: 'cc-config-list' },
          el('div', { class: 'cc-config-row' }, el('span', null, t('المصدر')), el('strong', null, 'public/js/lang.js'), el('i', { class: 'cc-config-dot is-ok' })),
          el('div', { class: 'cc-config-row' }, el('span', null, t('اللغات المدعومة')), el('strong', null, 'AR · EN · FR · ES · TR · DE · PT · RU · HI · ZH'), el('i', { class: 'cc-config-dot is-ok' })),
          el('div', { class: 'cc-config-row' }, el('span', null, t('الاتجاه')), el('strong', null, t('عربي من اليمين لليسار، والباقي من اليسار لليمين')), el('i', { class: 'cc-config-dot is-ok' })),
          el('div', { class: 'cc-config-row' }, el('span', null, t('الاعتماد على الشبكة')), el('strong', null, t('لا يوجد')), el('i', { class: 'cc-config-dot is-ok' }))),
        el('div', { class: 'hint' }, t('كل نصوص الواجهة مترجمة يدوياً بقاموس ثابت؛ لا تُستخدم خدمة ترجمة آلية للواجهة.'))),
    );
  }

  async function renderDashboard(body) {
    liveRefreshTarget = body;
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    let stats = { total_apps: 0, total_downloads: 0, total_size_bytes: 0, top_apps: [],
      total_users: 0, pending_requests: 0, recent_reports: [], pending_list: [],
      downloads_series: [], apps_by_category: [], rating_distribution: [] };
    let update = null;
    let allApps = [];
    try { stats = await api('/api/admin/stats'); } catch (e) {}
    try { update = await api('/api/app-update'); } catch (e) {}
    try { allApps = (await api('/api/admin/apps')).apps || []; } catch (e) {}
    const qa = qaSummary(allApps);
    const recent = allApps.slice().sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0)).slice(0, 5);
    const chartRows = (stats.top_apps || []).slice(0, 6);
    const maxDl = Math.max(1, ...chartRows.map((a) => Number(a.downloads || 0)));
    body.innerHTML = '';

    const kpi = (icon, label, value, sub, spark) => el('div', { class: 'admin-kpi' + (spark ? ' has-spark' : '') },
      el('div', { class: 'admin-kpi-top' }, el('span', { class: 'admin-kpi-icon' }, ico(icon, 'icon')),
        el('span', { class: 'admin-kpi-label' }, label)),
      el('div', { class: 'admin-kpi-value' }, value),
      el('div', { class: 'admin-kpi-sub' }, sub || ''),
      spark ? el('div', { class: 'admin-kpi-spark' }, sparklineSvg(spark)) : null);

    const quick = (icon, label, key) => el('button', {
      class: 'admin-quick', type: 'button', onclick: () => goTab(key),
    }, ico(icon, 'icon'), el('span', null, label));

    const topTable = el('table', { class: 'table' },
      el('thead', null, el('tr', null,
        el('th', null, ''), el('th', null, 'الاسم'), el('th', null, 'التنزيلات'), el('th', null, ''))),
      el('tbody', null, ...(stats.top_apps || []).map((a) => el('tr', null,
        el('td', { class: 'cell-icon' }, a.icon_url ? el('img', { src: a.icon_url, class: 'ico-sm' }) : el('div', { class: 'ico-sm' })),
        el('td', { 'data-label': 'الاسم' }, a.name),
        el('td', { 'data-label': 'التنزيلات' }, formatNum(a.downloads)),
        el('td', { class: 'cell-actions' },
          el('a', { class: 'btn btn-sm btn-secondary', href: `/app?slug=${a.slug}`, target: '_blank' }, ico('external'), 'عرض')),
      ))),
    );

    const activity = readAdminActivity();
    const activityPanel = el('div', { class: 'panel admin-activity' },
      el('div', { class: 'panel-head' }, ico('clock', 'icon'), t('آخر النشاطات')),
      activity.length
        ? el('ul', { class: 'admin-activity-list' }, ...activity.map((a) => el('li', null,
            el('span', { class: 'admin-activity-dot' }),
            el('span', { class: 'admin-activity-text' }, a.label),
            el('span', { class: 'admin-activity-time' }, a.ts ? formatDate(a.ts) : ''))))
        : el('div', { class: 'hint' }, t('لا نشاطات بعد')),
    );

    const healthGrid = el('div', { class: 'admin-health-grid' });
    const healthSpec = [
      { key: 'd1', label: 'قاعدة البيانات D1', url: '/api/admin/stats' },
      { key: 'push', label: 'إشعارات FCM', url: '/api/admin/push/status' },
      { key: 'update', label: 'خدمة التحديث', url: '/api/app-update' },
      { key: 'cloudflare', label: 'Cloudflare Analytics', url: '/api/admin/push/cloudflare' },
      { key: 'firebase', label: 'Firebase / FCM', url: '/api/admin/firebase/status' },
      { key: 'graphql', label: 'GraphQL Analytics', url: '/api/admin/cloudflare/analytics?days=7' },
    ];
    healthSpec.forEach((h) => healthGrid.append(el('div', { class: 'admin-health-item', 'data-health': h.key },
      el('span', { class: 'admin-health-dot is-pending' }), el('span', null, h.label),
      el('b', null, '…'))));
    (async () => {
      for (const h of healthSpec) {
        const node = healthGrid.querySelector(`[data-health="${h.key}"]`);
        if (!node) continue;
        try {
          await api(h.url);
          node.querySelector('.admin-health-dot').className = 'admin-health-dot is-ok';
          node.querySelector('b').textContent = 'متصلة';
        } catch (e) {
          node.querySelector('.admin-health-dot').className = 'admin-health-dot is-warn';
          node.querySelector('b').textContent = 'غير متاحة';
        }
      }
    })();

    const updatePanel = el('div', { class: 'panel admin-update-summary' },
      el('div', { class: 'panel-head' }, ico('download', 'icon'), t('مركز التحديث')),
      el('div', { class: 'admin-update-row' },
        el('span', null, t('الإصدار الحالي')),
        el('strong', null, (update && update.version_name) || '—')),
      el('div', { class: 'admin-update-row' },
        el('span', null, t('التنزيلات')),
        el('strong', null, formatNum((update && update.downloads) || 0))),
      update && update.force ? el('div', { class: 'admin-update-force' }, t('تحديث إلزامي')) : null,
      el('button', { class: 'btn btn-secondary btn-sm', type: 'button',
        onclick: () => goTab('app-update') }, ico('upload', 'icon'), t('نشر تحديث جديد')),
    );

    /* ---------- Live statistics (real D1 aggregates, no fabricated data) ---------- */
    const series = Array.isArray(stats.downloads_series) ? stats.downloads_series : [];
    const categories = Array.isArray(stats.apps_by_category) ? stats.apps_by_category : [];
    const reports = Array.isArray(stats.recent_reports) ? stats.recent_reports : [];
    const pending = Array.isArray(stats.pending_list) ? stats.pending_list : [];
    const seriesTotal = series.reduce((n, d) => n + Number(d.count || 0), 0);
    const liveStamp = el('span', { class: 'admin-live-stamp' },
      stats.generated_at ? `${t('آخر تحديث')}: ${formatDate(stats.generated_at)}` : t('بيانات حية'));
    const refreshBtn = el('button', {
      class: 'btn btn-sm btn-secondary', type: 'button',
      onclick: () => renderDashboard(body),
    }, ico('refresh'), t('تحديث الإحصائيات'));
    const liveKpis = el('div', { class: 'admin-kpi-grid admin-kpi-grid-live' },
      kpi('users', t('إجمالي المستخدمين'), formatNum(stats.total_users || 0), t('معرفات حقيقية من D1')),
      kpi('download', t('تنزيلات آخر 14 يوماً'), formatNum(seriesTotal), t('من سجل التنزيلات'), series.map((d) => Number(d.count || 0))),
      kpi('flag', t('طلبات معلّقة'), formatNum(stats.pending_requests || 0), t('بانتظار المراجعة')),
      kpi('message', t('بلاغات حديثة'), formatNum(reports.length), t('مراجعات وتطبيقات')));
    const liveCharts = el('div', { class: 'admin-live-grid' },
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('trending', 'icon'), t('التنزيلات خلال 14 يوماً')),
        series.length ? el('div', { class: 'admin-svg-wrap' }, lineChartSvg(series))
          : el('div', { class: 'hint' }, t('لا توجد أحداث تنزيل بعد')),
        el('div', { class: 'admin-chart-legend' },
          el('span', null, series.length ? series[0].day : '—'),
          el('span', null, series.length ? series[series.length - 1].day : '—'))),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('grid', 'icon'), t('التطبيقات حسب التصنيف')),
        categoryBars(categories)));
    const reportRows = (rows, emptyLabel) => rows.length
      ? el('div', { class: 'admin-phase2-list' }, ...rows.slice(0, 6).map((r) =>
          el('div', { class: 'admin-phase2-row' },
            el('strong', null, r.app_name || r.app_slug || r.slug || r.reason || '—'),
            el('span', { class: 'admin-order-meta' }, r.created_at ? formatDate(r.created_at) : (r.ts ? formatDate(r.ts) : '—')))))
      : el('div', { class: 'hint' }, emptyLabel);
    const liveLists = el('div', { class: 'admin-live-grid' },
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('message', 'icon'), t('أحدث البلاغات')),
        reportRows(reports, t('لا بلاغات حديثة'))),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('flag', 'icon'), t('الطلبات المعلّقة')),
        reportRows(pending, t('لا طلبات معلّقة')),
        el('button', { class: 'btn btn-sm btn-secondary', type: 'button', style: { margin: '0 14px 14px' },
          onclick: () => goTab('requests') }, ico('external'), t('فتح الطلبات'))));
    const liveSection = el('div', { class: 'admin-live-section' },
      el('div', { class: 'admin-live-head' },
        el('div', null,
          el('h2', null, t('إحصائيات حية')),
          el('p', null, t('أرقام حقيقية من قاعدة البيانات، تُحدَّث تلقائياً كل دقيقة.'))),
        el('div', { class: 'admin-live-actions' }, liveStamp, refreshBtn)),
      liveKpis, liveCharts, liveLists);

    /* Command Center hero: live snapshot, service chips, one-click report. */
    async function exportReport() {
      let cf = null, fb = null;
      try { cf = await api('/api/admin/cloudflare/analytics?days=7'); } catch (e) {}
      try { fb = await api('/api/admin/firebase/status'); } catch (e) {}
      const report = {
        generated_at: new Date().toISOString(),
        store: stats,
        cloudflare: cf ? { derived: cf.derived, cloudflare: cf.cloudflare } : null,
        firebase: fb ? fb.firebase : null,
        note: 'Real aggregates only. No secrets are included in this report.',
      };
      try {
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: `goldenstore-report-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        logAdminAction('تصدير تقرير لوحة القيادة');
        toast(t('تم تصدير التقرير'), 'success');
      } catch (e) { toast(t('تعذّر تصدير التقرير'), 'error'); }
    }
    const hero = el('div', { class: 'cc-hero' },
      el('div', { class: 'cc-hero-main' },
        el('div', { class: 'cc-hero-kicker' }, t('مركز القيادة')),
        el('h1', null, t('مرحباً بك في لوحة تحكّم Golden Store')),
        el('p', null, t('كل ما يهمّك في شاشة واحدة: المتجر، المستخدمون، الإشعارات، Firebase و Cloudflare.'))),
      el('div', { class: 'cc-hero-side' },
        ccPill(t('المتجر'), true, t('يعمل')),
        ccPill(t('قاعدة البيانات'), true, 'D1'),
        el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: exportReport },
          ico('download'), t('تصدير تقرير')),
        el('div', { class: 'cc-hero-links' },
          el('button', { class: 'btn btn-sm btn-secondary', type: 'button', onclick: () => goTab('firebase') },
            ico('sparkle'), t('مركز Firebase')),
          el('button', { class: 'btn btn-sm btn-secondary', type: 'button', onclick: () => goTab('cloudflare') },
            ico('cloud'), t('Cloudflare Analytics')))));

    body.append(
      hero,
      el('div', { class: 'admin-page-head' },
        el('div', null,
          el('h1', { class: 'admin-page-title' }, 'لوحة المعلومات'),
          el('p', { class: 'admin-page-sub' }, 'نظرة شاملة على المتجر، المحتوى، والنمو في مكان واحد.')),
        el('div', { class: 'admin-head-actions' },
          quick('plus', 'إضافة تطبيق', 'new'),
          quick('bell', 'إشعار متقدم', 'advanced-push'))),
      el('div', { class: 'admin-kpi-grid' },
        kpi('apps', 'إجمالي التطبيقات', formatNum(stats.total_apps || 0), 'تطبيق + لعبة'),
        kpi('download', 'إجمالي التنزيلات', formatNum(stats.total_downloads || 0), 'حقيقي ومستمر'),
        kpi('storage', 'حجم التخزين', formatBytes(stats.total_size_bytes || 0), 'ملفات APK والصور'),
        kpi('trending', 'الأكثر تنزيلاً', formatNum((stats.top_apps && stats.top_apps[0] && stats.top_apps[0].downloads) || 0), (stats.top_apps && stats.top_apps[0] && stats.top_apps[0].name) || '—')),
      liveSection,
      el('div', { class: 'admin-dash-grid' },
        el('div', { class: 'panel' },
          el('div', { class: 'panel-head' }, ico('trending', 'icon'), 'الأكثر تنزيلاً'),
          (stats.top_apps || []).length ? el('div', { class: 'table-wrap' }, topTable)
            : emptyMsg('لا توجد بيانات بعد', 'ارفع تطبيقك الأول لرؤية الإحصائيات.')),
        el('div', { class: 'admin-dash-side' },
          updatePanel,
          el('div', { class: 'panel' },
            el('div', { class: 'panel-head' }, ico('spark', 'icon'), t('إجراءات سريعة')),
            el('div', { class: 'admin-quick-grid' },
              quick('apps', 'التطبيقات', 'apps'),
              quick('gamepad', 'الألعاب', 'games'),
              quick('message', 'رسائل الدعم', 'support'),
              quick('dashboard', t('الإحصائيات'), 'analytics'))),
          activityPanel)),
      el('div', { class: 'admin-dash-grid' },
        el('div', { class: 'panel' },
          el('div', { class: 'panel-head' }, ico('trending', 'icon'), t('توزيع التنزيلات')),
          chartRows.length ? el('div', { class: 'admin-bar-chart' },
            ...chartRows.map((a) => el('div', { class: 'admin-bar-col' },
              el('i', { style: { height: `${Math.max(6, Math.round((Number(a.downloads || 0) / maxDl) * 100))}%` } }),
              el('span', null, a.name || a.slug || '—'))))
            : el('div', { class: 'hint' }, t('لا توجد نتائج'))),
        el('div', { class: 'admin-dash-side' },
          el('div', { class: 'panel' },
            el('div', { class: 'panel-head' }, ico('shield', 'icon'), t('عناصر تحتاج انتباهاً')),
            el('div', { class: 'admin-quality-grid' },
              el('div', { class: 'admin-quality-stat is-warn' }, el('b', null, formatNum(qa.withIssues)), el('span', null, t('فحص الجودة'))),
              el('div', { class: 'admin-quality-stat' }, el('b', null, formatNum(qa.total)), el('span', null, t('الإجراء')))),
            el('button', { class: 'btn btn-secondary btn-sm', type: 'button', style: { margin: '0 14px 14px' },
              onclick: () => goTab('quality') }, ico('shield', 'icon'), t('فحص الجودة'))),
          el('div', { class: 'panel' },
            el('div', { class: 'panel-head' }, ico('clock', 'icon'), t('أحدث الإضافات')),
            recent.length ? el('div', { class: 'admin-phase2-list' }, ...recent.map((a) => el('div', { class: 'admin-phase2-row' },
              el('strong', null, a.name || a.slug),
              el('span', { class: 'admin-order-meta' }, a.created_at ? formatDate(a.created_at) : '—'),
              el('button', { class: 'btn btn-sm btn-secondary', type: 'button', onclick: () => goTab(`edit:${a.id}`) },
                ico('edit', 'icon'), t('معاينة')))))
              : el('div', { class: 'hint' }, t('لا توجد نتائج'))))),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('shield', 'icon'), t('صحة الخدمات')),
        healthGrid),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('refresh', 'icon'), 'صيانة'),
        el('div', { class: 'sub', style: { marginBottom: '10px' } },
          'العناصر القديمة بلا نوع محدّد تُعامَل كـ«تطبيق». اضغط لتعيين النوع لها دفعة واحدة (آمن، يُشغَّل مرة واحدة).'),
        el('button', { class: 'btn btn-secondary btn-sm', onclick: async (e) => {
          const btn = e.currentTarget; btn.disabled = true;
          try {
            const r = await api('/api/admin/migrate-types', { method: 'POST' });
            logAdminAction('تعيين أنواع العناصر القديمة');
            toast(t('تم تحديث أنواع العناصر') + ': ' + r.updated + ' / ' + r.total, 'success');
          } catch (err) {
            /* «فشل التحديث» said nothing. This route did not exist on the
               server at all until round 79, so the honest answer is the status. */
            const st = Number(err && err.status) || 0;
            toast(st === 404
              ? 'هذه الأداة غير منشورة على الخادم بعد (404).'
              : (st >= 500 || st === 0
                ? 'الخادم لم يستجب — لم يتغيّر شيء. حاول بعد قليل.'
                : `تعذّر التحديث (${st || '؟'}).`), 'error');
          }
          btn.disabled = false;
        } }, ico('check'), 'تعيين النوع للعناصر القديمة')),
        ratingsRepairPanel(stats, body),
    );
  }

  // -------- جمع المعلومات (round 39) --------
  /* Everything the create-account form collects (username, e-mail, phone,
     country, gender, age) appears HERE — and only here. The storefront never
     renders it: the block that used to sit on «أنت» was removed on request. */
  async function renderCollectInfo(body) {
    let data = { total: 0, rows: [], countries: [], genders: [], ages: [] };
    try { data = await api('/api/admin/demographics?limit=300'); } catch (e) {}
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const total = Number(data.total) || rows.length;

    function chip(label, value) {
      return el('div', { class: 'collect-chip' },
        el('span', { class: 'collect-chip-label' }, label),
        el('strong', null, value));
    }
    function bars(title, list, mapLabel) {
      const arr = Array.isArray(list) ? list : [];
      const max = arr.reduce((m, r) => Math.max(m, Number(r.count) || 0), 0) || 1;
      return el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('trending', 'icon'), title),
        arr.length ? el('div', { class: 'collect-bars' }, ...arr.map((r) => {
          const v = Number(r.count) || 0;
          const name = mapLabel ? mapLabel(String(r.key || '')) : (r.key || '—');
          return el('div', { class: 'collect-bar-row' },
            el('span', { class: 'collect-bar-name' }, name),
            el('span', { class: 'collect-bar-track' },
              el('span', { class: 'collect-bar-fill', style: { width: Math.round((v / max) * 100) + '%' } })),
            el('span', { class: 'collect-bar-count' }, String(v)));
        })) : el('div', { class: 'hint' }, t('لا توجد بيانات بعد')));
    }

    const table = el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, ico('database', 'icon'), t('البيانات المجمّعة')),
      rows.length
        ? el('div', { class: 'collect-table-wrap' },
            el('table', { class: 'collect-table' },
              el('thead', null, el('tr', null,
                ['اسم المستخدم', 'البريد الإلكتروني', 'رقم هاتف', 'الدولة', 'الجنس', 'العمر', 'التاريخ']
                  .map((h) => el('th', null, t(h))))),
              el('tbody', null, ...rows.map((r) => el('tr', null,
                el('td', { 'data-noi18n': '' }, r.username || '—'),
                el('td', { 'data-noi18n': '' }, r.email || '—'),
                el('td', { 'data-noi18n': '' }, r.phone || '—'),
                el('td', { 'data-noi18n': '' }, r.country || '—'),
                el('td', null, r.gender ? t(GENDER_LABEL[r.gender] || r.gender) : '—'),
                el('td', { 'data-noi18n': '' }, r.age ? String(r.age) : (r.age_range || '—')),
                el('td', { 'data-noi18n': '' }, r.updated_at ? formatDate(r.updated_at) : '—'))))))
        : el('div', { class: 'hint' }, t('لا توجد بيانات بعد')));

    body.append(
      el('div', { class: 'page-head' },
        el('h2', null, t('جمع المعلومات')),
        el('div', { class: 'sub' }, t('كل ما يكتبه المستخدم في نموذج إنشاء الحساب — يُحفظ هنا فقط ولا يظهر في المتجر.'))),
      el('div', { class: 'collect-chips' },
        chip(t('إجمالي المشاركين'), String(total)),
        chip(t('الدول'), String((data.countries || []).length)),
        chip(t('الجنس'), String((data.genders || []).length)),
        chip(t('الفئات العمرية'), String((data.ages || []).length))),
      el('div', { class: 'collect-grid' },
        bars(t('الدولة'), data.countries),
        bars(t('الجنس'), data.genders, (k) => t(GENDER_LABEL[k] || k)),
        bars(t('العمر'), data.ages, (k) => {
          // «20s» buckets become a readable «20-24» range; age_range keys pass through
          const n = parseInt(k, 10);
          return /^\d+s$/.test(k) && !isNaN(n) ? (n + '-' + (n + 4)) : k;
        })),
      table,
      el('div', { class: 'hint', style: { marginTop: '10px' } },
        t('تُجمع هذه البيانات فقط عندما يملأ المستخدم النموذج طوعاً. لا تظهر في أي صفحة من صفحات المتجر.')));
  }
  const GENDER_LABEL = { male: 'ذكر', female: 'أنثى', other: 'آخر', prefer_not: 'أفضّل عدم التحديد' };

  // -------- store settings --------
  const SETTINGS_SCHEMA = [
    { id: 'identity', label: 'الهوية والعلامة', icon: 'star', fields: [
      { key: 'store_name', label: 'اسم المتجر', type: 'text' },
      { key: 'tagline', label: 'العبارة التعريفية', type: 'text' },
      { key: 'support_email', label: 'بريد الدعم', type: 'email' },
      { key: 'telegram_url', label: 'رابط تليجرام', type: 'url' },
      { key: 'official_url', label: 'الموقع الرسمي', type: 'url' },
    ] },
    { id: 'appearance', label: 'المظهر واللغة', icon: 'eye', fields: [
      { key: 'theme_default', label: 'المظهر الافتراضي', type: 'select', options: [['dark','داكن'],['light','فاتح'],['system','حسب الجهاز']] },
      { key: 'accent', label: 'اللون المميز', type: 'select', options: [['gold','ذهبي'],['blue','أزرق'],['green','أخضر'],['purple','بنفسجي']] },
      { key: 'density', label: 'كثافة الواجهة', type: 'select', options: [['comfortable','مريحة'],['compact','مضغوطة']] },
      { key: 'default_language', label: 'اللغة الافتراضية', type: 'select', options: [['ar','العربية'],['en','English'],['fr','Français'],['es','Español'],['tr','Türkçe'],['de','Deutsch'],['pt','Português'],['ru','Русский'],['hi','हिन्दी'],['zh','中文']] },
    ] },
    { id: 'content', label: 'المحتوى والنشر', icon: 'apps', fields: [
      { key: 'default_type', label: 'النوع الافتراضي', type: 'select', options: [['app','تطبيق'],['game','لعبة']] },
      { key: 'default_category', label: 'الفئة الافتراضية', type: 'text' },
      { key: 'max_upload_mb', label: 'أقصى حجم رفع (م.ب)', type: 'number' },
      { key: 'allow_reviews', label: 'السماح بالتقييمات', type: 'toggle' },
      { key: 'show_download_counter', label: 'إظهار عدّاد التنزيلات', type: 'toggle' },
      { key: 'require_login', label: 'طلب تسجيل الدخول', type: 'toggle' },
      { key: 'notify_new_publications', label: 'إشعار عند نشر عنصر جديد', type: 'toggle' },
    ] },
    { id: 'notifications', label: 'الإشعارات', icon: 'bell', fields: [
      { key: 'push_enabled', label: 'تفعيل الإشعارات الفورية', type: 'toggle' },
      { key: 'auto_notify_update', label: 'إشعار تلقائي عند تحديث المتجر', type: 'toggle' },
      { key: 'quiet_start', label: 'بدء ساعات الهدوء (24h)', type: 'number' },
      { key: 'quiet_end', label: 'نهاية ساعات الهدوء (24h)', type: 'number' },
      { key: 'update_later_minutes', label: 'مهلة «تحديث لاحقاً» (بالدقائق)', type: 'number' },
    ] },
    { id: 'privacy', label: 'الخصوصية والبيانات', icon: 'shield', fields: [
      { key: 'collect_demographics', label: 'جمع بيانات ديموغرافية اختيارية', type: 'toggle' },
      { key: 'session_days', label: 'مدة الجلسة (أيام)', type: 'number' },
    ] },
    { id: 'system', label: 'النظام والصيانة', icon: 'settings', fields: [
      { key: 'maintenance_mode', label: 'وضع الصيانة', type: 'toggle' },
      { key: 'maintenance_message', label: 'رسالة الصيانة', type: 'textarea' },
      { key: 'maintenance_duration_minutes', label: 'مدة الصيانة (بالدقائق)', type: 'number' },
      { key: 'maintenance_end_at', label: 'وقت انتهاء الصيانة', type: 'readonly' },
    ] },
  ];
  const ACCENTS = { gold: '#f4c01f', blue: '#4c9ffe', green: '#4caf50', purple: '#a78bfa' };

  async function renderStoreSettings(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    let res = { settings: {}, defaults: {}, keys: [] };
    try { res = await api('/api/admin/settings'); } catch (e) {}
    const values = { ...(res.defaults || {}), ...(res.settings || {}) };
    let apps = [];
    try { apps = (await api('/api/admin/apps')).apps || []; } catch (e) {}
    body.innerHTML = '';
    const dirty = new Set();
    const dirtyBadge = el('span', { class: 'admin-settings-dirty' }, t('لا توجد تغييرات'));
    const controls = Object.create(null);
    const groupsEl = el('div', { class: 'admin-settings-groups' });
    const search = el('input', { class: 'input admin-settings-search', type: 'search',
      placeholder: t('ابحث في الإعدادات'), 'aria-label': t('ابحث في الإعدادات') });
    const preview = el('div', { class: 'admin-settings-preview' },
      el('div', { class: 'admin-settings-preview-card' },
        el('div', { class: 'admin-settings-preview-logo' }, 'G'),
        el('strong', null, values.store_name || 'Golden Store'),
        el('span', null, values.tagline || ''),
        el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, t('معاينة'))));

    function markDirty(key, value) {
      values[key] = value; dirty.add(key);
      dirtyBadge.textContent = `${dirty.size} ${t('تغييرات غير محفوظة')}`;
      dirtyBadge.classList.add('is-dirty');
      updatePreview();
    }
    function updatePreview() {
      preview.style.setProperty('--accent-preview', ACCENTS[values.accent] || ACCENTS.gold);
      preview.classList.toggle('is-light', values.theme_default === 'light');
      preview.classList.toggle('is-compact', values.density === 'compact');
      const n = preview.querySelector('.admin-settings-preview-card strong');
      if (n) n.textContent = values.store_name || 'Golden Store';
      const s = preview.querySelector('.admin-settings-preview-card span');
      if (s) s.textContent = values.tagline || '';
    }
    function control(f) {
      const v = String(values[f.key] ?? '');
      let inp;
      if (f.type === 'readonly') {
        const epoch = Number(v || 0);
        let label = '—';
        if (epoch > 0) {
          try { label = new Date(epoch * 1000).toLocaleString(document.documentElement.lang || 'ar', { dateStyle: 'medium', timeStyle: 'short' }); }
          catch (e) { label = String(epoch); }
        }
        // Not registered in `controls`: derived values must never be imported/overwritten.
        return el('div', { class: 'admin-settings-field', 'data-key': f.key },
          el('div', { class: 'admin-settings-field-copy' }, el('strong', null, f.label), el('code', null, f.key)),
          el('div', { class: 'input admin-settings-readonly', 'aria-label': f.label }, label));
      }
      if (f.type === 'toggle') {
        inp = el('input', { type: 'checkbox', class: 'admin-switch-input', 'aria-label': f.label });
        inp.checked = v === '1';
        inp.addEventListener('change', () => markDirty(f.key, inp.checked ? '1' : '0'));
      } else if (f.type === 'select') {
        inp = el('select', { class: 'input', 'aria-label': f.label },
          ...f.options.map(([val, lbl]) => el('option', { value: val }, lbl)));
        inp.value = v;
        inp.addEventListener('change', () => markDirty(f.key, inp.value));
      } else if (f.type === 'textarea') {
        inp = el('textarea', { class: 'input', rows: 2, 'aria-label': f.label }, v);
        inp.addEventListener('input', () => markDirty(f.key, inp.value));
      } else {
        inp = el('input', { class: 'input', type: f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text',
          value: v, 'aria-label': f.label });
        if (f.type === 'number') inp.min = '0';
        inp.addEventListener('input', () => markDirty(f.key, inp.value));
      }
      controls[f.key] = inp;
      return el('div', { class: 'admin-settings-field', 'data-key': f.key },
        el('div', { class: 'admin-settings-field-copy' },
          el('strong', null, f.label), el('code', null, f.key)),
        f.type === 'toggle'
          ? el('label', { class: 'admin-switch' }, inp,
              el('span', { class: 'admin-switch-track', 'aria-hidden': 'true' }, el('span', { class: 'admin-switch-thumb' })))
          : inp);
    }
    SETTINGS_SCHEMA.forEach((g) => {
      const fields = el('div', { class: 'admin-settings-fields' }, ...g.fields.map(control));
      groupsEl.append(el('section', { class: 'admin-settings-group', 'data-group': g.id },
        el('div', { class: 'admin-settings-group-head' }, ico(g.icon, 'icon'), el('h2', null, g.label)),
        fields));
    });
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      [...groupsEl.querySelectorAll('.admin-settings-field')].forEach((n) => {
        n.style.display = !q || n.textContent.toLowerCase().includes(q) || String(n.dataset.key).includes(q) ? '' : 'none';
      });
      [...groupsEl.querySelectorAll('.admin-settings-group')].forEach((g) => {
        g.style.display = [...g.querySelectorAll('.admin-settings-field')].some((n) => n.style.display !== 'none') ? '' : 'none';
      });
    });
    async function save() {
      if (!dirty.size) { toast(t('لا توجد تغييرات'), 'info'); return; }
      const payload = {};
      dirty.forEach((k) => { payload[k] = values[k]; });
      try {
        const r = await api('/api/admin/settings', { method: 'PATCH', body: { values: payload } });
        Object.assign(values, r.settings || {});
        // Apply immediately to this console and to every storefront page.
        try { if (window.GSSettings && window.GSSettings.refresh) window.GSSettings.refresh(); } catch (e) {}
        logAdminAction(`حفظ ${dirty.size} إعداداً`);
        dirty.clear();
        dirtyBadge.textContent = t('تم الحفظ');
        dirtyBadge.classList.remove('is-dirty');
        toast(t('تم حفظ الإعدادات'), 'success');
      } catch (e) { toast('فشل الحفظ', 'error'); }
    }
    saveSettingsFn = save;
    const saveBtn = el('button', { class: 'btn btn-primary', type: 'button', onclick: save },
      ico('check'), t('حفظ الإعدادات'));
    const exportBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => {
      const blob = new Blob([JSON.stringify(values, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: 'goldenstore-settings.json' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      logAdminAction(t('تصدير الإعدادات'));
    } }, t('تصدير الإعدادات'));
    const importFile = el('input', { type: 'file', accept: 'application/json,.json', class: 'input',
      'aria-label': t('استيراد الإعدادات') });
    const importBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: async () => {
      const f = importFile.files && importFile.files[0];
      if (!f) { toast(t('اختر ملف JSON'), 'error'); return; }
      try {
        const data = JSON.parse(await f.text());
        Object.keys(data).filter((k) => controls[k]).forEach((k) => {
          values[k] = String(data[k]); dirty.add(k);
          const c = controls[k];
          if (c.type === 'checkbox') c.checked = values[k] === '1';
          else c.value = values[k];
        });
        dirtyBadge.textContent = `${dirty.size} ${t('تغييرات غير محفوظة')}`;
        dirtyBadge.classList.add('is-dirty');
        updatePreview();
        toast(t('استيراد الإعدادات'), 'success');
      } catch (e) { toast('فشل الاستيراد', 'error'); }
    } }, t('استيراد الإعدادات'));
    const resetBtn = el('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: async () => {
      if (!confirm(t('إعادة ضبط الإعدادات') + '؟')) return;
      try {
        const r = await api('/api/admin/settings/reset', { method: 'POST' });
        Object.assign(values, r.settings || {});
        try { if (window.GSSettings && window.GSSettings.refresh) window.GSSettings.refresh(); } catch (e) {}
        dirty.clear(); updatePreview(); renderStoreSettings(body);
        toast(t('تم الحفظ'), 'success');
      } catch (e) { toast('فشل الإعادة', 'error'); }
    } }, t('إعادة ضبط الإعدادات'));

    const withIssues = apps.filter((a) => qaIssues(a).length).length;
    const recs = [
      withIssues ? `${withIssues} ${t('عناصر تحتاج انتباهاً')} — ${t('فحص الجودة')}` : null,
      values.collect_demographics !== '1' ? t('فعّل جمع البيانات الديموغرافية الاختياري لرؤية السن والجنس') : null,
      values.maintenance_mode === '1'
        ? t('وضع الصيانة مفعّل حالياً') + (Number(values.maintenance_end_at) > 0
            ? ' — ' + t('ينتهي في') + ' ' + new Date(Number(values.maintenance_end_at) * 1000).toLocaleString(document.documentElement.lang || 'ar', { dateStyle: 'medium', timeStyle: 'short' })
            : '')
        : null,
      values.notify_new_publications !== '1' ? t('إشعار عند نشر عنصر جديد') + ' — ' + t('مفعّلة') : null,
    ].filter(Boolean);
    const recPanel = el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, ico('spark', 'icon'), t('توصيات ذكية')),
      recs.length ? el('ul', { class: 'admin-recs' }, ...recs.map((r) => el('li', null, ico('check', 'icon'), r)))
        : el('div', { class: 'hint' }, t('لا توجد مشاكل')));

    const previewBtn = el('button', {
      class: 'btn btn-secondary btn-sm admin-preview-site', type: 'button',
      onclick: () => openStorePreview(),
    }, ico('external', 'icon'), t('دخول المتجر أثناء الصيانة'));
    const endPreviewBtn = el('button', {
      class: 'btn btn-secondary btn-sm admin-preview-end', type: 'button',
      onclick: () => endStorePreview(),
    }, ico('close', 'icon'), t('إنهاء معاينة المدير'));
    const toolbar = el('div', { class: 'admin-settings-toolbar' },
      search, dirtyBadge, previewBtn, endPreviewBtn, exportBtn, importBtn, importFile, resetBtn,
      el('kbd', { class: 'admin-kbd' }, 'Ctrl S'));
    const previewPanel = el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, ico('eye', 'icon'), t('معاينة مباشرة')), preview);
    const healthPanel = el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, ico('shield', 'icon'), t('صحة الخدمات')),
      el('div', { class: 'admin-phase2-pad' },
        el('div', { class: 'hint' }, t('الخدمات تعمل بشكل طبيعي')),
        el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => goTab('insights') },
          ico('trending', 'icon'), t('إحصائيات متقدمة'))));
    const side = el('div', { class: 'admin-dash-side' }, previewPanel, recPanel, healthPanel);
    const layout = el('div', { class: 'admin-settings-layout' }, groupsEl, side);
    body.append(
      phaseHead(t('إعدادات المتجر'),
        'كل إعدادات المتجر في مكان واحد: الهوية، المظهر، المحتوى، الإشعارات، الخصوصية، والصيانة.', saveBtn),
      toolbar, layout);
    updatePreview();
  }

  // -------- support chat: one conversation, chat-style bubbles --------
  let supportAdminTimer = null;
  let supportSelectedId = null;
  let supportMobileChat = false;
  const supportAdminDrafts = Object.create(null);

  function waLang() { return (window.GSI18N && window.GSI18N.lang) || 'ar'; }
  function waTime(ts) {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleTimeString(waLang(), {
      hour: '2-digit', minute: '2-digit', numberingSystem: 'latn',
    });
  }
  function waDay(ts) { return ts ? new Date(ts * 1000).toDateString() : ''; }
  function waIsMobile() {
    try { return !!(window.matchMedia && window.matchMedia('(max-width: 860px)').matches); }
    catch (e) { return false; }
  }
  function waScrollBottom(node) {
    const go = () => { try { node.scrollTop = node.scrollHeight; } catch (e) {} };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(go);
    else go();
  }
  function waAutoGrow(node) {
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = Math.min(node.scrollHeight || 44, 120) + 'px';
  }
  function waBubble(m, out) {
    const kids = [];
    if (m.body) {
      const textEl = el('div', { class: 'wa-bubble-text', 'data-noi18n': '' });
      C.linkifyInto(textEl, m.body, { title: t('فتح الرابط') });
      kids.push(textEl);
    }
    kids.push(el('div', { class: 'wa-meta' },
      el('span', { class: 'wa-time' }, waTime(m.created_at)),
      out ? el('span', { class: 'wa-ticks', 'aria-hidden': 'true' }, '✓✓') : null));
    return el('div', { class: 'wa-row ' + (out ? 'out' : 'in') },
      el('div', { class: 'wa-bubble ' + (out ? 'out' : 'in') }, kids));
  }

  // The conversation header shows the store logo; list rows keep the user icon.
  function brandAvatar() {
    const box = el('span', { class: 'wa-admin-avatar has-logo', 'aria-hidden': 'true' });
    const img = el('img', {
      src: '/images/logo.png', alt: '', class: 'wa-brand-logo',
      draggable: 'false', decoding: 'async',
    });
    img.addEventListener('error', () => {
      img.remove();
      box.append(ico('user', 'icon'));
    });
    box.append(img);
    return box;
  }

  async function renderSupport(body) {
    body.innerHTML = '';
    if (supportAdminTimer) { clearInterval(supportAdminTimer); supportAdminTimer = null; }

    const countEl = el('div', { class: 'wa-admin-count' }, t('جارٍ تحميل رسائل الدعم…'));
    const refreshBtn = el('button', {
      class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => load(false, true),
    }, ico('refresh', 'icon icon-sm'), t('تحديث القائمة'));
    const itemsEl = el('div', { class: 'wa-admin-items' });
    const chatPanel = el('section', { class: 'wa-admin-chat-panel' });
    const layout = el('div', { class: 'wa-admin' },
      el('aside', { class: 'wa-admin-list' },
        el('div', { class: 'wa-admin-list-head' }, t('المحادثات')), itemsEl),
      chatPanel);
    body.append(
      el('div', { class: 'wa-admin-toolbar' },
        el('div', null, el('div', { class: 'wa-admin-title' }, t('رسائل الدعم')), countEl),
        refreshBtn),
      layout,
    );

    function captureDrafts() {
      chatPanel.querySelectorAll('[data-draft]').forEach((n) => {
        supportAdminDrafts[n.getAttribute('data-draft')] = n.value;
      });
    }
    function restoreDrafts() {
      chatPanel.querySelectorAll('[data-draft]').forEach((n) => {
        const v = supportAdminDrafts[n.getAttribute('data-draft')];
        if (typeof v === 'string') n.value = v;
      });
    }

    function threadItem(th) {
      const unread = Number(th.unread_admin) || 0;
      const previewText = th.last_message || '—';
      const previewEl = el('span', { class: 'wa-admin-item-preview', 'data-noi18n': '' });
      C.linkifyInto(previewEl, previewText, { title: t('فتح الرابط') });
      return el('button', {
        type: 'button',
        class: 'wa-admin-item' + (th.id === supportSelectedId ? ' active' : '') + (unread ? ' unread' : ''),
        onclick: () => { supportSelectedId = th.id; supportMobileChat = true; load(false, true); },
      },
        el('span', { class: 'wa-admin-avatar', 'aria-hidden': 'true' }, ico('user', 'icon')),
        el('span', { class: 'wa-admin-item-main' },
          el('span', { class: 'wa-admin-item-top' },
            el('span', { class: 'wa-admin-item-name', 'data-noi18n': '' },
              th.user_name || th.user_email || th.uid || t('مستخدم')),
            el('span', { class: 'wa-admin-item-time' }, waTime(th.last_message_at))),
          el('span', { class: 'wa-admin-item-bottom' },
            previewEl,
            unread ? el('span', { class: 'wa-admin-unread' }, formatNum(unread)) : null)),
        el('span', {
          class: 'wa-admin-status-dot ' + (th.status === 'open' ? 'is-open' : 'is-closed'),
          'aria-label': t(th.status === 'open' ? 'مفتوحة' : 'مغلقة'),
          title: t(th.status === 'open' ? 'مفتوحة' : 'مغلقة'),
        }),
      );
    }

    async function openThread(id) {
      let res;
      try { res = await api('/api/admin/support/threads/' + encodeURIComponent(id)); }
      catch (e) {
        chatPanel.innerHTML = '';
        chatPanel.append(emptyMsg(t('تعذّر تحميل رسائل الدعم'), e.message || t('حاول مجدداً')));
        return;
      }
      captureDrafts();
      const thread = res.thread || {};
      const msgs = Array.isArray(res.messages) ? res.messages : [];
      chatPanel.innerHTML = '';

      const backBtn = el('button', {
        class: 'wa-admin-back', type: 'button',
        'aria-label': t('عرض المحادثات'), title: t('عرض المحادثات'),
        onclick: () => { supportMobileChat = false; load(false, true); },
      }, ico('chevronEnd', 'icon'));
      const toggleBtn = el('button', {
        class: 'btn btn-secondary btn-sm', type: 'button', onclick: async () => {
          const next = thread.status === 'open' ? 'closed' : 'open';
          try {
            await api('/api/admin/support/threads/' + encodeURIComponent(id), {
              method: 'PATCH', body: { status: next },
            });
            await load(false, true);
          } catch (e) { toast(t('تعذّر تحديث المحادثة'), 'error'); }
        },
      }, ico('refresh', 'icon icon-sm'),
        t(thread.status === 'open' ? 'إغلاق المحادثة' : 'إعادة فتح المحادثة'));
      const deleteBtn = el('button', {
        class: 'btn btn-danger btn-sm', type: 'button', onclick: async () => {
          if (typeof window.confirm === 'function' && !window.confirm(t('تأكيد حذف المحادثة'))) return;
          try {
            const out = await api('/api/admin/support/threads/' + encodeURIComponent(id), { method: 'DELETE' });
            supportSelectedId = null;
            supportMobileChat = false;
            delete supportAdminDrafts['admin:' + id];
            const total = out && out.deleted ? Number(out.deleted.messages || 0) : 0;
            toast(total ? `${t('تم حذف المحادثة وكل محتواها')} · ${formatNum(total)}`
              : t('تم حذف المحادثة وكل محتواها'), 'success');
            await load(false, true);
          } catch (e) { toast(t('تعذّر حذف المحادثة'), 'error'); }
        },
      }, ico('trash', 'icon icon-sm'), t('حذف المحادثة'));

      const head = el('header', { class: 'wa-admin-head' },
        backBtn,
        brandAvatar(),
        el('div', { class: 'wa-admin-head-info' },
          el('div', { class: 'wa-admin-head-name', 'data-noi18n': '' },
            thread.user_name || thread.user_email || thread.uid || t('مستخدم')),
          el('div', { class: 'wa-admin-head-sub', 'data-noi18n': '' },
            [thread.user_name, thread.user_email].filter(Boolean).join(' · ') || thread.uid || '')),
        el('span', { class: 'wa-admin-status' }, t(thread.status === 'open' ? 'مفتوحة' : 'مغلقة')),
        el('div', { class: 'wa-admin-actions' }, toggleBtn, deleteBtn));

      const msgsEl = el('div', { class: 'wa-admin-msgs', 'aria-live': 'polite' });
      let lastDay = '';
      msgs.forEach((m) => {
        const dk = waDay(m.created_at);
        if (dk && dk !== lastDay) {
          msgsEl.append(el('div', { class: 'wa-day' }, formatDate(m.created_at)));
          lastDay = dk;
        }
        msgsEl.append(waBubble(m, m.sender === 'admin'));
      });
      chatPanel.append(head, msgsEl);

      if (thread.status === 'open') {
        const replyInput = el('textarea', {
          class: 'wa-input', rows: '1', maxlength: '2000',
          placeholder: t('اكتب الرد هنا…'), 'aria-label': t('الرد على المستخدم'),
          'data-draft': 'admin:' + id,
        });
        const replyBtn = el('button', {
          class: 'wa-send', type: 'submit',
          'aria-label': t('إرسال الرد'), title: t('إرسال الرد'),
        }, ico('send', 'icon fill'));
        let sendingReply = false;
        const doReply = async () => {
          if (sendingReply) return;
          const message = replyInput.value.trim();
          if (message.length < 2) { replyInput.focus(); return; }
          sendingReply = true;
          replyBtn.disabled = true;
          try {
            await api('/api/admin/support/threads/' + encodeURIComponent(id) + '/messages', {
              method: 'POST', body: { message },
            });
            replyInput.value = '';
            supportAdminDrafts['admin:' + id] = '';
            toast(t('تم إرسال الرد'), 'success');
            await load(false, true);
          } catch (err) { toast(t('تعذّر إرسال الرد'), 'error'); }
          finally {
            sendingReply = false;
            replyBtn.disabled = false;
          }
        };
        const replyForm = el('form', {
          class: 'wa-admin-compose', onsubmit: (e) => { e.preventDefault(); doReply(); },
        },
          el('div', { class: 'wa-compose-main' },
            el('div', { class: 'wa-input-row' },
              el('div', { class: 'wa-input-wrap' }, replyInput),
              replyBtn)));
        replyInput.addEventListener('input', () => waAutoGrow(replyInput));
        replyInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doReply(); }
        });
        replyBtn.disabled = sendingReply;
        chatPanel.append(replyForm);
        waAutoGrow(replyInput);
      } else {
        chatPanel.append(el('div', { class: 'wa-admin-closed' }, t('المحادثة مغلقة')));
      }
      restoreDrafts();
      waScrollBottom(msgsEl);
    }

    let loading = false;
    async function load(silent, force) {
      if (!document.body.contains(body)) {
        if (supportAdminTimer) { clearInterval(supportAdminTimer); supportAdminTimer = null; }
        return;
      }
      if (loading && !force) return;
      loading = true;
      refreshBtn.disabled = true;
      try {
        const res = await api('/api/admin/support/threads');
        const threads = Array.isArray(res.threads) ? res.threads : [];
        const unread = threads.reduce((n, x) => n + (Number(x.unread_admin) || 0), 0);
        countEl.textContent = `${formatNum(threads.length)} ${t('محادثة')}`
          + (unread ? ` · ${formatNum(unread)} ${t('جديد')}` : '');
        layout.classList.toggle('chat-open', waIsMobile() && supportMobileChat);
        itemsEl.innerHTML = '';
        if (!threads.length) {
          itemsEl.append(emptyMsg(t('لا توجد رسائل دعم'),
            t('تظهر هنا رسائل المستخدمين ويمكنك الرد عليها مباشرة.')));
          supportSelectedId = null;
          supportMobileChat = false;
          chatPanel.innerHTML = '';
          chatPanel.append(el('div', { class: 'wa-admin-placeholder' },
            t('اختر محادثة لعرض الرسائل')));
        } else {
          if (!threads.some((x) => x.id === supportSelectedId)) supportSelectedId = threads[0].id;
          threads.forEach((th) => itemsEl.append(threadItem(th)));
          if (waIsMobile() && !supportMobileChat) {
            chatPanel.innerHTML = '';
            chatPanel.append(el('div', { class: 'wa-admin-placeholder' },
              t('اختر محادثة لعرض الرسائل')));
          } else {
            await openThread(supportSelectedId);
          }
        }
      } catch (e) {
        if (!silent) {
          itemsEl.innerHTML = '';
          itemsEl.append(emptyMsg(t('تعذّر تحميل رسائل الدعم'), e.message || t('حاول مجدداً')));
        }
      } finally { loading = false; refreshBtn.disabled = false; }
    }

    await load(false);
    supportAdminTimer = setInterval(() => { if (!document.hidden) load(true); }, 20000);
  }

  // -------- review reports (review_reports) --------
  async function renderReports(body) {
    body.innerHTML = '';
    const countEl = el('div', { class: 'reports-count' }, t('جارٍ تحميل البلاغات…'));
    const listWrap = el('div', { class: 'reports-list' });
    const refreshBtn = el('button', {
      class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => load(),
    }, ico('refresh', 'icon icon-sm'), t('تحديث القائمة'));
    body.append(
      el('div', { class: 'reports-toolbar' },
        el('div', null,
          el('div', { class: 'reports-title' }, t('بلاغات المراجعات')),
          countEl,
        ),
        refreshBtn,
      ),
      listWrap,
    );

    async function load() {
      listWrap.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
      refreshBtn.disabled = true;
      try {
        const res = await api('/api/admin/reports');
        const reports = Array.isArray(res.reports) ? res.reports : [];
        countEl.textContent = `${formatNum(reports.length)} ${t('بلاغ')}`;
        listWrap.innerHTML = '';
        if (!reports.length) {
          listWrap.append(emptyMsg(
            t('لا توجد بلاغات على المراجعات'),
            t('تظهر هنا البلاغات التي يرسلها المستخدمون على التعليقات.'),
          ));
          return;
        }
        const tbody = el('tbody');
        reports.forEach((r) => tbody.append(reportRow(r, load)));
        const table = el('table', { class: 'table reports-table' },
          el('thead', null,
            el('tr', null,
              el('th', { scope: 'col' }, t('اسم التطبيق')),
              el('th', { scope: 'col' }, t('نص المراجعة')),
              el('th', { scope: 'col' }, t('السبب')),
              el('th', { scope: 'col' }, t('التاريخ')),
              el('th', { scope: 'col' }, t('إجراء')),
            ),
          ),
          tbody,
        );
        listWrap.append(el('div', { class: 'table-wrap' }, table));
      } catch (e) {
        listWrap.innerHTML = '';
        listWrap.append(emptyMsg(t('تعذّر تحميل البلاغات'), e.message || t('حاول مجدداً')));
      } finally {
        refreshBtn.disabled = false;
      }
    }

    await load();
  }

  function reportRow(r, refresh) {
    const row = el('tr');
    const appName = r.app_name || r.app_slug || '—';
    const reviewText = String(r.review_text || '');

    const appCell = el('td', null,
      el('div', { class: 'report-app' },
        r.app_slug
          ? el('a', {
            href: `/app?slug=${encodeURIComponent(r.app_slug)}`,
            target: '_blank', rel: 'noopener noreferrer',
            title: t('فتح صفحة التطبيق'),
          }, appName)
          : el('strong', null, appName),
        r.app_slug ? el('small', null, r.app_slug) : null,
      ),
    );

    const reviewCell = el('td', null,
      el('div', { class: 'report-review', title: reviewText },
        reviewText || t('نص المراجعة غير متوفر'),
        r.review_author ? el('small', null, `${t('بواسطة')}: ${r.review_author}`) : null,
      ),
    );
    const reasonCell = el('td', null,
      el('span', { class: 'report-reason-badge' }, r.reason || t('بدون سبب')),
    );
    const dateCell = el('td', { class: 'report-date' }, r.created_at ? formatDate(r.created_at) : '—');

    const actionsCell = el('td', { class: 'report-actions' });
    const reviewId = r.review_id ? String(r.review_id) : '';

    const deleteReportBtn = el('button', {
      class: 'btn btn-danger btn-sm btn-delete-report', type: 'button',
      'aria-label': t('حذف البلاغ'),
      title: t('حذف هذا البلاغ فقط'),
    }, ico('trash', 'icon icon-sm'), t('حذف البلاغ'));

    const deleteReviewBtn = el('button', {
      class: 'btn btn-secondary btn-sm btn-delete-review', type: 'button',
      'aria-label': t('حذف التعليق'),
      title: t('حذف التعليق نهائياً مع الإعجابات والبلاغات المرتبطة به'),
      disabled: reviewId ? null : 'disabled',
    }, ico('trash', 'icon icon-sm'), t('حذف التعليق'));

    function showDefault() {
      actionsCell.innerHTML = '';
      actionsCell.append(el('div', {
        class: 'report-actions-row',
        style: { display: 'inline-flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' },
      }, deleteReportBtn, deleteReviewBtn));
    }

    function showConfirm(action) {
      actionsCell.innerHTML = '';
      const isReview = action === 'review';
      actionsCell.append(
        el('div', { class: 'report-confirm' },
          el('span', { class: 'report-confirm-text' },
            isReview
              ? t('هل أنت متأكد من حذف هذا التعليق نهائياً؟')
              : t('هل أنت متأكد من حذف هذا البلاغ؟')),
          isReview
            ? el('span', { class: 'report-confirm-text' }, t('سيُحذف التعليق مع الإعجابات وجميع البلاغات المرتبطة به.'))
            : null,
          el('button', {
            class: 'btn btn-danger btn-sm', type: 'button',
            onclick: () => (isReview ? removeReview() : removeReport()),
          }, t('نعم، احذف')),
          el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: showDefault }, t('إلغاء')),
        ),
      );
    }

    async function runDelete(path, successMsg, errorMsg, onSuccess) {
      const confirmBtn = actionsCell.querySelector('.btn-danger');
      if (confirmBtn) confirmBtn.disabled = true;
      try {
        const result = await api(path, { method: 'DELETE' });
        toast(successMsg, 'success');
        if (typeof onSuccess === 'function') onSuccess(result);
        await refresh();
      } catch (e) {
        showDefault();
        toast(e.message || errorMsg, 'error');
      }
    }
    function removeReport() {
      return runDelete(
        `/api/admin/reports/${encodeURIComponent(String(r.id))}`,
        t('تم حذف البلاغ'), t('تعذّر حذف البلاغ'),
      );
    }
    function removeReview() {
      if (!reviewId) return;
      return runDelete(
        `/api/admin/reviews/${encodeURIComponent(reviewId)}`,
        t('تم حذف التعليق'), t('تعذّر حذف التعليق'),
        (res) => {
          // The server returns the NEW authoritative average. Show it as a
          // second toast so the admin can see the recomputation happened.
          if (!res || typeof res.rating !== 'number') return;
          toast(Number(res.rating_count) > 0
            ? `${t('التقييم الآن')} ${Number(res.rating).toFixed(1)} / 5 (${formatNum(res.rating_count)} ${t('تقييم')})`
            : t('لا تقييمات متبقية'), 'info');
        },
      );
    }

    deleteReportBtn.addEventListener('click', () => showConfirm('report'));
    deleteReviewBtn.addEventListener('click', () => showConfirm('review'));
    showDefault();

    row.append(appCell, reviewCell, reasonCell, dateCell, actionsCell);
    return row;
  }

  // -------- requests & reports --------
  async function renderRequests(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    try {
      const { requests } = await api('/api/admin/requests');
      body.innerHTML = '';
      if (!requests.length) {
        body.append(emptyMsg('لا توجد طلبات أو بلاغات', 'ستظهر هنا طلبات التحديث والبلاغات الواردة من المستخدمين.'));
        return;
      }
      const list = el('div', { class: 'panel' });
      requests.forEach((r) => list.append(requestCard(r, body)));
      body.append(list);
    } catch (e) {
      body.innerHTML = '';
      body.append(emptyMsg('تعذر التحميل', e.message));
    }
  }

  async function renderNotifications(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    try {
      body.innerHTML = '';

      const titleInput = el('input', {
        class: 'input',
        type: 'text',
        placeholder: 'عنوان الإشعار',
        'aria-label': 'عنوان الإشعار',
      });
      const bodyInput = el('textarea', {
        class: 'input',
        rows: 4,
        placeholder: 'النص',
        'aria-label': 'النص',
      });
      const publishBtn = el('button', { class: 'btn btn-primary', type: 'button' }, ico('bell'), 'نشر إشعار');
      const testBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, ico('bell'), 'إشعار تجريبي');
      const syncBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, ico('refresh'), 'مزامنة الاشتراكات');
      const pushInfo = el('div', { class: 'push-info', style: { fontSize: '13px', marginTop: '8px', lineHeight: '1.6' } });
      // ONE screen for the whole unified system: normal + advanced features.
      const segmentSelect = el('select', { class: 'input', 'aria-label': 'الجمهور المستهدف' },
        el('option', { value: 'all' }, 'الجميع (متصفح + تطبيق)'),
        el('option', { value: 'platform:android' }, 'تطبيق أندرويد فقط'),
        el('option', { value: 'platform:web' }, 'المتصفح فقط'),
        el('option', { value: 'active' }, 'النشطون آخر 7 أيام'),
        el('option', { value: 'uid' }, 'مستخدم محدد (UID)'),
      );
      const segmentValue = el('input', { class: 'input', type: 'text', placeholder: 'UID (عند اختيار مستخدم محدد)', 'aria-label': 'UID' });
      const imageInput = el('input', { class: 'input', type: 'url', placeholder: 'رابط صورة (اختياري)', 'aria-label': 'رابط صورة' });
      const clickInput = el('input', { class: 'input', type: 'text', placeholder: 'رابط عند الضغط، مثلاً /app?slug=game', 'aria-label': 'رابط الضغط' });
      const scheduleInput = el('input', { class: 'input', type: 'datetime-local', 'aria-label': 'جدولة الإرسال' });
      const unifiedInfo = el('div', { class: 'push-info', style: { fontSize: '12px', marginTop: '6px', opacity: '.85', lineHeight: '1.7' } });
      const listWrap = el('div', { class: 'panel' });
      const list = el('div', { class: 'notif-list' });

      function renderPush(push, suffix) {
        const parts = [
          `الأجهزة المستهدفة: ${push.targeted || 0}`,
          `نجح: ${push.success || 0}`,
          `فشل: ${push.failure || 0}`,
        ];
        if (push.topic_targeted) parts.push(`عبر الموضوع: ${push.topic_targeted}`);
        if (push.direct_targeted) parts.push(`إرسال مباشر: ${push.direct_targeted}`);
        if (push.web_targeted) parts.push(`متصفح: ${push.web_targeted}`);
        if (push.invalid_removed) parts.push(`رموز ميتة محذوفة: ${push.invalid_removed}`);
        if (push.pending) parts.push(`قيد الانتظار: ${push.pending}`);
        if (push.errors && push.errors.length) parts.push(`أخطاء: ${push.errors.slice(0, 3).join(' | ')}`);
        pushInfo.textContent = parts.join(' • ') + (suffix || '');
        if ((push.targeted || 0) === 0) {
          pushInfo.textContent += ' — لا يوجد أي جهاز مؤهل. افتح التطبيق، اسمح بالإشعارات، وسجّل الدخول.';
        }
      }

      // A large audience is split across Worker invocations. Drain the queued
      // batches so EVERY eligible device receives the message before we stop.
      async function showPush(push) {
        if (!push) { pushInfo.textContent = ''; return; }
        renderPush(push);
        let rounds = 0;
        while (push.job_id && (push.pending || 0) > 0 && rounds < 20) {
          rounds++;
          try {
            const more = await api('/api/admin/push/flush', {
              method: 'POST', body: { job_id: push.job_id },
            });
            push.success = (push.success || 0) + (more.success || 0);
            push.failure = (push.failure || 0) + (more.failure || 0);
            push.invalid_removed = (push.invalid_removed || 0) + (more.invalid_removed || 0);
            push.direct_targeted = (push.direct_targeted || 0) + (more.processed || 0);
            push.pending = more.pending || 0;
            renderPush(push, ' — جارٍ استكمال الإرسال…');
            if (more.done) break;
          } catch (e) {
            renderPush(push, ' — تعذّر استكمال الإرسال: ' + (e.message || ''));
            break;
          }
        }
      }

      syncBtn.onclick = async () => {
        syncBtn.disabled = true;
        let fetched = 0, subscribed = 0, invalid = 0, remaining = 0, rounds = 0;
        try {
          // Keep calling until the WHOLE table is covered, not just one page.
          do {
            rounds++;
            const r = await api('/api/admin/push/sync-topics', {
              method: 'POST', body: { limit: 100, all: true },
            });
            fetched += r.fetched || 0;
            subscribed += r.subscribed || 0;
            invalid += r.invalid || 0;
            remaining = r.remaining || 0;
            if (r.done || (r.fetched || 0) === 0) break;
          } while (remaining > 0 && rounds < 30);
          toast(`جلب من D1: ${fetched} • اشترك في FCM: ${subscribed} • رموز ميتة: ${invalid} • متبقٍ: ${remaining}`, 'success');
          await refreshStatus();
        } catch (e) {
          toast(e.message || 'تعذّرت المزامنة', 'error');
        } finally {
          syncBtn.disabled = false;
        }
      };

      async function refreshStatus() {
        try {
          const s = await api('/api/admin/push/status');
          let txt = `الأجهزة المسجّلة حالياً: ${s.registered_tokens || 0}`;
          // Show the freshest registrations so the owner can verify a test
          // device actually registered (open app → allow notifications → sign in).
          const toks = s.tokens || [];
          if (toks.length) {
            const now = Math.floor(Date.now() / 1000);
            const rel = (ts) => {
              const m = Math.max(0, Math.round((now - ts) / 60));
              if (m < 1) return 'الآن';
              if (m < 60) return `قبل ${m} دقيقة`;
              const h = Math.round(m / 60);
              if (h < 24) return `قبل ${h} ساعة`;
              return `قبل ${Math.round(h / 24)} يوم`;
            };
            txt += ' — آخر تسجيل جهاز: ' + rel(toks[0].updated_at);
            if ((s.registered_tokens || 0) > 1) txt += ` (${toks.length} أجهزة)`;
          } else {
            txt += ' — لا يوجد أي جهاز مسجّل. افتح تطبيق الأندرويد، اسمح بالإشعارات، وسجّل الدخول.';
          }
          const d = s.diagnostics || {};
          if (d.total_tokens !== undefined) {
            txt += ` — المؤهّلون: ${d.total_eligible || 0}/${d.total_tokens || 0}`
              + ` • غير موافق: ${d.native_opted_out || 0}`
              + ` • مشتركون في الموضوع: ${d.native_subscribed || 0}`
              + ` • ويب: ${d.web_eligible || 0}`
              + ` • تسجيلات آخر 24 ساعة: ${d.registrations_24h || 0}`;
          }
          pushInfo.textContent = txt;
        } catch (e) {}
        try {
          const u = await api('/api/admin/push/unified-status');
          const d = (u && u.unified) || {};
          const ch = d.channels || {};
          unifiedInfo.textContent = 'النظام الموحّد ✓ • '
            + `أجهزة: ${d.devices_total || 0} (مؤهّلة ${d.devices_eligible || 0}) • `
            + `تطبيق: ${(ch.native && ch.native.eligible) || 0} • `
            + `متصفح: ${(ch.web && ch.web.eligible) || 0} • `
            + `تكرارات ممنوعة: ${d.installations_tracked || 0} تثبيت • `
            + `سجل التسليم: ${JSON.stringify(d.delivery || {})} • `
            + `وظائف قيد الانتظار: ${d.pending_jobs || 0}`
            + ' — كل إشعار يُرسل مرة واحدة لكل جهاز عبر محرك واحد.';
        } catch (e) {
          unifiedInfo.textContent = 'النظام الموحّد: يتعذر قراءة الحالة الآن.';
        }
      }

      testBtn.onclick = async () => {
        testBtn.disabled = true;
        try {
          const res = await api('/api/admin/push/test', { method: 'POST', body: {} });
          showPush(res.push);
          toast('تم إرسال إشعار تجريبي — لا يُحفظ في قائمة الإشعارات داخل التطبيق', 'success');
        } catch (e) {
          toast(e.message || 'تعذر الإرسال', 'error');
        } finally {
          testBtn.disabled = false;
        }
      };

      async function load() {
        list.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
        try {
          const res = await api('/api/admin/notifications');
          const notifications = res.notifications || [];
          list.innerHTML = '';
          if (!notifications.length) {
            list.append(emptyMsg('لا توجد إشعارات بعد', 'ستظهر هنا الإشعارات المنشورة والتنبيهات الآلية.'));
            return;
          }
          notifications.forEach((n) => list.append(notificationCard(n, load)));
        } catch (e) {
          list.innerHTML = '';
          list.append(emptyMsg('تعذر التحميل', e.message));
        }
      }

      publishBtn.onclick = async () => {
        const title = titleInput.value.trim();
        const bodyText = bodyInput.value.trim();
        if (!title) { toast('أدخل عنوان الإشعار', 'error'); return; }
        publishBtn.disabled = true;
        try {
          const raw = String(segmentSelect.value || 'all');
          const [mode, platform] = raw.split(':');
          const segment = { mode: mode === 'platform' ? 'platform' : mode };
          if (platform) segment.platform = platform;
          if (mode === 'uid') segment.uid = segmentValue.value.trim();
          const res = await api('/api/admin/notifications', {
            method: 'POST',
            body: {
              title, body: bodyText,
              segment,
              image_url: imageInput.value.trim(),
              click_url: clickInput.value.trim(),
              scheduled_at: scheduleInput.value || undefined,
            },
          });
          titleInput.value = '';
          bodyInput.value = '';
          showPush(res && res.push);
          toast(res.scheduled ? 'تمت جدولة الإشعار عبر النظام الموحّد' : 'تم نشر الإشعار عبر النظام الموحّد', 'success');
          await load();
        } catch (e) {
          toast(e.message || 'تعذر النشر', 'error');
        } finally {
          publishBtn.disabled = false;
        }
      };

      listWrap.append(
        el('div', { class: 'panel-head' }, ico('bell'), 'الإشعارات'),
        list,
      );
      body.append(
        el('div', { class: 'panel' },
          el('div', { class: 'panel-head' }, ico('bell'), 'مركز الإشعارات الموحّد'),
          el('div', { class: 'form' },
            el('div', { class: 'field' },
              el('label', null, 'عنوان الإشعار'),
              titleInput,
            ),
            el('div', { class: 'field' },
              el('label', null, 'النص'),
              bodyInput,
            ),
            el('div', { class: 'field' },
              el('label', null, 'الجمهور (النظام العادي + المتقدم في محرك واحد)'),
              segmentSelect,
            ),
            el('div', { class: 'field' },
              el('label', null, 'معرّف المستخدم (للاستهداف الفردي)'),
              segmentValue,
            ),
            el('div', { class: 'field' },
              el('label', null, 'صورة الإشعار (اختياري)'),
              imageInput,
            ),
            el('div', { class: 'field' },
              el('label', null, 'الرابط عند الضغط (اختياري)'),
              clickInput,
            ),
            el('div', { class: 'field' },
              el('label', null, 'جدولة الإرسال (اتركه فارغاً للإرسال الفوري)'),
              scheduleInput,
            ),
            el('div', { class: 'btn-row', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, publishBtn, testBtn, syncBtn),
            pushInfo,
            unifiedInfo,
          ),
        ),
        listWrap,
      );

      await refreshStatus();
      await load();
    } catch (e) {
      body.innerHTML = '';
      body.append(emptyMsg('تعذر التحميل', e.message));
    }
  }

  // -------- app download link (upload APK to R2, link appears on landing page) --------
  function showUpdatePreview(data) {
    const overlay = el('div', { class: 'admin-preview-overlay admin-update-preview-overlay', role: 'dialog', 'aria-modal': 'true' });
    const card = el('div', { class: 'gs-update-card gs-update-preview' },
      el('div', { class: 'gs-update-halo', 'aria-hidden': 'true' },
        el('span', { class: 'gs-update-orbit o1' }), el('span', { class: 'gs-update-orbit o2' })),
      el('div', { class: 'gs-update-hero' },
        el('div', { class: 'gs-update-logo' }, el('img', { src: '/images/logo.png', alt: 'Golden Store' })),
        el('div', { class: 'gs-update-head' },
          el('span', { class: 'gs-update-badge' }, data.force ? t('تحديث إلزامي') : t('تحديث جديد متاح')),
          el('span', { class: 'gs-update-version' }, t('الإصدار') + ' ' + (data.version_name || '—'))),
        el('h2', { class: 'gs-update-title' }, t('تحديث Golden Store')),
        el('p', { class: 'gs-update-lead' }, t('نسخة جديدة من Golden Store جاهزة للتثبيت.'))),
      el('div', { class: 'gs-update-body' },
        el('div', { class: 'gs-update-compare' },
          el('span', { class: 'gs-update-ver-chip' }, el('span', null, t('إصدارك الحالي')), el('strong', null, '1.0')),
          el('span', { class: 'gs-update-arrow' }, '←'),
          el('span', { class: 'gs-update-ver-chip is-new' }, el('span', null, t('الإصدار الجديد')), el('strong', null, data.version_name || '—'))),
        el('div', { class: 'gs-update-notes' },
          el('span', { class: 'gs-update-notes-label' }, t('ما الجديد')),
          el('p', null, data.notes || '—')),
        el('div', { class: 'gs-update-chips' },
          el('span', { class: 'gs-update-chip' }, ico('shield', 'icon'), t('تحميل آمن')),
          el('span', { class: 'gs-update-chip' }, ico('spark', 'icon'), t('ميزات جديدة')))),
      el('div', { class: 'gs-update-actions' },
        el('div', { class: 'btn btn-primary btn-lg gs-update-primary' }, ico('download'), t('تحميل الآن')),
        el('div', { class: 'btn btn-secondary gs-update-later' }, t('لاحقاً'))),
    );
    const closeBtn = el('button', { class: 'icon-btn admin-preview-close', type: 'button',
      'aria-label': t('إغلاق'), onclick: () => overlay.remove() }, ico('close'));
    overlay.append(closeBtn, card);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.append(overlay);
  }

  /* Round 40 — «مركز التحديث» now manages the DOWNLOAD page media exactly like
     an app: a real logo (the green mascot is gone), screenshots and YouTube
     videos/Shorts. Saved through /api/admin/app-update/media. */
  function updateMediaPanel() {
    let logoDz = null, ssDz = null;
    let shots = [];       // [{ key, url }]
    let videos = [];      // [{ video_id, kind, title }]
    let logoKey = null, logoUrl = null;

    const shotsStrip = el('div', { class: 'adm-media-grid' });
    const logoPreview = el('div', { class: 'adm-media-logo' }, el('div', { class: 'hint' }, t('لا شعار بعد')));
    const videoListEl = el('div', { class: 'gs-admin-video-list' });
    const saveBtn = el('button', { class: 'btn btn-primary', type: 'button' }, ico('check'), t('حفظ الشعار والصور'));

    const videoUrlInput = el('input', { class: 'input', type: 'url',
      placeholder: 'https://youtube.com/watch?v=…  ·  youtu.be/…  ·  /shorts/…',
      'aria-label': t('رابط فيديو يوتيوب') });
    const videoTitleInput = el('input', { class: 'input', type: 'text',
      placeholder: t('عنوان الفيديو (اختياري)'), 'aria-label': t('عنوان الفيديو (اختياري)') });
    const videoKind = el('select', { class: 'input', 'aria-label': t('نوع الفيديو') },
      el('option', { value: 'auto' }, t('اكتشاف تلقائي')),
      el('option', { value: 'video' }, t('فيديو عادي')),
      el('option', { value: 'short' }, t('شورت')));

    function parseVideo(raw) {
      const s2 = String(raw || '').trim();
      if (!s2) return null;
      const m = s2.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{6,20})/);
      const withCase = m || s2.match(/^([A-Za-z0-9_-]{6,20})$/);
      if (!withCase) return null;
      const id = withCase[1];
      const auto = /\/shorts\//.test(s2) ? 'short' : 'video';
      return { video_id: id, kind: videoKind.value === 'auto' ? auto : videoKind.value };
    }

    function renderShot() {
      logoPreview.innerHTML = '';
      if (logoUrl) {
        logoPreview.append(el('img', { src: logoUrl, alt: t('شعار التطبيق'), width: '88', height: '88' }));
        logoPreview.append(el('button', { class: 'btn btn-secondary btn-sm', type: 'button',
          onclick: () => { logoKey = null; logoUrl = null; renderShot(); } }, ico('trash'), t('إزالة')));
      } else {
        logoPreview.append(el('div', { class: 'hint' }, t('الشعار الافتراضي (قولدن ستور)')));
      }
      shotsStrip.innerHTML = '';
      if (!shots.length) shotsStrip.append(el('div', { class: 'hint' }, t('لا توجد صور بعد')));
      shots.forEach((s3, i) => {
        const card = el('div', { class: 'adm-media-shot' },
          el('img', { src: s3.url, alt: '', loading: 'lazy' }),
          el('div', { class: 'adm-media-shot-bar' },
            el('button', { class: 'btn btn-secondary btn-sm', type: 'button', title: t('نقل لليمين'),
              onclick: () => { if (i > 0) { const [x] = shots.splice(i, 1); shots.splice(i - 1, 0, x); renderShot(); } } },
              ico('chevronEnd')),
            el('button', { class: 'btn btn-secondary btn-sm', type: 'button', title: t('نقل لليسار'),
              onclick: () => { if (i < shots.length - 1) { const [x] = shots.splice(i, 1); shots.splice(i + 1, 0, x); renderShot(); } } },
              ico('chevronStart')),
            el('button', { class: 'btn btn-secondary btn-sm', type: 'button', title: t('حذف'),
              onclick: () => { shots.splice(i, 1); renderShot(); } }, ico('trash'))));
        shotsStrip.append(card);
      });
      videoListEl.innerHTML = '';
      if (!videos.length) videoListEl.append(el('div', { class: 'gs-admin-video-empty' }, t('لا توجد فيديوهات بعد')));
      videos.forEach((v, i) => {
        videoListEl.append(el('div', { class: 'gs-admin-video-row' },
          el('img', { class: 'gs-admin-video-thumb ' + (v.kind === 'short' ? 'is-short' : 'is-video'),
            src: `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`, alt: '', loading: 'lazy' }),
          el('div', { class: 'gs-admin-video-meta' },
            el('div', { class: 'gs-admin-video-badges' },
              el('span', { class: 'gs-admin-video-badge' + (v.kind === 'short' ? ' is-short' : '') },
                v.kind === 'short' ? t('شورت') : t('فيديو عادي'))),
            el('strong', null, v.title || v.video_id)),
          el('button', { class: 'btn btn-secondary btn-sm', type: 'button',
            onclick: () => { videos.splice(i, 1); renderShot(); } }, ico('trash'), t('حذف'))));
      });
    }

    logoDz = bindLogo();
    ssDz = bindShots();

    async function load() {
      try {
        const d = await api('/api/admin/app-update/media');
        logoKey = d.logo_key || null;
        logoUrl = d.logo_url || null;
        shots = Array.isArray(d.screenshots) ? d.screenshots.slice() : [];
        videos = Array.isArray(d.videos) ? d.videos.map((v) => ({ video_id: v.video_id, kind: v.kind, title: v.title || '' })) : [];
      } catch (e) {}
      renderShot();
    }

    // the dropzone hands the picked files to `onFiles`; re-create it with the
    // handler so uploads start immediately (round 40).
    function bindLogo() {
      const dz = dropzone({ accept: 'image/*', label: t('شعار التطبيق (PNG مربّع)'), onFiles: async (files) => {
        const f = files && files[0];
        if (!f) return;
        if (!/^image\//.test(f.type || '')) { toast(t('اختر صورة'), 'error'); return; }
        try {
          toast(t('جارٍ رفع الشعار…'));
          logoKey = await r2Upload(f, 'icon', 'goldenstore-app', () => {});
          logoUrl = URL.createObjectURL(f);
          renderShot();
        } catch (e) { toast(t('فشل رفع الشعار'), 'error'); }
      } });
      return dz;
    }
    function bindShots() {
      return dropzone({ accept: 'image/*', multiple: true, label: t('صور التطبيق (لقطات الشاشة)'),
        onFiles: async (files) => {
          const list2 = Array.from(files || []);
          for (let i = 0; i < list2.length; i++) {
            const f = list2[i];
            if (!/^image\//.test(f.type || '')) continue;
            try {
              toast(t('جارٍ رفع الصور…') + ` ${i + 1}/${list2.length}`);
              const key = await r2Upload(f, 'screenshot', 'goldenstore-app', () => {});
              shots.push({ key, url: URL.createObjectURL(f) });
              renderShot();
            } catch (e) { toast(t('فشل رفع الصور'), 'error'); }
          }
        } });
    }

    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        await api('/api/admin/app-update/media', { method: 'POST', body: {
          logo_key: logoKey, screenshots: shots.map((x) => x.key),
          videos: videos.map((v) => ({ video_id: v.video_id, kind: v.kind, title: v.title || '' })),
        } });
        logAdminAction('حفظ شعار وصور صفحة التحميل');
        toast(t('تم حفظ الشعار والصور'), 'success');
        await load();
      } catch (e) { toast(t('فشل الحفظ'), 'error'); }
      saveBtn.disabled = false;
    };

    const panel = el('div', { class: 'panel', id: 'adm-update-media' },
      el('div', { class: 'panel-head' }, ico('image', 'icon'), t('شعار وصور صفحة التحميل')),
      el('div', { class: 'adm-media-cols' },
        el('div', { class: 'form' },
          el('div', { class: 'field' }, el('label', null, t('شعار التطبيق')), logoDz,
            el('div', { class: 'hint' }, 'يظهر في صفحة التحميل وأعلى نافذة التحديث بدل الأيقونة القديمة.')),
          el('div', { class: 'field' }, el('label', null, t('صور التطبيق')), ssDz,
            el('div', { class: 'hint' }, 'تُعرض كلقطة شاشة قابلة للتمرير في صفحة التحميل وفي نافذة التحديث.')),
          el('div', { class: 'field' }, el('label', null, t('فيديو يوتيوب أو شورت')),
            videoUrlInput, videoTitleInput, videoKind,
            el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => {
              const v = parseVideo(videoUrlInput.value);
              if (!v) { toast(t('رابط يوتيوب غير صالح'), 'error'); return; }
              videos.push({ video_id: v.video_id, kind: v.kind, title: videoTitleInput.value.trim() });
              videoUrlInput.value = ''; videoTitleInput.value = ''; renderShot();
            } }, ico('plus'), t('إضافة فيديو')),
            el('div', { class: 'hint' }, 'يقبل watch?v= · youtu.be · /shorts/ — والشورت يُعرض عمودياً.')),
          saveBtn),
        el('div', { class: 'adm-media-preview' },
          el('div', { class: 'adm-media-preview-head' }, t('المعاينة')),
          logoPreview, shotsStrip, videoListEl)));
    load();
    return panel;
  }

  async function renderAppUpdate(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    try {
      let current = null, releases = [];
      try { current = await api('/api/app-update'); } catch (e) {}
      try { releases = (await api('/api/admin/app-update/releases')).releases || []; } catch (e) {}

      const apkDz = dropzone({ accept: '.apk', label: 'اسحب أو اختر ملف APK للتطبيق' });
      const versionInput = el('input', { class: 'input', type: 'text', placeholder: 'مثلاً: 1.2.0 (اختياري)', value: current && current.version_name || '', 'aria-label': t('إصدار التطبيق') });
      const notesInput = el('textarea', { class: 'input', rows: 4, placeholder: 'ملاحظات منسّقة تظهر في النافذة الأسطورية (اختياري)', 'aria-label': t('ملاحظات التحديث') }, current && current.notes || '');
      const downloadsInput = el('input', {
        class: 'input', type: 'number', min: '0', step: '1',
        placeholder: t('اتركه فارغاً للإبقاء على العدد الحالي'),
        'aria-label': t('العدد الحقيقي للتنزيلات'),
      });
      const notifyInput = el('input', { type: 'checkbox' });
      notifyInput.checked = true;
      // Setting "auto notify on store update" forces the checkbox ON.
      try {
        if (window.GSSettings && window.GSSettings.get('auto_notify_update', '0') === '1') {
          notifyInput.checked = true;
          notifyInput.disabled = true;
        }
      } catch (e) {}
      const forceInput = el('input', { type: 'checkbox' });
      forceInput.checked = !!(current && current.force);

      const saveBtn = el('button', { class: 'btn btn-primary', type: 'button' }, ico('download'), t('نشر التحديث'));
      const resultInfo = el('div', { class: 'push-info', style: { fontSize: '13px', marginTop: '8px', lineHeight: '1.6' } });

      saveBtn.onclick = async () => {
        const files = apkDz.getFiles();
        if (!files.length) { toast(t('اختر ملف APK أولاً'), 'error'); return; }
        const version_name = versionInput.value.trim() || undefined;
        const version_code = version_name ? Math.floor(Date.now() / 1000) : 0;
        const notes = notesInput.value.trim();
        const downloadsRaw = downloadsInput.value.trim();
        const downloads = downloadsRaw !== '' && Number.isFinite(Number(downloadsRaw)) && Number(downloadsRaw) >= 0
          ? Math.floor(Number(downloadsRaw)) : undefined;
        saveBtn.disabled = true;
        try {
          toast(t('جارٍ رفع APK…'));
          const apk_key = await r2Upload(files[0], 'apk', 'goldenstore-app', (r) => apkDz.setProgress(0, r));
          const res = await api('/api/admin/app-update', {
            method: 'POST',
            body: { version_name, version_code, apk_key, notes,
              force: forceInput.checked, send_notification: notifyInput.checked, downloads },
          });
          logAdminAction(`نشر التحديث ${version_name || '—'}${forceInput.checked ? ' (إلزامي)' : ''}`);
          resultInfo.textContent = t('تم حفظ الرابط') + (res && res.push ? ` — ${res.push.success || 0}/${res.push.targeted || 0} ` + t('إشعار') : '');
          toast(t('تم نشر التحديث'), 'success');
          renderApp();
        } catch (e) {
          toast(t('فشل نشر التحديث'), 'error');
        } finally {
          saveBtn.disabled = false;
        }
      };

      const fmtDate = (ts) => {
        const n = Number(ts || 0);
        if (!n) return '—';
        try { return new Date(n * 1000).toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' }); }
        catch (e) { return '—'; }
      };
      const metaRow = (label, value) => el('div', { class: 'admin-update-row' },
        el('span', null, label), el('strong', null, value));

      const historyPanel = el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('clock', 'icon'), t('سجل الإصدارات')),
        releases.length ? el('div', { class: 'table-wrap' },
          el('table', { class: 'table' },
            el('thead', null, el('tr', null,
              el('th', null, t('الإصدار')), el('th', null, t('تاريخ النشر')),
              el('th', null, t('حجم التحديث')), el('th', null, ''))),
            el('tbody', null, ...releases.map((r) => el('tr', null,
              el('td', null, r.version_name || '—'),
              el('td', null, fmtDate(r.created_at)),
              el('td', null, formatBytes(r.size_bytes || 0)),
              el('td', null, r.force ? el('span', { class: 'admin-update-force' }, t('تحديث إلزامي')) : ''),
            )))))
          : el('div', { class: 'hint' }, t('لا نشاطات بعد')),
      );

      body.innerHTML = '';
      body.append(
        el('div', { class: 'admin-page-head' },
          el('div', null,
            el('h1', { class: 'admin-page-title' }, t('مركز التحديث')),
            el('p', { class: 'admin-page-sub' }, 'انشر نسخة جديدة، اجعلها إلزامية، وراجع ما سيراه المستخدم قبل النشر.')),
          el('button', { class: 'btn btn-secondary btn-sm', type: 'button',
            onclick: () => showUpdatePreview({
              version_name: versionInput.value.trim() || (current && current.version_name),
              notes: notesInput.value.trim(), force: forceInput.checked,
            }) }, ico('eye', 'icon'), t('معاينة النافذة'))),
        el('div', { class: 'admin-dash-grid' },
          el('div', { class: 'panel' },
            el('div', { class: 'panel-head' }, ico('download'), t('رفع تحديث التطبيق')),
            el('div', { class: 'form' },
              el('div', { class: 'field' },
                el('label', null, t('ملف APK'), el('span', { class: 'req' }, ' *')), apkDz),
              el('div', { class: 'field' },
                el('label', null, t('إصدار التطبيق'), ' ', el('span', { class: 'admin-field-hint' }, '(يُظهر نافذة التحديث داخل التطبيق)')), versionInput),
              el('div', { class: 'field' },
                el('label', null, t('ملاحظات الإصدار')), notesInput,
                el('div', { class: 'hint' }, 'تظهر هذه الملاحظات في النافذة الأسطورية بكل اللغات.')),
              el('div', { class: 'field' },
                el('label', null, t('العدد الحقيقي للتنزيلات')), downloadsInput,
                el('div', { class: 'hint' },
                  t('العدد الحالي للتنزيلات') + ': ' +
                  (current && typeof current.downloads === 'number' ? current.downloads.toLocaleString('en-US') : '0') +
                  ' — ' + t('يمكن زيادة العدد لاستعادة الرقم الحقيقي ولا يمكن إنقاصه'))),
              el('div', { class: 'field' },
                el('label', { class: 'admin-check-row' }, notifyInput, t('إرسال إشعار عند النشر'))),
              el('div', { class: 'field' },
                el('label', { class: 'admin-check-row' }, forceInput, t('تحديث إلزامي')),
                el('div', { class: 'hint' }, 'يمنع إغلاق النافذة وتجاهل الإصدار، ويمنع إخفاء شريط الإعلان.')),
              saveBtn, resultInfo,
            )),
          el('div', { class: 'admin-dash-side' },
            el('div', { class: 'panel' },
              el('div', { class: 'panel-head' }, ico('shield', 'icon'), 'الإصدار المنشور حالياً'),
              metaRow(t('الإصدار'), (current && current.version_name) || '—'),
              metaRow(t('حجم التحديث'), formatBytes((current && current.size_bytes) || 0)),
              metaRow(t('تاريخ النشر'), fmtDate(current && current.created_at)),
              metaRow(t('التنزيلات'), formatNum((current && current.downloads) || 0)),
              current && current.force ? el('div', { class: 'admin-update-force' }, t('تحديث إلزامي')) : null),
            historyPanel)),
        updateMediaPanel(),
      );
    } catch (e) {
      body.innerHTML = '';
      body.append(emptyMsg('تعذر التحميل', e.message));
    }
  }

  // ---------- Phase 2: publishing / ordering / categories / roles / backup ----------
  async function consoleState() {
    try { return await api('/api/admin/console/state'); } catch (e) { return {}; }
  }
  function phaseHead(title, sub, action) {
    return el('div', { class: 'admin-page-head' },
      el('div', null, el('h1', { class: 'admin-page-title' }, title),
        el('p', { class: 'admin-page-sub' }, sub)),
      action ? el('div', { class: 'admin-head-actions' }, action) : null);
  }
  function saveBlob(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function renderPublishing(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    const [state, appRes] = await Promise.all([consoleState(), api('/api/admin/apps').catch(() => ({ apps: [] }))]);
    const apps = appRes.apps || [];
    const pub = Object.create(null);
    (state.publication || []).forEach((r) => { pub[r.slug] = r; });
    const order = (state.order || []).map((r) => r.slug);
    const ordered = order.length ? order.slice() : apps.map((a) => a.slug);
    const bySlug = Object.create(null);
    apps.forEach((a) => { bySlug[a.slug] = a; if (ordered.indexOf(a.slug) < 0) ordered.push(a.slug); });
    body.innerHTML = '';

    const rows = el('div', { class: 'admin-order-list' });
    function row(slug) {
      const a = bySlug[slug] || { name: slug, slug };
      const current = pub[slug] || { status: 'published', publish_at: 0 };
      const sel = el('select', { class: 'input admin-phase2-select', 'aria-label': t('النشر والترتيب') },
        el('option', { value: 'published' }, t('منشور')),
        el('option', { value: 'draft' }, t('مسودة')),
        el('option', { value: 'scheduled' }, t('مجدول')));
      sel.value = current.status || 'published';
      const when = el('input', { class: 'input admin-phase2-date', type: 'datetime-local',
        'aria-label': t('تاريخ النشر') });
      if (current.publish_at) {
        try { when.value = new Date(Number(current.publish_at) * 1000).toISOString().slice(0, 16); } catch (e) {}
      }
      const save = el('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: async () => {
        const publish_at = sel.value === 'scheduled' && when.value
          ? Math.floor(new Date(when.value).getTime() / 1000) : 0;
        if (sel.value === 'scheduled' && !publish_at) { toast('اختر تاريخ النشر', 'error'); return; }
        try {
          await api('/api/admin/publication', { method: 'POST',
            body: { slug, status: sel.value, publish_at } });
          logAdminAction(`حالة «${a.name}»: ${sel.value}`);
          toast('تم الحفظ', 'success');
        } catch (e) { toast('فشل الحفظ', 'error'); }
      } }, t('حفظ الحالة'));
      const node = el('div', {
        class: 'admin-order-row', draggable: 'true', 'data-slug': slug,
      },
        el('span', { class: 'admin-drag-handle', title: t('اسحب لإعادة الترتيب') }, ico('grid', 'icon')),
        a.icon_url ? el('img', { src: a.icon_url, class: 'ico-sm' }) : el('div', { class: 'ico-sm' }),
        el('strong', null, a.name || slug),
        el('span', { class: 'admin-order-meta' }, a.type === 'game' ? 'لعبة' : 'تطبيق'),
        sel, when, save);
      node.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', slug); node.classList.add('is-dragging'); });
      node.addEventListener('dragend', () => node.classList.remove('is-dragging'));
      return node;
    }
    ordered.forEach((slug) => rows.append(row(slug)));
    rows.addEventListener('dragover', (e) => { e.preventDefault(); });
    rows.addEventListener('drop', (e) => {
      e.preventDefault();
      const slug = e.dataTransfer.getData('text/plain');
      const dragged = rows.querySelector(`[data-slug="${slug}"]`);
      const target = e.target.closest && e.target.closest('.admin-order-row');
      if (!dragged || !target || dragged === target) return;
      const rect = target.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      rows.insertBefore(dragged, after ? target.nextSibling : target);
      rows.querySelectorAll('.admin-order-row').forEach((n) => n.classList.remove('is-dragging'));
    });
    const saveOrder = el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => {
      const slugs = [...rows.querySelectorAll('.admin-order-row')].map((n) => n.getAttribute('data-slug'));
      try {
        await api('/api/admin/order', { method: 'POST', body: { slugs } });
        logAdminAction('حفظ ترتيب الكتالوج');
        toast('تم حفظ الترتيب', 'success');
      } catch (e) { toast('فشل حفظ الترتيب', 'error'); }
    } }, ico('check'), t('حفظ الترتيب'));
    body.append(
      phaseHead(t('النشر والترتيب'), 'اجعل أي عنصر مسودة أو مجدولاً، ثم اسحب البطاقات للتحكم في ترتيب الظهور في المتجر.', saveOrder),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('clock', 'icon'), t('اسحب لإعادة الترتيب')),
        rows),
      el('div', { class: 'hint' }, 'المسودات والمجدول لا تظهر في /api/apps أو البحث أو صفحة التفاصيل حتى يحين موعدها (Cron كل 5 دقائق).'),
    );
  }

  async function renderCategories(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    const state = await consoleState();
    const custom = state.categories || [];
    body.innerHTML = '';
    const slugIn = el('input', { class: 'input', placeholder: 'مثلاً: productivity', 'aria-label': t('معرف الفئة') });
    const nameIn = el('input', { class: 'input', placeholder: 'اسم الفئة بالعربية', 'aria-label': t('اسم الفئة') });
    const typeIn = el('select', { class: 'input', 'aria-label': t('النوع') },
      el('option', { value: 'app' }, 'تطبيق'), el('option', { value: 'game' }, 'لعبة'));
    const posIn = el('input', { class: 'input', type: 'number', value: '99', min: '0', 'aria-label': t('فرز حسب') });
    const list = el('div', { class: 'admin-phase2-list' });
    function draw() {
      list.innerHTML = '';
      if (!custom.length) { list.append(el('div', { class: 'hint' }, t('لا توجد نتائج'))); return; }
      custom.forEach((c) => list.append(el('div', { class: 'admin-phase2-row' },
        el('strong', null, c.name),
        el('code', null, c.slug),
        el('span', { class: 'admin-order-meta' }, c.type === 'game' ? 'لعبة' : 'تطبيق'),
        el('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => {
          if (!confirm(`حذف الفئة «${c.name}»؟`)) return;
          try {
            await api(`/api/admin/categories/${encodeURIComponent(c.slug)}`, { method: 'DELETE' });
            logAdminAction(`حذف الفئة «${c.name}»`);
            renderCategories(body);
          } catch (e) { toast('فشل الحذف', 'error'); }
        } }, t('حذف الفئة')))));
    }
    draw();
    body.append(
      phaseHead(t('الفئات'), 'أضف فئات مخصصة أو أعد تسمية فئة موجودة؛ تُدمج تلقائياً مع فئات المتجر الأساسية.'),
      el('div', { class: 'admin-dash-grid' },
        el('div', { class: 'panel' },
          el('div', { class: 'panel-head' }, ico('plus', 'icon'), t('إضافة فئة')),
          el('div', { class: 'form' },
            el('div', { class: 'field' }, el('label', null, t('معرف الفئة')), slugIn),
            el('div', { class: 'field' }, el('label', null, t('اسم الفئة')), nameIn),
            el('div', { class: 'field' }, el('label', null, t('النوع')), typeIn),
            el('div', { class: 'field' }, el('label', null, t('فرز حسب')), posIn),
            el('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
              if (!slugIn.value.trim() || !nameIn.value.trim()) { toast('أكمل الحقول', 'error'); return; }
              try {
                await api('/api/admin/categories', { method: 'POST',
                  body: { slug: slugIn.value.trim().toLowerCase(), name: nameIn.value.trim(),
                    type: typeIn.value, position: Number(posIn.value) || 99 } });
                logAdminAction(`إضافة الفئة «${nameIn.value.trim()}»`);
                toast('تم الحفظ', 'success'); renderCategories(body);
              } catch (e) { toast('فشل الحفظ', 'error'); }
            } }, t('إضافة فئة')))),
        el('div', { class: 'admin-dash-side' },
          el('div', { class: 'panel' },
            el('div', { class: 'panel-head' }, ico('grid', 'icon'), t('الفئات')), list))),
    );
  }

  async function renderTeam(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    let res = { roles: [], me: '' };
    try { res = await api('/api/admin/roles'); } catch (e) {}
    body.innerHTML = '';
    const userIn = el('input', { class: 'input', placeholder: 'اسم المستخدم / البريد', 'aria-label': t('المشرف') });
    const roleIn = el('select', { class: 'input', 'aria-label': t('الدور') },
      el('option', { value: 'viewer' }, t('مشاهد')),
      el('option', { value: 'editor' }, t('محرر')),
      el('option', { value: 'owner' }, t('مالك')));
    const list = el('div', { class: 'admin-phase2-list' });
    (res.roles || []).forEach((r) => list.append(el('div', { class: 'admin-phase2-row' },
      el('strong', null, r.username),
      el('span', { class: 'admin-role-badge' }, r.role),
      el('span', { class: 'admin-order-meta' }, r.username === res.me ? 'أنت' : ''),
      el('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => {
        if (!confirm(`إزالة صلاحية ${r.username}؟`)) return;
        try {
          await api(`/api/admin/roles/${encodeURIComponent(r.username)}`, { method: 'DELETE' });
          logAdminAction(`إزالة دور ${r.username}`);
          renderTeam(body);
        } catch (e) { toast('تعذّر الإزالة (آخر مالك؟)', 'error'); }
      } }, t('حذف')))));
    if (!(res.roles || []).length) list.append(el('div', { class: 'hint' }, 'لا يوجد مالكون بعد — أول من يضيف دور «مالك» يصبح مالك النظام.'));
    body.append(
      phaseHead(t('المشرفون والصلاحيات'), 'سجل أدوار للمشرفين: مالك يتحكم بالصلاحيات والنسخ الاحتياطي، محرر، ومشاهد. الحساب الحالي يعمل دائماً.',
        el('span', { class: 'admin-role-me' }, res.me)),
      el('div', { class: 'admin-dash-grid' },
        el('div', { class: 'panel' },
          el('div', { class: 'panel-head' }, ico('shield', 'icon'), t('إضافة مشرف')),
          el('div', { class: 'form' },
            el('div', { class: 'field' }, el('label', null, t('المشرف')), userIn),
            el('div', { class: 'field' }, el('label', null, t('الدور')), roleIn),
            el('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
              if (!userIn.value.trim()) { toast('أدخل اسم المستخدم', 'error'); return; }
              try {
                await api('/api/admin/roles', { method: 'POST',
                  body: { username: userIn.value.trim(), role: roleIn.value } });
                logAdminAction(`تعيين دور ${roleIn.value} لـ ${userIn.value.trim()}`);
                toast('تم الحفظ', 'success'); renderTeam(body);
              } catch (e) { toast('فشل الحفظ (صلاحية مالك مطلوبة)', 'error'); }
            } }, t('إضافة مشرف')))),
        el('div', { class: 'admin-dash-side' },
          el('div', { class: 'panel' },
            el('div', { class: 'panel-head' }, ico('user', 'icon'), t('المشرفون')), list))),
      el('div', { class: 'hint' }, 'ملاحظة: هذا سجل أدوار للأقسام الإدارية الجديدة؛ تسجيل الدخول نفسه يبقى عبر حساب الأدمن الحالي.'),
    );
  }

  async function renderActivity(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    let rows = [];
    try { rows = (await api('/api/admin/activity')).activity || []; } catch (e) {}
    body.innerHTML = '';
    const filter = el('input', { class: 'input admin-table-search', type: 'search',
      placeholder: t('تصفية السجل'), 'aria-label': t('تصفية السجل') });
    const tbody = el('tbody');
    const table = el('table', { class: 'table' },
      el('thead', null, el('tr', null,
        el('th', null, t('الإجراء')), el('th', null, t('المشرف')),
        el('th', null, t('تاريخ النشر')))), tbody);
    function draw() {
      const q = filter.value.trim().toLowerCase();
      const list = rows.filter((r) => !q || [r.action, r.actor, r.kind]
        .some((v) => String(v || '').toLowerCase().includes(q)));
      tbody.innerHTML = '';
      if (!list.length) {
        tbody.append(el('tr', null, el('td', { colspan: '3' }, t('لا توجد نتائج'))));
        return;
      }
      list.forEach((r) => tbody.append(el('tr', null,
        el('td', null, r.action), el('td', null, r.actor || '—'),
        el('td', null, r.ts ? formatDate(r.ts) : '—'))));
    }
    filter.addEventListener('input', draw);
    draw();
    const exportBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => {
      const q = filter.value.trim().toLowerCase();
      const list = rows.filter((r) => !q || String(r.action || '').toLowerCase().includes(q));
      const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const csv = '\ufeff' + ['action,actor,kind,ts',
        ...list.map((r) => [r.action, r.actor, r.kind, r.ts].map(esc).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: 'goldenstore-activity.csv' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      logAdminAction(t('تصدير السجل'));
    } }, ico('download'), t('تصدير السجل'));
    body.append(
      phaseHead(t('سجل النشاطات'), 'سجل دائم على الخادم لكل عمليات النشر والحذف والترتيب والاستيراد.', exportBtn),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('clock', 'icon'), t('سجل النشاطات')),
        el('div', { class: 'admin-table-toolbar' }, filter),
        rows.length ? el('div', { class: 'table-wrap' }, table)
          : el('div', { class: 'hint' }, t('لا نشاطات بعد'))),
    );
  }

  /* ===================== كلمة السر والأمان =====================
     The admin password used to live only in the Worker secret, so changing it
     meant opening Cloudflare. It can now be changed here; the server stores a
     PBKDF2 hash (never the text) and it wins over the secret. The current
     password is required, so a stolen session cannot lock the owner out. */
  async function renderSecurity(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    let status = { custom: false, source: 'worker_secret', updated_at: 0, min_length: 8 };
    try { status = await api('/api/admin/password/status'); } catch (e) {}

    const current = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', 'aria-label': t('كلمة السر الحالية') });
    const next = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', 'aria-label': t('كلمة السر الجديدة') });
    const confirm = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', 'aria-label': t('تأكيد كلمة السر') });
    const show = el('input', { type: 'checkbox' });
    show.addEventListener('change', () => {
      for (const f of [current, next, confirm]) f.type = show.checked ? 'text' : 'password';
    });
    const msg = el('div', { class: 'hint', style: { minHeight: '20px' } });
    const saveBtn = el('button', { class: 'btn btn-primary', type: 'button' }, ico('check'), 'حفظ كلمة السر');

    saveBtn.onclick = async () => {
      msg.textContent = '';
      if ((next.value || '').length < 8) { msg.textContent = 'كلمة السر يجب أن تكون ٨ محارف على الأقل.'; return; }
      if (next.value !== confirm.value) { msg.textContent = 'التأكيد لا يطابق كلمة السر الجديدة.'; return; }
      saveBtn.disabled = true;
      try {
        await api('/api/admin/password', {
          method: 'POST',
          body: { current_password: current.value, new_password: next.value, confirm_password: confirm.value },
        });
        toast('تم تغيير كلمة السر — استخدمها في الدخول القادم', 'success');
        current.value = ''; next.value = ''; confirm.value = '';
        renderApp();
      } catch (e) {
        const code = String((e && e.message) || '');
        const st = e && typeof e.status === 'number' ? e.status : 0;
        const byCode = {
          wrong_current_password: 'كلمة السر الحالية غير صحيحة.',
          password_too_short: 'كلمة السر الجديدة قصيرة (٨ محارف على الأقل).',
          password_mismatch: 'التأكيد لا يطابق.',
          password_unchanged: 'كلمة السر الجديدة مطابقة للحالية.',
        }[code];
        let text;
        if (byCode) text = byCode;
        else if (st === 401 || st === 403) text = 'انتهت جلستك. سجّل الدخول من جديد ثم أعد المحاولة.';
        else if (st === 0 || (e && e.message === 'timeout')) text = 'لا اتصال بالخادم من جهازك — لم تُرسل كلمة السر.';
        else if (st >= 500 || st === 404) text = 'الخادم لا يستجيب الآن (رمز ' + st + '). لم تُحفظ كلمة السر، والقديمة ما زالت تعمل. حاول بعد قليل.';
        else text = 'تعذّر الحفظ لسبب في الخادم (رمز ' + (st || '؟') + '). لم تُحفظ كلمة السر.';
        msg.textContent = text;
      } finally { saveBtn.disabled = false; }
    };

    const field = (label, input, hint) => el('div', { class: 'field' },
      el('label', null, label), input, hint ? el('div', { class: 'hint' }, hint) : null);

    body.innerHTML = '';
    body.append(
      el('div', { class: 'admin-page-head' },
        el('div', null,
          el('h1', { class: 'admin-page-title' }, 'كلمة السر والأمان'),
          el('p', { class: 'admin-page-sub' }, 'غيّر كلمة سر لوحة الإدارة من هنا — بلا حاجة لفتح Cloudflare.'))),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('lock'), 'كلمة سر لوحة الإدارة'),
        el('div', { class: 'hint', style: { marginBottom: '12px' } },
          status.custom
            ? `كلمة السر مخصّصة من لوحة التحكم${status.updated_at ? ' — آخر تغيير: ' + new Date(status.updated_at * 1000).toLocaleDateString('ar-EG-u-nu-latn') : ''}`
            : 'كلمة السر الحالية هي السرّ المضبوط على Worker — بعد الحفظ من هنا تصبح هذه هي المعتمدة.'),
        field('كلمة السر الحالية', current),
        field('كلمة السر الجديدة', next, '٨ محارف على الأقل — يُفضّل حروف وأرقام ورموز.'),
        field('تأكيد كلمة السر الجديدة', confirm),
        el('label', { class: 'admin-update-row', style: { cursor: 'pointer' } }, show, el('span', null, 'إظهار كلمة السر')),
        saveBtn, msg),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('shield'), 'ملاحظات'),
        el('div', { class: 'hint' }, 'تغيير كلمة السر يُبطل الجلسات القديمة على أجهزة أخرى. ' +
          'إن نسيت كلمة السر، يمكن دائماً استخدام السرّ المضبوط على Worker (ADMIN_PASSWORD) للدخول ثم تغييرها.')),
    );
  }

  /* ===================== كلاود R2 =====================
     A complete replacement for dash.cloudflare.com for everything the owner
     needs day to day: see the bucket totals, browse every file with its size
     and whether the store still uses it, upload to any path, open a file with a
     signed link, delete a selection, empty the bucket — and «نبدأ من جديد»
     which clears the catalogue AND the bucket at once.
     The R2 keys live in the Worker's secrets, so nothing is exposed here. */
  async function renderCloudPanel(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    const state = { prefix: '', objects: [], overview: null, selected: new Set() };
    const out = el('div', { style: { fontSize: '13px', lineHeight: '1.7' } });
    const stats = el('div', { class: 'admin-update-row' });

    const load = async () => {
      try {
        state.overview = await api('/api/admin/r2/overview', { timeoutMs: 120000 });
      } catch (e) { state.overview = null; }
      renderStats();
    };

    const renderStats = () => {
      stats.innerHTML = '';
      const o = state.overview;
      if (!o) { stats.textContent = 'تعذّر قراءة الحاوية — تحقق من مفاتيح R2 في أسرار Worker.'; return; }
      const row = (k, v) => stats.append(el('div', null, el('span', null, k), el('strong', null, v)));
      row('الحاوية', o.bucket);
      row('المسار', o.endpoint);
      row('النطاق العام', o.public_url || '—');
      row('الملفات', `${formatNum(o.count)} (${formatBytes(o.bytes)})`);
      row('ملفات يتيمة', `${formatNum(o.orphans)} (${formatBytes(o.orphan_bytes)})`);
      row('مفاتيح مستخدمة', formatNum(o.referenced));
      const folders = Object.entries(o.folders || {}).map(([f, v]) => `${f} ${v.count}`).join(' · ');
      if (folders) stats.append(el('div', { class: 'hint' }, folders));
    };

    const listBox = el('div');
    const prefixInput = el('input', { class: 'input', type: 'text', placeholder: 'مجلد: apk/ أو ss/ أو اتركه فارغاً', 'aria-label': t('المجلد') });
    const browseBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, ico('search'), 'استعراض');
    const delSelBtn = el('button', { class: 'btn btn-danger btn-sm', type: 'button', disabled: true }, ico('trash'), 'حذف المحدد');

    const renderList = () => {
      listBox.innerHTML = '';
      if (!state.objects.length) { listBox.append(el('div', { class: 'hint' }, 'لا ملفات في هذا المسار.')); return; }
      const table = el('table', { class: 'table' },
        el('thead', null, el('tr', null,
          el('th', null, ''), el('th', null, 'الملف'), el('th', null, 'الحجم'), el('th', null, 'الحالة'), el('th', null, ''))),
        el('tbody', null, ...state.objects.map((o) => {
          const cb = el('input', { type: 'checkbox', 'aria-label': o.key });
          cb.checked = state.selected.has(o.key);
          cb.addEventListener('change', () => {
            if (cb.checked) state.selected.add(o.key); else state.selected.delete(o.key);
            delSelBtn.disabled = !state.selected.size;
          });
          return el('tr', null,
            el('td', null, cb),
            el('td', { style: { wordBreak: 'break-all', fontSize: '12px' } }, o.key),
            el('td', null, formatBytes(o.size)),
            el('td', null, o.referenced
              ? el('span', { class: 'admin-update-force' }, 'مستخدم')
              : el('span', { class: 'hint' }, 'يتيم')),
            el('td', null, el('button', {
              class: 'btn btn-sm btn-secondary', type: 'button', title: t('فتح'),
              onclick: async () => {
                try {
                  const r2 = await api(`/api/admin/r2/download-url?key=${encodeURIComponent(o.key)}`);
                  window.open(r2.url, '_blank');
                } catch { toast('تعذّر فتح الملف', 'error'); }
              },
            }, ico('external'))),
          );
        })),
      );
      listBox.append(table);
    };

    browseBtn.onclick = async () => {
      browseBtn.disabled = true;
      listBox.textContent = 'جارٍ التحميل…';
      try {
        state.prefix = prefixInput.value.trim();
        state.selected.clear();
        delSelBtn.disabled = true;
        const res = await api(`/api/admin/r2/objects?prefix=${encodeURIComponent(state.prefix)}`, { timeoutMs: 120000 });
        state.objects = res.objects || [];
        if (!state.objects.length) listBox.textContent = '';
        renderList();
      } catch (e) { listBox.textContent = 'تعذّر الاستعراض: ' + ((e && e.message) || 'خطأ'); }
      finally { browseBtn.disabled = false; }
    };

    delSelBtn.onclick = async () => {
      if (!state.selected.size) return;
      if (!confirm(`حذف ${state.selected.size} ملفاً من كلاود؟`)) return;
      delSelBtn.disabled = true;
      try {
        const res = await api('/api/admin/r2/delete', { method: 'POST', body: { keys: [...state.selected] } });
        toast(`أُزيل ${res.deleted} ملفاً` + (res.failed ? ` — تعذّر ${res.failed}` : ''), 'success');
        state.selected.clear();
        browseBtn.click();
        load();
      } catch { toast('فشل الحذف', 'error'); delSelBtn.disabled = false; }
    };

    // upload to any path
    const upKey = el('input', { class: 'input', type: 'text', placeholder: 'apk/اسم-الملف.apk', 'aria-label': t('مسار الرفع') });
    const upFile = el('input', { type: 'file' });
    const upBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, ico('upload'), 'رفع إلى كلاود');
    upBtn.onclick = async () => {
      const f = upFile.files && upFile.files[0];
      if (!f || !upKey.value.trim()) { toast('اختر ملفاً واكتب المسار', 'error'); return; }
      upBtn.disabled = true;
      try {
        const r2 = await api('/api/admin/r2/upload-url', { method: 'POST', body: { key: upKey.value.trim(), content_type: f.type || 'application/octet-stream' } });
        const put = await fetch(r2.url, { method: 'PUT', body: f, headers: { 'Content-Type': f.type || 'application/octet-stream' } });
        if (!put.ok) throw new Error('upload_' + put.status);
        toast('تم الرفع — الرابط العام: ' + r2.public_url, 'success');
        out.textContent = r2.public_url;
        load();
      } catch (e) { toast('فشل الرفع: ' + ((e && e.message) || ''), 'error'); }
      finally { upBtn.disabled = false; }
    };

    /* ── Sweep unused files ──────────────────────────────────────────────────
     * Owner: «حذفت من لوحة التحكم حذف كل شئ … ولكن صورة المصغرة تبع الفيديو لم
     * تحذف». A thumbnail whose row was lost can only be found by comparing the
     * bucket with the database — that is what this does, and it names the files
     * before touching anything.
     */
    const orphanOut = el('div', { class: 'hint', style: { marginTop: '8px', lineHeight: '1.7' } });
    const orphanScan = el('button', { class: 'btn btn-sm', type: 'button' }, ico('search'), 'افحص الملفات غير المستخدمة');
    const orphanDelete = el('button', { class: 'btn btn-danger btn-sm', type: 'button', disabled: true }, ico('trash'), 'احذف الملفات غير المستخدمة');
    const orphanBox = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' } },
      orphanScan, orphanDelete, orphanOut);

    const accountScan = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, ico('search'), 'افحص أين ذهب الحجم');
    const accountAbort = el('button', { class: 'btn btn-danger btn-sm', type: 'button' }, ico('trash'), 'ألغِ الرفع المنقطع');
    accountAbort.disabled = true;
    const accountOut = el('div', { style: { fontSize: '13px', lineHeight: '1.7', whiteSpace: 'pre-wrap', width: '100%' } });

    orphanScan.onclick = async () => {
      orphanScan.disabled = true;
      orphanOut.textContent = 'أقارن الحاوية بقاعدة البيانات…';
      try {
        const r = await api('/api/admin/r2/orphans', { timeoutMs: 120000 });
        if (!r.orphans) {
          orphanOut.textContent = `الحاوية نظيفة — ${r.scanned} ملفاً وكلها مستخدمة.`;
          orphanDelete.disabled = true;
        } else {
          const mb = (r.bytes / (1024 * 1024)).toFixed(1);
          const folders = Object.entries(r.by_folder || {}).map(([k, v]) => `${k}: ${v.count}`).join(' · ');
          orphanOut.innerHTML = '';
          orphanOut.append(
            el('div', null, `${r.orphans} ملفاً غير مستخدم (${mb} م.ب) من ${r.scanned}. ${folders}. لم يُحذف شيء بعد.`),
            el('pre', { style: { marginTop: '8px', fontSize: '11px', whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'left', opacity: '.85' } },
              (r.keys || []).slice(0, 10).join('\n')),
          );
          orphanDelete.disabled = false;
        }
      } catch (e) {
        orphanOut.textContent = (e && e.status >= 500) ? 'الخادم لا يستجيب الآن — لم يتغيّر شيء.' : 'تعذّر الفحص.';
      } finally { orphanScan.disabled = false; }
    };

    orphanDelete.onclick = async () => {
      if (!confirm('حذف الملفات التي لا يستخدمها أي عنصر في المتجر؟ لا يمكن التراجع.')) return;
      orphanDelete.disabled = true;
      orphanOut.textContent = 'أحذف…';
      try {
        const r = await api('/api/admin/r2/orphans', { method: 'POST', body: { confirm: 'DELETE-ORPHANS' }, timeoutMs: 240000 });
        orphanOut.textContent = r.failed
          ? `حُذف ${r.deleted} وبقي ${r.failed} — أعد المحاولة.`
          : `حُذف ${r.deleted} ملفاً — الحاوية نظيفة الآن.`;
        toast(`حُذف ${r.deleted} ملفاً`, 'success');
        state.selected.clear(); browseBtn.click(); load();
      } catch (e) {
        orphanOut.textContent = 'تعذّر الحذف: ' + ((e && e.message) || 'حاول لاحقاً');
      } finally { orphanDelete.disabled = false; }
    };

    /* ── «رفعت تطبيقاً ولم يُنشر» — كل عنصر، وسببه، وزر النشر ────────────────
     * The owner kept seeing files in the bucket for items that never appeared in
     * the store. The site cannot be diagnosed from the bucket's object list, so
     * this walks D1 + storage and answers per item: is every file really there,
     * what does the console's publication row say, would /api/apps show it, and
     * if not — WHY. A hidden item gets a one-press «انشر الآن».
     */
    const healthOut = el('div', { style: { fontSize: '13px', lineHeight: '1.8', width: '100%' } });
    const healthRun = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, ico('check'), 'لماذا لم يُنشر؟');
    const healthBox = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' } }, healthRun, healthOut);

    const REASON = {
      draft: 'محفوظ كمسوّدة — مخفي عن المتجر',
      scheduled_for_later: 'مجدول لوقت لاحق',
      file_missing: 'ملف مذكور في القاعدة غير موجود في الحاوية',
      no_apk: 'لا يوجد ملف APK',
    };

    healthRun.onclick = async () => {
      healthRun.disabled = true;
      healthOut.textContent = 'أفحص كل عنصر وملفاته…';
      try {
        const r = await api('/api/admin/publish/health', { timeoutMs: 180000 });
        const c1 = r.counts || {};
        healthOut.innerHTML = '';
        healthOut.append(el('div', null,
          `${formatNum(c1.items || 0)} عنصراً · ظاهر ${formatNum(c1.visible || 0)} · مخفي ${formatNum(c1.hidden || 0)}`
          + ` · ملفات مفقودة ${formatNum(c1.files_missing || 0)}`
          + ` · ملفات مرفوعة بلا حفظ ${formatNum(c1.files_never_saved || 0)}`));
        healthOut.append(el('div', { style: { color: r.ok ? 'var(--success)' : 'var(--danger)' } }, r.verdict || ''));

        const hidden = (r.items || []).filter((it) => !it.visible_in_catalogue);
        if (hidden.length) {
          const t = el('table', { class: 'table admin-table', style: { marginTop: '8px' } },
            el('thead', null, el('tr', null,
              el('th', null, 'العنصر'), el('th', null, 'السبب'), el('th', null, 'ملفات'), el('th', null, 'إجراء'))));
          const tb = el('tbody');
          hidden.forEach((it) => {
            const btn = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, ico('upload'), 'انشر الآن');
            btn.onclick = async () => {
              btn.disabled = true;
              try {
                await api('/api/admin/publication', { method: 'POST', body: { slug: it.slug, status: 'published' } });
                toast(`نُشر «${it.name}»`, 'success');
                healthRun.click();
              } catch (e) { toast('تعذّر النشر — أعد المحاولة', 'error'); }
              finally { btn.disabled = false; }
            };
            tb.append(el('tr', null,
              el('td', null, el('div', null, it.name), el('div', { class: 'hint' }, it.slug)),
              el('td', null, REASON[it.blocked_by] || it.blocked_by || '—'),
              el('td', null, it.files_missing.length
                ? `مفقود: ${it.files_missing.join(' , ')}`
                : `${formatNum(it.files.length)} ملفاً سليماً`),
              el('td', null, it.blocked_by === 'draft' || it.blocked_by === 'scheduled_for_later'
                ? btn : el('span', { class: 'hint' }, 'أعد رفع الملف من صفحة العنصر'))));
          });
          t.append(tb);
          healthOut.append(t);
        }

        const never = (r.files_never_saved || []).slice(0, 10);
        if (never.length) {
          healthOut.append(el('div', { class: 'hint', style: { marginTop: '8px' } },
            'ملفات في الحاوية لا يشير إليها أي عنصر (رفع اكتمل ثم لم يُحفظ): '
            + never.map((f) => f.key).join(' · ')
            + ' — «تنظيف الحاوية» يحذفها.'));
        }
      } catch (e) {
        healthOut.textContent = (e && e.status === 401) ? 'انتهت الجلسة، أعد الدخول.' : 'تعذّر الفحص.';
      } finally { healthRun.disabled = false; }
    };

    /* ── «التحديث لا يرفع ولا يبعث إشعاراً» — فحص يشغّل المسار الحقيقي ────────
     * The two promises of the «تحديث» button failed in two different places, and
     * both used to surface as the same word: «فشل». This runs the real path:
     *   1. a presigned upload URL, then a PUT through the store's own origin,
     *   2. a multipart create+abort (what every APK above 10 MB uses),
     *   3. the notification engine: is push on? are there tokens? are the last
     *      release rows really in the database?
     * It also offers the two repairs that can be applied from here: re-apply the
     * bucket's CORS rule (now including POST/DELETE for multipart) and open the
     * notification settings.
     */
    const doctorOut = el('div', { style: { fontSize: '13px', lineHeight: '1.9', width: '100%' } });
    const doctorRun = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, ico('wrench'), 'افحص الرفع والإشعارات');
    const doctorCors = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', style: { display: 'none' } }, ico('cloud'), 'أصلح قواعد CORS للحاوية');
    const doctorBox = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' } },
      doctorRun, doctorCors, doctorOut);

    doctorRun.onclick = async () => {
      doctorRun.disabled = true;
      doctorOut.textContent = 'أفحص…';
      try {
        const r = await api('/api/admin/publish/doctor', { timeoutMs: 90000 });
        const s1 = r.storage || {}, mp = r.multipart || {}, n = r.notifications || {};
        doctorOut.innerHTML = '';
        const row = (label, ok, detail) => el('div', null,
          el('span', { style: { color: ok ? 'var(--success)' : 'var(--danger)' } }, ok ? '● ' : '● '),
          `${label}: ${detail}`);
        doctorOut.append(
          row('الكتابة إلى الحاوية', !!s1.write, s1.write
            ? `نجحت (${formatNum(s1.ms || 0)} ms)`
            : (s1.error || 'فشلت من الخادم نفسه — راجع مفاتيح R2')),
          row('الرفع متعدد الأجزاء (APK كبير)', !!mp.ok, mp.ok ? 'يعمل' : (mp.error || 'فشل')),
          row('الإشعارات', !!n.can_send, n.can_send
            ? `تعمل · أجهزة: ${formatNum(n.device_tokens || 0)} · اشتراكات ويب: ${formatNum(n.web_subscriptions || 0)}`
            : (n.why_blocked === 'quiet_hours'
              ? `مؤجّلة الآن — ساعات الهدوء ${n.quiet_range}`
              : 'الدفع متوقف من الإعدادات (push_enabled)')),
        );
        const last = (n.last_updates || []).length;
        doctorOut.append(el('div', { class: 'hint' }, last
          ? `آخر إشعارات التحديث: ${(n.last_updates || []).map((x) => x.title).join(' · ')}`
          : 'لا يوجد أي إشعار تحديث مسجّل بعد — إن حدّثت تطبيقاً ولم يظهر هنا فالسبب في الخادم.'));
        doctorOut.append(el('div', { style: { marginTop: '4px' } }, r.verdict || ''));
        doctorCors.style.display = (mp.ok && s1.write) ? 'none' : '';
      } catch (e) {
        doctorOut.textContent = (e && e.status === 401) ? 'انتهت الجلسة، أعد الدخول.' : 'تعذّر الفحص.';
      } finally { doctorRun.disabled = false; }
    };

    doctorCors.onclick = async () => {
      doctorCors.disabled = true;
      try {
        const r = await api('/api/admin/r2/cors', { method: 'POST', timeoutMs: 30000 });
        toast(`ضُبطت CORS لـ${(r.origins || []).length} نطاقاً — الطرق: ${(r.methods || []).join(', ')}`, 'success');
      } catch (e) {
        toast('تعذّر ضبط CORS — تأكد أن مفتاح R2 يملك صلاحية تعديل الحاوية', 'error');
      } finally { doctorCors.disabled = false; }
    };

    /* ── تنظيف الحاوية: بقايا الأسماء القديمة ونسخ مكرّرة ─────────────────────
     * The new bucket's object list still shows history:
     * `apk/getting-over-it-179570037`, `ss/subway-surfers.webp`,
     * `vthumb/video-2.jpg`. This decides from the bytes and from D1 — a name
     * that is not referenced IS junk, and a file whose bytes match a used file
     * is a copy — then lets the owner delete both in one press.
     */
    const sweepOut = el('div', { style: { fontSize: '13px', lineHeight: '1.8', width: '100%' } });
    const sweepPlan = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, ico('search'), 'اكتشف البقايا');
    const sweepGo = el('button', { class: 'btn btn-danger btn-sm', type: 'button', style: { display: 'none' } }, ico('trash'), 'احذف البقايا والنسخ');
    const sweepBox = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' } }, sweepPlan, sweepGo, sweepOut);

    sweepPlan.onclick = async () => {
      sweepPlan.disabled = true;
      sweepOut.textContent = 'أفحص بايتات كل ملف…';
      try {
        const r = await api('/api/admin/storage/sweep', { timeoutMs: 180000 });
        sweepOut.innerHTML = '';
        const o = r.orphans || {}, bc = r.byte_copies || {}, sp = r.same_picture || {};
        sweepOut.append(
          el('div', null, `الحاوية: ${formatNum((r.bucket || {}).objects || 0)} ملفاً · يشير إليها الموقع: ${formatNum((r.bucket || {}).referenced || 0)}`),
          el('div', null, `بقايا لا يشير إليها أي عنصر: ${formatNum(o.count || 0)} (${formatBytes(o.bytes || 0)})`),
          el('div', null, `نسخ بنفس البايتات لملف مستخدم: ${formatNum((bc.plan || []).reduce((n, g) => n + (g.remove || []).length, 0))} (${formatBytes(bc.bytes || 0)})`),
          el('div', { style: { color: 'var(--success)' } }, r.verdict || ''),
        );
        // «same picture, another size» is reported but never deleted automatically:
        // the owner decides whether the duplicate screenshot is the good one.
        const spGroups = (sp.plan || []).slice(0, 5);
        spGroups.forEach((g) => sweepOut.append(el('div', { class: 'hint' },
          `نفس الصورة باسمين: يُبقى ${g.keep} — يُحذف ${(g.remove || []).join(' , ')}`)));
        const list = (o.keys || []).slice(0, 12);
        if (list.length) {
          sweepOut.append(el('div', { class: 'hint', style: { marginTop: '4px' } }, 'أمثلة: ' + list.join(' · ')));
        }
        const total = Number(o.count || 0) + (bc.plan || []).reduce((n, g) => n + (g.remove || []).length, 0);
        sweepGo.style.display = total ? '' : 'none';
        sweepGo.dataset.total = String(total);
      } catch (e) {
        sweepOut.textContent = (e && e.status === 401) ? 'انتهت الجلسة، أعد الدخول.' : 'تعذّر الفحص الآن.';
      } finally { sweepPlan.disabled = false; }
    };

    sweepGo.onclick = async () => {
      const n = Number(sweepGo.dataset.total || 0);
      if (!n) return;
      if (!confirm(`سيُحذف ${n} ملفاً من الحاوية: بقايا لا يشير إليها أي عنصر + نسخ مكرّرة. لا يُحذف أي ملف يستخدمه الموقع. متابعة؟`)) return;
      sweepGo.disabled = true;
      try {
        const r = await api('/api/admin/storage/sweep', {
          method: 'POST', timeoutMs: 180000, body: { confirm: 'SWEEP', groups: 'both' },
        });
        toast(`حُذف ${formatNum(r.deleted || 0)} ملفاً` + (r.failed ? ` — تعذّر حذف ${r.failed}` : ''), r.failed ? 'error' : 'success');
        sweepOut.textContent = 'انتهى. اضغط «اكتشف البقايا» مرة أخرى للتأكيد — يجب أن تظهر صفراً.';
        sweepGo.style.display = 'none';
      } catch (e) {
        toast('تعذّر الحذف', 'error');
      } finally { sweepGo.disabled = false; }
    };

    /* ── الحاوية الجديدة: هل كل ملف موجود فعلاً؟ ─────────────────────────────
     * The owner replaced the bucket. A replaced bucket is silent: the site keeps
     * answering 200, the row keeps its key, and only the picture is missing. This
     * asks the bucket about every key the store points at, and names each miss.
     */
    const checkOut = el('div', { style: { fontSize: '13px', lineHeight: '1.8', width: '100%' } });
    const checkRun = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, ico('check'), 'افحص الحاوية الجديدة');
    const checkBox = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' } }, checkRun, checkOut);

    checkRun.onclick = async () => {
      checkRun.disabled = true;
      checkOut.textContent = 'أفحص كل ملف…';
      try {
        const r = await api('/api/admin/storage/check', { timeoutMs: 120000 });
        checkOut.innerHTML = '';
        const c1 = r.checked || {}, b = r.bucket || {};
        checkOut.append(
          el('div', null, `الحاوية: ${b.name || '—'} · الملفات المفحوصة: ${formatNum(c1.files || 0)} من ${formatNum(c1.apps || 0)} عنصراً`),
          el('div', { style: { color: r.ok ? 'var(--success)' : 'var(--danger)' } }, r.verdict || ''),
        );
        if ((r.missing_files || []).length) {
          const t = el('table', { class: 'table admin-table', style: { marginTop: '8px' } },
            el('thead', null, el('tr', null, el('th', null, 'الملف المفقود'), el('th', null, 'يستخدمه'))));
          const tb = el('tbody');
          (r.missing_files || []).forEach((m) => tb.append(el('tr', null,
            el('td', null, m.key), el('td', null, (m.used_by || []).join(' · ')))));
          t.append(tb); checkOut.append(t);
        }
        if (r.release) {
          checkOut.append(el('div', null, `ملف تنزيل المتجر: ${r.release.present ? 'موجود' : 'مفقود'} (${r.release.key})`));
        }
        if ((r.strays || {}).count) {
          checkOut.append(el('div', { class: 'hint', style: { marginTop: '6px' } },
            `ملفات لا يشير إليها أي عنصر: ${formatNum(r.strays.count)} (${formatBytes(r.strays.bytes || 0)}) — زر «رتّب التخزين» يحذفها.`));
        }
      } catch (e) {
        checkOut.textContent = (e && e.status === 401) ? 'انتهت الجلسة، أعد الدخول.' : 'تعذّر الفحص الآن.';
      } finally { checkRun.disabled = false; }
    };

    /* ── «لماذا الثقل؟» — measured, not argued ────────────────────────────────
     * Owner: «اضن سبب الثقل الموقع لانه بعيد» (bucket in Western North America).
     * Distance decides milliseconds; what a visitor actually feels is decided by
     * whether the phone may keep the pictures and how many network hops one page
     * needs. This shows both numbers so the answer is not a matter of opinion.
     */
    const diagOut = el('div', { style: { fontSize: '13px', lineHeight: '1.9', width: '100%' } });
    const diagRun = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, ico('trending'), 'قِس سرعة الموقع الآن');
    const diagBox = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' } }, diagRun, diagOut);

    diagRun.onclick = async () => {
      diagRun.disabled = true;
      diagOut.textContent = 'أقيس…';
      try {
        const r = await api('/api/admin/media/diag', { timeoutMs: 60000 });
        const p = r.pictures || {}, t = r.round_trip_ms || {};
        const ms = (v) => (v < 0 ? 'تعذّر' : `${formatNum(v)} ms`);
        diagOut.innerHTML = '';
        diagOut.append(
          el('div', null, `الصور تُخدَم من: ${String(p.served_from || '').includes('store domain') ? 'نطاق المتجر نفسه (كاش فعّال)' : 'نطاق الحاوية r2.dev (بلا كاش)'}`),
          el('div', null, `ترويسة الكاش من الحاوية: ${p.bucket_can_be_cached ? 'موجودة' : 'غائبة — الهاتف يعيد تنزيل كل صورة'}`),
          el('div', null, `زمن الذهاب والعودة: صورة ${ms(t.media)} · قاعدة البيانات ${ms(t.database)} · الصفحة (API) ${ms(t.catalogue)} · الحاوية ${ms(t.bucket)}`),
          el('div', { class: 'hint', style: { marginTop: '6px' } }, r.verdict || ''),
        );
      } catch (e) {
        diagOut.textContent = 'تعذّر القياس الآن.';
      } finally { diagRun.disabled = false; }
    };

    /* ── Files per item ──────────────────────────────────────────────────────
     * Owner: «لماذا التطبيقات والألعاب والأيقونات مختلطة وليست كل فئة على حدة».
     * Answers it with the bucket's own data rather than a promise: every item,
     * its files per folder, and the keys that carry an item's name but belong
     * to no row (a naming fault such as the old `vthumb/video.jpg`).
     */
    const itemsOut = el('div', { style: { fontSize: '13px', lineHeight: '1.7', width: '100%' } });
    const itemsScan = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, ico('search'), 'اعرض ملفات كل عنصر');
    const itemsBox = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' } }, itemsScan, itemsOut);

    itemsScan.onclick = async () => {
      itemsScan.disabled = true;
      itemsOut.innerHTML = 'أقرأ الحاوية وقاعدة البيانات…';
      try {
        const r = await api('/api/admin/r2/items', { timeoutMs: 120000 });
        itemsOut.innerHTML = '';
        const sm = r.summary || {};
        itemsOut.append(el('div', null,
          `${formatNum(sm.items || 0)} عنصراً (تطبيقات ${formatNum(sm.apps || 0)} · ألعاب ${formatNum(sm.games || 0)})`
          + ` · ملفات بأسماء عناصر ولا تنتمي إليها: ${formatNum(sm.stray_files || 0)}`
          + ` · عناصر تحتاج ترتيباً: ${formatNum(sm.items_needing_tidy || 0)}`));
        const table = el('table', { class: 'table admin-table', style: { marginTop: '10px' } },
          el('thead', null, el('tr', null,
            el('th', null, 'العنصر'), el('th', null, 'النوع'),
            el('th', null, 'APK'), el('th', null, 'أيقونة'), el('th', null, 'عرضية'),
            el('th', null, 'لقطات'), el('th', null, 'فيديو'), el('th', null, 'حالة التسمية'))));
        const tbody = el('tbody');
        (r.items || []).forEach((it) => {
          const n = (k) => (it.files[k] || []).length;
          tbody.append(el('tr', null,
            el('td', null, el('div', null, it.name), el('div', { class: 'hint' }, it.slug)),
            el('td', null, it.type === 'game' ? 'لعبة' : 'تطبيق'),
            el('td', null, String(n('apk'))), el('td', null, String(n('icon'))),
            el('td', null, String(n('feature'))), el('td', null, String(n('ss'))),
            el('td', null, String(n('vthumb'))),
            el('td', null, it.tidy
              ? el('span', { class: 'hint' }, 'سليمة')
              : el('span', { style: { color: 'var(--danger)' } }, it.stray.length ? `${it.stray.length} ملفاً غريباً` : 'اسم غير مطابق'))));
        });
        table.append(tbody);
        itemsOut.append(table);
        if ((r.summary || {}).stray_files) {
          itemsOut.append(el('div', { class: 'hint', style: { marginTop: '8px' } },
            'الملفات الغريبة تُصلح بزر «رتّب التخزين» أعلاه، أو تُحذف من بطاقة «بقايا هذا العنصر» في صفحة تعديل العنصر.'));
        }
      } catch (e) {
        itemsOut.textContent = (e && e.status >= 500) ? 'الخادم لا يستجيب الآن.' : 'تعذّر الفحص.';
      } finally { itemsScan.disabled = false; }
    };

    /* ── Where the storage came from ─────────────────────────────────────────
     * Owner: «من اين اتى ذالك الحجم من التخزين» — the Cloudflare panel showed
     * 337 MB while the store held nothing. Two things make that number look
     * impossible, and both are now shown instead of guessed:
     *   • «Bucket Size» is an AVERAGE over the period, so it keeps reporting
     *     bytes that were deleted hours ago. Only this audit is exact.
     *   • the parts of an upload that never finished are stored (and billed)
     *     but belong to no object, so no file list can show them.
     */
    const accountBox = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' } },
      accountScan, accountAbort, accountOut);

    accountScan.onclick = async () => {
      accountScan.disabled = true;
      accountOut.textContent = 'أعدّ الملفات وأقارنها بقاعدة البيانات…';
      try {
        const r = await api('/api/admin/r2/audit', { timeoutMs: 120000 });
        accountOut.innerHTML = '';
        accountOut.append(
          el('div', null, `في الحاوية الآن: ${formatNum(r.scanned_objects)} ملفاً · ${formatBytes(r.bytes_stored)}.`),
          el('div', { style: { marginTop: '6px' } },
            `مستخدم: ${formatNum(r.in_use)} ملفاً (${formatBytes(r.bytes_in_use)}) · غير مستخدم: ${formatNum(r.orphans)} ملفاً (${formatBytes(r.bytes_orphan)}).`),
        );
        if (r.unfinished_uploads) {
          accountOut.append(el('div', { style: { marginTop: '8px', color: 'var(--danger)' } },
            `${r.unfinished_uploads} رفع انقطع قبل نهايته — أجزاؤه محسوبة في حجم كلاود ولا تظهر بين الملفات.`));
          accountOut.append(el('pre', { style: { marginTop: '6px', fontSize: '11px', whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'left', opacity: '.85' } },
            (r.unfinished_upload_keys || []).slice(0, 10)
              .map((u) => `${u.key}  (${u.age_hours === null ? '?' : u.age_hours + ' ساعة'})`).join('\n')));
          accountAbort.disabled = false;
        } else {
          accountAbort.disabled = true;
          accountOut.append(el('div', { class: 'hint', style: { marginTop: '8px' } },
            'لا يوجد رفع منقطع — كل ما في الحاوية ملفات معروفة.'));
        }
        const kinds = r.orphan_kinds || {};
        if (r.orphans) {
          const line = [];
          if (kinds.leftovers_of_items?.count) line.push(`بقايا نشر/تعديل بأسماء العناصر: ${formatNum(kinds.leftovers_of_items.count)} (${formatBytes(kinds.leftovers_of_items.bytes)})`);
          if (kinds.old_timestamped_names?.count) line.push(`أسماء قديمة بطابع زمني: ${formatNum(kinds.old_timestamped_names.count)} (${formatBytes(kinds.old_timestamped_names.bytes)})`);
          if (kinds.unknown?.count) line.push(`أخرى: ${formatNum(kinds.unknown.count)} (${formatBytes(kinds.unknown.bytes)})`);
          if (line.length) accountOut.append(el('div', { style: { marginTop: '8px' } }, line.join(' · ')));
          accountOut.append(el('div', { class: 'hint', style: { marginTop: '6px' } },
            'تُحذف كلها من بطاقة «ملفات غير مستخدمة» أعلاه — أو بقايا كل عنصر على حدة من صفحة تعديله.'));
        }
        accountOut.append(el('div', { class: 'hint', style: { marginTop: '6px' } },
          'ملاحظة: رقم «Bucket Size» في كلاود متوسط على الفترة، ويبقى مرتفعاً ساعات بعد الحذف — الرقم أعلاه هو الحقيقي.'));
      } catch (e) {
        accountOut.textContent = (e && e.status >= 500) ? 'الخادم لا يستجيب الآن — لم يتغيّر شيء.' : 'تعذّر الفحص.';
      } finally { accountScan.disabled = false; }
    };

    accountAbort.onclick = async () => {
      if (!confirm('إلغاء كل عمليات الرفع المنقطعة وحذف أجزائها من كلاود؟')) return;
      accountAbort.disabled = true;
      accountOut.textContent = 'أُلغي…';
      try {
        const r = await api('/api/admin/r2/audit/abort', { method: 'POST', body: { confirm: 'ABORT-UPLOADS' }, timeoutMs: 180000 });
        accountOut.textContent = r.failed
          ? `أُلغي ${r.aborted} وبقي ${r.failed} — أعد المحاولة.`
          : `أُلغي ${r.aborted} رفعاً منقطعاً وحُذفت أجزاؤه — الحجم في كلاود سينخفض خلال ساعات.`;
        toast(`أُلغي ${r.aborted} رفعاً منقطعاً`, 'success');
        accountScan.click();
      } catch (e) {
        accountOut.textContent = 'تعذّر الإلغاء: ' + ((e && e.message) || 'حاول لاحقاً');
        accountAbort.disabled = false;
      }
    };

    /* ── Organise the bucket ──────────────────────────────────────────────────
     * Owner: «رتب التطبيقات والأيقونات وكل شئ داخل جداول التخزين». Uploads were
     * stored as <slug>-<epoch>-<hex>, so nothing in the bucket said what an object
     * belonged to. This shows the exact plan first (dry run), then performs it:
     * bytes are moved, every D1 reference is rewritten, duplicates collapse, and
     * unreferenced objects are never touched.
     */
    const organiseOut = el('div', { class: 'hint', style: { marginTop: '8px', lineHeight: '1.7' } });
    const organisePreview = el('button', { class: 'btn btn-sm', type: 'button' }, ico('grid'), 'اعرض خطة الترتيب');
    const organiseApply = el('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: true }, ico('check'), 'رتّب التخزين');
    const organiseBox = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' } },
      organisePreview, organiseApply, organiseOut);

    organisePreview.onclick = async () => {
      organisePreview.disabled = true;
      organiseOut.textContent = 'أقرأ محتويات الحاوية…';
      try {
        const plan = await api('/api/admin/r2/organise', { timeoutMs: 120000 });
        if (!plan.pending) {
          organiseOut.textContent = 'كل الملفات مرتّبة بالفعل — لا شيء يحتاج تغييراً.';
          organiseApply.disabled = true;
        } else {
          const kinds = Object.entries(plan.by_kind || {}).map(([k, n]) => `${k}: ${n}`).join(' · ');
          const lines = (plan.plan || []).slice(0, 12).map((m) => `• ${m.from}  →  ${m.to}`).join('\n');
          organiseOut.innerHTML = '';
          organiseOut.append(
            el('div', null, `${plan.pending} ملف يحتاج ترتيباً (${kinds}). لم يُغيَّر شيء بعد.`),
            el('pre', { style: { marginTop: '8px', fontSize: '11px', whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'left', opacity: '.85' } }, lines),
          );
          organiseApply.disabled = false;
        }
      } catch (e) {
        organiseOut.textContent = (e && e.status >= 500)
          ? 'الخادم لا يستجيب الآن — لم يتغيّر شيء.'
          : 'تعذّر قراءة الخطة: ' + ((e && e.message) || '');
      } finally { organisePreview.disabled = false; }
    };

    organiseApply.onclick = async () => {
      if (!confirm('إعادة تسمية الملفات وترتيبها؟ الروابط في قاعدة البيانات ستُحدَّث معها، والملفات اليتيمة لن تُلمس.')) return;
      organiseApply.disabled = true;
      organisePreview.disabled = true;
      organiseOut.textContent = 'أرتّب… قد يأخذ دقيقة.';
      try {
        const res = await api('/api/admin/r2/organise', { method: 'POST', body: { limit: 400 }, timeoutMs: 240000 });
        organiseOut.textContent = res.failed
          ? `تم ترتيب ${res.moved} ملفاً، وتعذّر ${res.failed} (بقي ${res.remaining}).`
          : `تم ترتيب ${res.moved} ملفاً بالكامل — بقي ${res.remaining}.`;
        toast(`تم ترتيب ${res.moved} ملفاً`, 'success');
        state.selected.clear(); browseBtn.click(); load();
      } catch (e) {
        organiseOut.textContent = 'تعذّر الترتيب: ' + ((e && e.message) || 'حاول لاحقاً');
      } finally { organiseApply.disabled = false; organisePreview.disabled = false; }
    };

    // full wipe
    const wipePhrase = el('input', { class: 'input', type: 'text', placeholder: 'DELETE-ALL', 'aria-label': 'DELETE-ALL' });
    const wipeBtn = el('button', { class: 'btn btn-danger btn-sm', type: 'button', disabled: true }, ico('trash'), 'مسح كل الملفات');
    wipePhrase.addEventListener('input', () => { wipeBtn.disabled = wipePhrase.value.trim() !== 'DELETE-ALL'; });
    wipeBtn.onclick = async () => {
      if (!confirm('مسح كل ملفات كلاود نهائياً؟')) return;
      wipeBtn.disabled = true;
      try {
        const res = await api('/api/admin/r2/wipe', { method: 'POST', body: { confirm: 'DELETE-ALL' }, timeoutMs: 180000 });
        toast(`تم المسح: ${res.deleted}/${res.count}`, 'success');
        state.selected.clear(); browseBtn.click(); load();
      } catch { toast('فشل المسح', 'error'); wipeBtn.disabled = false; }
    };

    // reset the whole store
    const resetPhrase = el('input', { class: 'input', type: 'text', placeholder: 'RESET-STORE', 'aria-label': 'RESET-STORE' });
    const resetBtn = el('button', { class: 'btn btn-danger btn-sm', type: 'button', disabled: true }, ico('trash'), 'تصفير المتجر — نبدأ من جديد');
    resetPhrase.addEventListener('input', () => { resetBtn.disabled = resetPhrase.value.trim() !== 'RESET-STORE'; });
    resetBtn.onclick = async () => {
      if (!confirm('سيُحذف كل تطبيق ولعبة وكل ملف في كلاود نهائياً. متابعة؟')) return;
      resetBtn.disabled = true;
      out.textContent = 'جارٍ التصفير…';
      try {
        const res = await api('/api/admin/store/reset', { method: 'POST', body: { confirm: 'RESET-STORE' }, timeoutMs: 300000 });
        const tables = Object.entries(res.tables || {}).map(([t, n]) => `${t}: ${n}`).join(' · ');
        out.textContent = `حُذف ${res.apps_before} عنصراً · ملفات: ${res.files.deleted}/${res.files.count}\n${tables}`;
        toast('تم التصفير — المتجر فارغ وجاهز للبداية', 'success');
        load();
      } catch (e) {
        out.textContent = 'فشل التصفير: ' + ((e && e.message) || 'خطأ');
        resetBtn.disabled = false;
      }
    };

    body.innerHTML = '';
    body.append(
      el('div', { class: 'admin-page-head' },
        el('div', null,
          el('h1', { class: 'admin-page-title' }, 'كلاود R2'),
          el('p', { class: 'admin-page-sub' }, 'تحكم كامل في حاوية الملفات من هنا: عرض، رفع، فتح، حذف، ومسح كامل — بلا دخول Cloudflare.'))),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('cloud'), 'حالة الحاوية'),
        stats),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('search'), 'استعراض الملفات'),
        el('div', { class: 'row-actions' }, prefixInput, browseBtn, delSelBtn),
        el('div', { class: 'mt-md' }, listBox)),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('trash'), 'ملفات غير مستخدمة'),
        el('div', { class: 'hint' }, 'يقارن ما في كلاود بما يستخدمه المتجر فعلاً، ويعرض الملفات اليتيمة (مثل صورة مصغّرة بقيت بعد حذف فيديو) قبل حذفها.'),
        orphanBox),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('package'), '«رفعت تطبيقاً ولم يُنشر» — الفحص والإصلاح'),
        el('div', { class: 'hint' }, 'يقرأ قاعدة البيانات والحاوية معاً: هل الملفات موجودة؟ هل العنصر ظاهر في المتجر؟ وإن لم يكن، فما السبب بالضبط — مع زر «انشر الآن» للعناصر المخفية.'),
        healthBox),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('wrench'), 'التحديث والرفع والإشعارات — فحص'),
        el('div', { class: 'hint' }, 'يشغّل مسار الرفع الحقيقي (ملف صغير + APK كبير متعدد الأجزاء) ويفحص محرّك الإشعارات: هل الدفع مفعّل؟ كم جهازاً مسجّلاً؟ وهل كُتب إشعار لآخر إصدار؟'),
        doctorBox),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('trash'), 'تنظيف الحاوية — البقايا والنسخ المكرّرة'),
        el('div', { class: 'hint' }, 'يقرأ بايتات كل ملف ويقرر من قاعدة البيانات: ملف لا يشير إليه أي عنصر = بقايا (مثل apk/getting-over-it-179570037)، وملف بنفس بايتات ملف مستخدم = نسخة. لا يُحذف أبداً ملف يستخدمه الموقع.'),
        sweepBox),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('check'), 'الحاوية الجديدة — هل كل ملف موجود؟'),
        el('div', { class: 'hint' }, 'يفحص كل ملف يشير إليه الموقع (APK، أيقونة، صورة عرضية، لقطات، أغلفة فيديو) ويسأل الحاوية نفسها: هل الملف موجود؟ أي رابط ميت يُذكر بالاسم.'),
        checkBox),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('trending'), 'لماذا الثقل؟ (قياس لا تخمين)'),
        el('div', { class: 'hint' }, 'المسافة تحدد أجزاء من الثانية؛ ما يشعر به الزائر يحدده شيئان: هل يستطيع الهاتف الاحتفاظ بالصور، وكم قفزة شبكة تحتاج الصفحة. اضغط الزر واقرأ الأرقام.'),
        diagBox),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('grid'), 'ملفات كل عنصر (مستقل عن D1)'),
        el('div', { class: 'hint' }, 'يعرض كل تطبيق/لعبة وملفاته في كلاود مجمّعة، ويكشف الملفات التي تحمل اسم عنصر ولا تنتمي إليه. المجلدات بالنوع (apk, icon, feature, ss, vthumb) وداخل كل مجلد اسم العنصر نفسه.'),
        itemsBox),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('database'), 'من أين جاء حجم التخزين'),
        el('div', { class: 'hint' }, 'يفحص الحاوية فعلياً: كم ملفاً، وكم منها مستخدم، وكم أجزاء رفع انقطعت قبل نهايته (كلاود يحسبها في «Bucket Size» ولا تظهر بين الملفات).'),
        accountBox),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('grid'), 'ترتيب التخزين'),
        el('div', { class: 'hint' }, 'يعيد تسمية الملفات إلى «مجلد/اسم-التطبيق.امتداد» ويحدّث كل رابط في قاعدة البيانات. الملفات غير المستخدمة لا تُلمس.'),
        organiseBox),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('upload'), 'رفع ملف'),
        el('div', { class: 'row-actions' }, upKey, upFile, upBtn),
        el('div', { class: 'hint mt-md' }, out)),
      el('div', { class: 'panel', style: { borderColor: 'var(--danger)' } },
        el('div', { class: 'panel-head', style: { borderColor: 'var(--danger)' } }, ico('trash'), 'منطقة الخطر'),
        el('div', { class: 'field' }, el('label', null, 'مسح كل ملفات كلاود (اكتب DELETE-ALL)'), el('div', { class: 'row-actions' }, wipePhrase, wipeBtn)),
        el('div', { class: 'field' }, el('label', null, 'تصفير المتجر: حذف كل التطبيقات والألعاب وملفاتها (اكتب RESET-STORE)'), el('div', { class: 'row-actions' }, resetPhrase, resetBtn))),
    );
    await load();
  }

  /* ===================== تنظيف كلاود =====================
     The owner could see files in the Cloudflare console that no longer existed
     in the dashboard. This panel compares the bucket with the database and
     removes what is left: orphan files, duplicate rows for the same package,
     and reports rows whose file is missing (a broken download).
     Every action starts as a DRY RUN and lists exactly what it would remove. */
  async function renderStorageCleanup(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    const panel = (title, icon) => el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, ico(icon, 'icon'), title));
    const out = el('div', { style: { fontSize: '13px', lineHeight: '1.7', whiteSpace: 'pre-wrap' } });

    const auditBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' },
      ico('search'), 'فحص كلاود (بدون حذف)');
    const dupBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' },
      ico('copy'), 'التكرارات (بدون حذف)');
    const missingBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' },
      ico('eye'), 'ملفات مفقودة');

    const run = async (btn, payload, render) => {
      btn.disabled = true;
      out.textContent = 'جارٍ الفحص…';
      try {
        const res = await api('/api/admin/cleanup', { method: 'POST', body: { dry_run: true, ...payload }, timeoutMs: 120000 });
        out.textContent = '';
        out.append(render(res));
      } catch (e) {
        out.textContent = 'تعذّر الفحص: ' + ((e && e.message) || 'خطأ');
      } finally { btn.disabled = false; }
    };

    auditBtn.onclick = () => run(auditBtn, { orphans: true }, (res) => {
      const o = res.orphans || {};
      const wrap = el('div', null);
      wrap.append(el('div', null, `الملفات في كلاود: ${formatNum(o.scanned || 0)} · لا تشير إليها أي قاعدة بيانات: ${formatNum(o.count || 0)} · الحجم: ${formatBytes(o.bytes || 0)}`));
      if (o.count) {
        wrap.append(el('div', { class: 'hint', style: { marginTop: '8px' } }, (o.keys || []).join('\n')));
        const del = el('button', { class: 'btn btn-danger btn-sm mt-md', type: 'button' }, ico('trash'), 'حذف هذه الملفات من كلاود');
        del.onclick = async () => {
          if (!confirm(`حذف ${o.count} ملفاً من كلاود نهائياً؟`)) return;
          del.disabled = true;
          try {
            const r2 = await api('/api/admin/cleanup', { method: 'POST', body: { dry_run: false, orphans: true }, timeoutMs: 120000 });
            toast(`أُزيل ${r2.orphans.deleted || 0} ملفاً` + ((r2.orphans.failed) ? ` — تعذّر ${r2.orphans.failed}` : ''), 'success');
            renderStorageCleanup(body);
          } catch (e) { toast('فشل الحذف', 'error'); del.disabled = false; }
        };
        wrap.append(del);
      } else {
        wrap.append(el('div', { class: 'hint' }, 'كلاود نظيف — لا ملفات يتيمة.'));
      }
      return wrap;
    });

    dupBtn.onclick = async () => {
      dupBtn.disabled = true; out.textContent = 'جارٍ الفحص…';
      try {
        const res = await api('/api/admin/duplicates', { timeoutMs: 60000 });
        out.textContent = '';
        const wrap = el('div', null,
          el('div', null, `مجموعات مكرّرة: ${formatNum(res.groups || 0)} · مساحة مهدورة: ${formatBytes(res.wasted_bytes || 0)}`));
        if (!res.groups) {
          wrap.append(el('div', { class: 'hint' }, 'لا تكرارات — كل اسم حزمة يظهر مرة واحدة.'));
        } else {
          const keepSel = el('select', { class: 'input', 'aria-label': t('نسخة يجب الإبقاء عليها') },
            el('option', { value: 'oldest' }, 'أبقِ الأقدم (الأصلي)'),
            el('option', { value: 'newest' }, 'أبقِ الأحدث'),
            el('option', { value: 'downloads' }, 'أبقِ الأكثر تنزيلاً'));
          (res.duplicates || []).forEach((g) => {
            wrap.append(el('div', { class: 'mt-md' },
              el('strong', null, g.package_name || '—'), ` — ${g.count} نسخة، يُقترح الإبقاء على «${g.keep_suggestion}»`,
              el('div', { class: 'hint' }, g.items.map((i) => `${i.slug} (${formatBytes(i.size_bytes)})`).join(' · '))));
          });
          const del = el('button', { class: 'btn btn-danger btn-sm mt-md', type: 'button' }, ico('trash'), 'حذف النسخ الزائدة');
          del.onclick = async () => {
            if (!confirm('حذف النسخ الزائدة وملفاتها من كلاود؟')) return;
            del.disabled = true;
            try {
              const r2 = await api('/api/admin/cleanup', { method: 'POST', body: { dry_run: false, duplicates: 'delete', keep: keepSel.value }, timeoutMs: 180000 });
              toast(`نُظّفت ${(r2.duplicates && r2.duplicates.groups) || 0} مجموعة`, 'success');
              renderStorageCleanup(body);
            } catch (e) { toast('فشل التنظيف', 'error'); del.disabled = false; }
          };
          wrap.append(keepSel, del);
        }
        out.append(wrap);
      } catch (e) {
        out.textContent = 'تعذّر الفحص: ' + ((e && e.message) || 'خطأ');
      } finally { dupBtn.disabled = false; }
    };

    missingBtn.onclick = () => run(missingBtn, { missing: true }, (res) => {
      const m = res.missing || {};
      const wrap = el('div', null, el('div', null, `عناصر بلا ملف: ${formatNum(m.count || 0)}`));
      (m.items || []).forEach((i) => wrap.append(el('div', { class: 'hint' }, `${i.slug} — ${i.reason === 'no_apk_key' ? 'لا يوجد ملف APK' : 'الملف غير موجود في كلاود'}`)));
      return wrap;
    });

    /* ---- مسح كامل للحاوية ----
       Some owners reach a point where the bucket is a mix of everything
       (dozens of APKs per item, files of products that no longer exist) and the
       only sane move is to start from zero. This card counts first, shows the
       per-folder breakdown and how many products lose their file, and demands a
       typed confirmation — never a single stray tap. */
    const wipeOut = el('div', { style: { fontSize: '13px', lineHeight: '1.7', whiteSpace: 'pre-wrap' } });
    const countBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' },
      ico('search'), 'عدّ كل الملفات');
    const wipeInput = el('input', { class: 'input', type: 'text', placeholder: 'اكتب DELETE-ALL للتأكيد', 'aria-label': 'DELETE-ALL' });
    const wipeBtn = el('button', { class: 'btn btn-danger btn-sm', type: 'button', disabled: true },
      ico('trash'), 'احذف كل الملفات من كلاود');
    let counted = null;

    const renderWipe = (w) => {
      const rows = Object.entries(w.by_folder || {}).map(([f, v]) =>
        `${f} — ${formatNum(v.count)} ملف (${formatBytes(v.bytes)})`);
      return [
        `إجمالي الملفات في كلاود: ${formatNum(w.count || 0)} · الحجم: ${formatBytes(w.bytes || 0)}`,
        ...rows,
        w.apps_with_apk ? `تنبيه: ${formatNum(w.apps_with_apk)} عنصر في المتجر ملفه داخل كلاود — بعد المسح يجب رفع ملفاته من جديد.` : '',
      ].filter(Boolean).join('\n');
    };

    countBtn.onclick = async () => {
      countBtn.disabled = true;
      wipeOut.textContent = 'جارٍ العدّ…';
      try {
        const res = await api('/api/admin/cleanup', { method: 'POST', body: { dry_run: true, mode: 'all' }, timeoutMs: 180000 });
        counted = res.wipe || null;
        wipeOut.textContent = renderWipe(counted || {});
        wipeBtn.disabled = !(counted && counted.count);
      } catch (e) {
        wipeOut.textContent = 'تعذّر العدّ: ' + ((e && e.message) || 'خطأ');
      } finally { countBtn.disabled = false; }
    };

    wipeInput.addEventListener('input', () => {
      wipeBtn.disabled = wipeInput.value.trim() !== 'DELETE-ALL' || !(counted && counted.count);
    });

    wipeBtn.onclick = async () => {
      if (wipeInput.value.trim() !== 'DELETE-ALL') return;
      if (!confirm(`حذف ${formatNum(counted.count)} ملفاً من كلاود نهائياً؟ لا يمكن الرجوع.`)) return;
      wipeBtn.disabled = true;
      wipeOut.textContent = 'جارٍ المسح… قد يستغرق دقيقة.';
      try {
        const res = await api('/api/admin/cleanup', {
          method: 'POST',
          body: { dry_run: false, mode: 'all', confirm: 'DELETE-ALL', force: true },
          timeoutMs: 180000,
        });
        const w = res.wipe || {};
        wipeOut.textContent = `تم المسح: ${formatNum(w.deleted || 0)} / ${formatNum(w.count || 0)} ملف`
          + (w.failed ? `\nتعذّر حذف ${formatNum(w.failed)}: ${(w.failed_keys || []).join(', ')}` : '')
          + '\n\nالخطوة التالية: افتح كل عنصر وأعد رفع ملف APK + الأيقونة + الصور، أو احذف العناصر التي لا تريدها ثم أعد نشرها.';
        toast(`تم حذف ${formatNum(w.deleted || 0)} ملف من كلاود`, 'success');
      } catch (e) {
        wipeOut.textContent = 'فشل المسح: ' + ((e && e.message) || 'خطأ');
        wipeBtn.disabled = false;
      }
    };

    body.innerHTML = '';
    body.append(
      el('div', { class: 'panel', style: { borderColor: 'var(--danger)' } },
        el('div', { class: 'panel-head', style: { borderColor: 'var(--danger)' } }, ico('trash'), 'مسح كامل لكلاود'),
        el('p', { class: 'muted', style: { fontSize: '13px' } },
          'يحذف كل ملف في الحاوية (APK وأيقونات وصور ومصغّرات) ويعيدها فارغة. عدّ أولاً، ثم اكتب DELETE-ALL.'),
        countBtn, wipeInput, wipeBtn,
        el('div', { class: 'mt-md' }, wipeOut)),
      el('div', { class: 'admin-page-head' },
        el('div', null,
          el('h1', { class: 'admin-page-title' }, 'تنظيف كلاود'),
          el('p', { class: 'admin-page-sub' }, 'يقارن حاوية R2 بقاعدة البيانات: ملفات يتيمة بعد الحذف، نسخ مكرّرة، وعناصر بلا ملف.'))),
      el('div', { class: 'panel' },
        el('div', { class: 'row-actions' }, auditBtn, dupBtn, missingBtn)),
      el('div', { class: 'panel' }, out),
    );
  }

  async function renderBackup(body) {
    body.innerHTML = '';
    const file = el('input', { type: 'file', accept: 'application/json,.json', class: 'input',
      'aria-label': t('اختر ملف JSON') });
    const result = el('div', { class: 'hint' });

    const exportBtn = el('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      try {
        const data = await api('/api/admin/backup');
        saveBlob(`goldenstore-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
        logAdminAction('تصدير نسخة احتياطية');
        toast('تم التصدير', 'success');
      } catch (e) { toast('فشل التصدير', 'error'); }
    } }, ico('download'), t('تصدير النسخة الاحتياطية'));

    const importBtn = el('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => {
      const f = file.files && file.files[0];
      if (!f) { toast(t('اختر ملف JSON'), 'error'); return; }
      if (!confirm('استيراد آمن بدمج فقط: لن يُحذف أو يُستبدل أي صف موجود. متابعة؟')) return;
      try {
        const data = JSON.parse(await f.text());
        const r = await api('/api/admin/import', { method: 'POST', body: { ...data, confirm: true } });
        logAdminAction(`استيراد نسخة احتياطية (${r.imported} صفاً)`);
        result.textContent = `تم استيراد ${r.imported} صفاً — تم تخطي ${r.apps_skipped || 0} صف تطبيقات (الملفات في R2).`;
        toast('تم الاستيراد', 'success');
      } catch (e) { toast('فشل الاستيراد', 'error'); }
    } }, t('استيراد نسخة احتياطية'));

    const exportPanel = el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, ico('download', 'icon'), t('تصدير النسخة الاحتياطية')),
      el('div', { class: 'admin-phase2-pad' },
        el('p', { class: 'hint' }, 'التطبيقات + الإصدارات + الفئات + الترتيب + النشر + الأدوار + السجل.'),
        exportBtn));

    const importPanel = el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, ico('upload', 'icon'), t('استيراد نسخة احتياطية')),
      el('div', { class: 'admin-phase2-pad' }, file, importBtn, result));

    body.append(
      phaseHead(t('النسخ الاحتياطي'), 'صدّر كل بيانات لوحة التحكم، أو استورد نسخة بدمج آمن لا يستبدل أي صف موجود.'),
      el('div', { class: 'admin-dash-grid' },
        exportPanel,
        el('div', { class: 'admin-dash-side' }, importPanel)),
      el('div', { class: 'hint' }, 'الاستيراد يدمج البيانات الوصفية فقط (INSERT OR IGNORE). ملفات APK والصور تبقى في R2 وتُعاد عبر نموذج النشر المعتاد.'),
    );
  }

  async function renderQuality(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    let apps = [];
    try { apps = (await api('/api/admin/apps')).apps || []; } catch (e) {}
    const qa = qaSummary(apps);
    const issues = apps.map((a) => ({ app: a, tags: qaIssues(a) })).filter((x) => x.tags.length);
    body.innerHTML = '';
    const stat = (value, label, warn) => el('div', { class: 'admin-quality-stat' + (warn ? ' is-warn' : '') },
      el('b', null, formatNum(value)), el('span', null, label));
    body.append(
      phaseHead(t('فحص الجودة'), 'يكتشف العناصر الناقصة قبل أن يراها المستخدمون: الأيقونة، APK، الوصف، الفئة، الإصدار، المطوّر.',
        el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => goTab('apps') },
          ico('apps', 'icon'), 'التطبيقات')),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('shield', 'icon'), t('فحص الجودة')),
        el('div', { class: 'admin-quality-grid' },
          stat(apps.length, t('إجمالي التطبيقات')),
          stat(qa.withIssues, t('عناصر تحتاج انتباهاً'), qa.withIssues > 0),
          stat(qa.noIcon, t('أيقونة مفقودة'), qa.noIcon > 0),
          stat(qa.noApk, t('ملف APK مفقود'), qa.noApk > 0),
          stat(qa.noDesc, t('وصف مفقود'), qa.noDesc > 0),
          stat(qa.total, t('الإجراء')))),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('flag', 'icon'), t('عناصر تحتاج انتباهاً')),
        issues.length ? el('div', { class: 'admin-phase2-list' }, ...issues.map((x) =>
          el('div', { class: 'admin-quality-issue' },
            el('strong', null, x.app.name || x.app.slug),
            el('span', { class: 'admin-qa-tags' }, ...x.tags.map((t2) => el('span', { class: 'admin-qa-tag' }, t2))),
            el('button', { class: 'btn btn-sm btn-secondary', type: 'button',
              onclick: () => goTab(`edit:${x.app.id}`) }, ico('edit', 'icon'), t('معاينة')))))
          : el('div', { class: 'hint' }, t('لا توجد مشاكل'))),
    );
  }

  async function renderDevicePreview(body) {
    body.innerHTML = '';
    const devices = [
      { label: t('معاينة الهاتف'), sub: '390 × 844', w: 390, h: 844, icon: 'phone' },
      { label: t('معاينة الجهاز اللوحي'), sub: '820 × 1180', w: 820, h: 1180, icon: 'grid' },
      { label: t('معاينة الحاسوب'), sub: '1440 × 900', w: 1440, h: 900, icon: 'dashboard' },
    ];
    const openDevice = (d) => {
      // Clamp to the real screen so a 1440px "desktop" window is never larger
      // than the monitor (browsers silently clamp and the preview looked wrong).
      let w = d.w, h = d.h;
      try {
        const sw = (window.screen && window.screen.availWidth) || d.w;
        const sh = (window.screen && window.screen.availHeight) || d.h;
        w = Math.min(d.w, Math.max(320, sw - 20));
        h = Math.min(d.h, Math.max(480, sh - 20));
      } catch (e) {}
      const features = `width=${w},height=${h},resizable=yes,scrollbars=yes`;
      // NOTE: `noopener` in the feature string makes window.open() return null
      // by spec, which used to trigger a FALSE "popup blocked" error toast.
      const win = window.open(`/?device=${d.w}`, `gs_preview_${d.w}`, features);
      if (win) {
        try { win.opener = null; } catch (e) {}   // keep the security benefit
        setTimeout(() => { try { win.resizeTo(w, h); win.focus(); } catch (e) {} }, 250);
      } else {
        toast(t('اسمح بالنوافذ المنبثقة'), 'error');
      }
      logAdminAction(`${d.label} (${d.sub})`);
    };
    const card = (d) => el('button', { class: 'admin-device-btn', type: 'button',
      title: t('فتح المتجر بحجم الجهاز'), onclick: () => openDevice(d) },
      ico(d.icon, 'icon'), el('b', null, d.label), el('span', null, d.sub));
    body.append(
      phaseHead(t('معاينة الأجهزة'), 'افتح المتجر في نافذة بأبعاد هاتف أو جهاز لوحي أو حاسوب للتحقق من التجاوبية مباشرة.'),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('external', 'icon'), t('معاينة الأجهزة')),
        el('div', { class: 'admin-device-grid' }, ...devices.map(card))),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('shield', 'icon'), t('صحة الخدمات')),
        el('div', { class: 'admin-phase2-pad' },
          el('div', { class: 'hint' }, 'لوحة التحكم نفسها تتكيف مع ثلاثة أحجام: شريط جانبي على الحاسوب، شريط جانبي مصغّر على الجهاز اللوحي، وشريط تبويبات أفقي قابل للسحب على الهاتف.'),
          el('div', { class: 'hint' }, 'نافذة التحديث الأسطورية تحدّ من ارتفاعها تلقائياً على الشاشات القصيرة، وتصبح قابلة للتمرير بدل أن تُقصّ أزرارها.'))),
    );
  }

  /* ---------- Advanced insights: real aggregates, honest demographics ---------- */
  function insightBar(label, value, max, color) {
    const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
    return el('div', { class: 'ins-bar-row' },
      el('span', { class: 'ins-bar-label' }, label),
      el('span', { class: 'ins-bar-track' },
        el('i', { style: { width: `${pct}%`, background: color || 'var(--gold)' } })),
      el('b', { class: 'ins-bar-value' }, formatNum(value)));
  }
  function insightPanel(title, iconName, ...kids) {
    return el('div', { class: 'panel ins-panel' },
      el('div', { class: 'panel-head' }, ico(iconName, 'icon'), title), ...kids);
  }
  function insightKpi(label, value, sub) {
    return el('div', { class: 'admin-kpi' },
      el('div', { class: 'admin-kpi-top' }, el('span', { class: 'admin-kpi-label' }, label)),
      el('div', { class: 'admin-kpi-value' }, value),
      sub ? el('div', { class: 'admin-kpi-sub' }, sub) : null);
  }
  function insightLine(rows) {
    const w = 620, h = 150, pad = 12;
    const max = Math.max(1, ...rows.map((r) => Number(r.count) || 0));
    const step = rows.length > 1 ? (w - pad * 2) / (rows.length - 1) : 0;
    const pts = rows.map((r, i) => `${pad + i * step},${h - pad - ((Number(r.count) || 0) / max) * (h - pad * 2)}`).join(' ');
    const area = `${pad},${h - pad} ${pts} ${pad + (rows.length - 1) * step},${h - pad}`;
    const svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="150" role="img" aria-label="منحنى التنزيلات">
      <defs><linearGradient id="insFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f4c01f" stop-opacity=".35"/>
        <stop offset="100%" stop-color="#f4c01f" stop-opacity="0"/></linearGradient></defs>
      <polygon points="${area}" fill="url(#insFill)"/>
      <polyline points="${pts}" fill="none" stroke="#f4c01f" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
    const box = el('div', { class: 'ins-line' });
    box.innerHTML = svg;
    return box;
  }
  function insightDonut(rows, total) {
    const colors = ['#f4c01f', '#4c9ffe', '#a78bfa', '#8a8d91'];
    const r = 42, c = 2 * Math.PI * r;
    let offset = 0;
    const circles = rows.map((x, i) => {
      const frac = total > 0 ? (Number(x.count) || 0) / total : 0;
      const len = frac * c;
      const part = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="16"
        stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"/>`;
      offset += len;
      return part;
    }).join('');
    const box = el('div', { class: 'ins-donut' });
    box.innerHTML = `<svg viewBox="0 0 120 120" width="130" height="130" role="img" aria-label="توزيع الجنس">
      <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="16"/>${circles}
      <text x="60" y="65" text-anchor="middle" fill="var(--text)" font-size="17" font-weight="800">${total}</text></svg>`;
    return box;
  }

  async function renderInsights(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    let days = 30;
    let data = null;
    async function load() {
      try { data = await api(`/api/admin/analytics/insights?days=${days}`); } catch (e) { data = null; }
    }
    await load();
    if (!data) { body.innerHTML = ''; body.append(emptyMsg('تعذّر تحميل الإحصائيات', 'تحقق من الاتصال ثم أعد المحاولة.')); return; }
    const rangeSel = el('select', { class: 'input', 'aria-label': t('الفترة'), onchange: () => {
      days = Number(rangeSel.value) || 30; renderInsights(body);
    } }, el('option', { value: '7' }, '7 ' + t('أيام')),
      el('option', { value: '30' }, '30 ' + t('أيام')),
      el('option', { value: '90' }, '90 ' + t('أيام')));
    rangeSel.value = String(days);
    const exportBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => {
      const lines = ['metric,key,value'];
      data.daily_downloads.forEach((r) => lines.push(`daily,${r.day},${r.count}`));
      data.hourly.forEach((r) => lines.push(`hourly,${r.hour},${r.count}`));
      data.categories.forEach((r) => lines.push(`category,${r.key},${r.count}`));
      data.rating_distribution.forEach((r) => lines.push(`rating,${r.key},${r.count}`));
      data.demographics.age.forEach((r) => lines.push(`age,${r.key},${r.count}`));
      data.demographics.gender.forEach((r) => lines.push(`gender,${r.key},${r.count}`));
      const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: 'goldenstore-insights.csv' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      logAdminAction(t('تصدير الإحصائيات'));
    } }, ico('download'), t('تصدير الإحصائيات'));
    const refreshBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button',
      onclick: () => renderInsights(body) }, ico('refresh'), t('تحديث'));

    const t0 = data.totals || {};
    const kpis = el('div', { class: 'admin-kpi-grid' },
      insightKpi(t('إجمالي التطبيقات'), formatNum(t0.apps || 0)),
      insightKpi(t('الألعاب'), formatNum(t0.games || 0)),
      insightKpi(t('إجمالي التنزيلات'), formatNum(t0.downloads || 0)),
      insightKpi(t('متوسط التقييم'), formatNum(t0.avg_rating || 0)),
      insightKpi(t('التقييمات'), formatNum(t0.reviews || 0)),
      insightKpi(t('الأجهزة المسجّلة'), formatNum(t0.devices || 0)),
      insightKpi(t('حجم التخزين'), formatBytes(t0.storage_bytes || 0)),
      insightKpi(t('أحدث الإضافات'), formatNum(t0.new_apps_30d || 0)));

    // ---- Demographics: OPT-IN only, never fabricated ----
    const dem = data.demographics || {};
    const ageLabels = { '13-17': '13–17', '18-24': '18–24', '25-34': '25–34', '35-44': '35–44', '45-54': '45–54', '55+': '55+' };
    const genderLabels = { male: t('ذكر'), female: t('أنثى'), other: t('آخر'), prefer_not: t('أفضّل عدم التحديد') };
    const ageMax = Math.max(1, ...(dem.age || []).map((r) => Number(r.count) || 0));
    const demoPanel = insightPanel(t('السن والجنس'), 'user',
      dem.enabled === false
        ? el('div', { class: 'ins-empty' }, ico('shield', 'icon'),
            el('strong', null, t('جمع البيانات الديموغرافية معطّل')),
            el('span', null, t('فعّله من إعدادات المتجر ← الخصوصية والبيانات، ثم سيملأ المستخدمون بياناتهم اختيارياً.')))
        : dem.data_available === false
          ? el('div', { class: 'ins-empty' }, ico('user', 'icon'),
              el('strong', null, t('لا توجد بيانات ديموغرافية بعد')),
              el('span', null, t('البيانات اختيارية ومجهولة؛ لا نعرض أرقاماً تقديرية أبداً.')))
          : null,
      el('div', { class: 'ins-demo-grid' },
        el('div', null, el('h3', null, t('الفئات العمرية')),
          (dem.age || []).map((r) => insightBar(ageLabels[r.key] || r.key, Number(r.count) || 0, ageMax, '#f4c01f'))),
        el('div', null, el('h3', null, t('الجنس')),
          el('div', { class: 'ins-gender' }, insightDonut(dem.gender || [], Number(dem.total) || 0),
            el('div', { class: 'ins-legend' }, ...(dem.gender || []).map((r, i) =>
              el('div', null, el('i', { style: { background: ['#f4c01f','#4c9ffe','#a78bfa','#8a8d91'][i % 4] } }),
                genderLabels[r.key] || r.key, ' · ', formatNum(r.count) || '0')))))),
      el('div', { class: 'ins-countries' }, el('h3', null, t('الدول')),
        ...((dem.countries || []).length
          ? (dem.countries || []).map((r) => el('span', { class: 'admin-qa-tag' }, `${r.key} · ${formatNum(r.count)}`))
          : [el('span', { class: 'hint' }, t('لا توجد بيانات بعد'))])),
      el('div', { class: 'hint' }, `${t('المشاركون')}: ${formatNum(dem.total || 0)} — ${t('بيانات اختيارية مجهولة')}`));

    const dailyMax = Math.max(1, ...(data.daily_downloads || []).map((r) => Number(r.count) || 0));
    const hourMax = Math.max(1, ...(data.hourly || []).map((r) => Number(r.count) || 0));
    const catMax = Math.max(1, ...(data.categories || []).map((r) => Number(r.count) || 0));
    const rateMax = Math.max(1, ...(data.rating_distribution || []).map((r) => Number(r.count) || 0));
    const topTable = el('table', { class: 'table' },
      el('thead', null, el('tr', null, el('th', null, t('الاسم')), el('th', null, t('النوع')), el('th', null, t('التنزيلات')))),
      el('tbody', null, ...(data.top_apps || []).map((a) => el('tr', null,
        el('td', null, a.name || a.slug), el('td', null, a.type === 'game' ? t('لعبة') : t('تطبيق')),
        el('td', null, formatNum(a.downloads || 0))))));

    body.innerHTML = '';
    body.append(
      phaseHead(t('إحصائيات متقدمة'), 'كل الأرقام من قاعدة البيانات الفعلية؛ لا توجد قيم تقديرية أو مُختلقة.', exportBtn),
      el('div', { class: 'admin-settings-toolbar' }, rangeSel, refreshBtn,
        el('span', { class: 'hint' }, `${t('آخر تحديث')}: ${data.generated_at ? formatDate(data.generated_at) : '—'}`)),
      kpis,
      demoPanel,
      el('div', { class: 'admin-dash-grid' },
        insightPanel(t('التنزيلات اليومية'), 'trending', insightLine(data.daily_downloads || []),
          el('div', { class: 'hint' }, `${t('الذروة')}: ${formatNum(dailyMax)} / ${t('يوم')}`)),
        insightPanel(t('توزيع حسب الساعة'), 'clock',
          el('div', { class: 'ins-heatmap' }, ...(data.hourly || []).map((r) =>
            el('span', { class: 'ins-heat', title: `${r.hour}:00 · ${r.count}`,
              style: { opacity: String(0.18 + 0.82 * ((Number(r.count) || 0) / hourMax)) } }, String(r.hour)))))),
      el('div', { class: 'admin-dash-grid' },
        insightPanel(t('الفئات'), 'grid', ...(data.categories || []).map((r) =>
          insightBar(r.key, Number(r.count) || 0, catMax, '#4c9ffe'))),
        insightPanel(t('توزيع التقييمات'), 'star', ...(data.rating_distribution || []).map((r) =>
          insightBar(`${r.key} ★`, Number(r.count) || 0, rateMax, '#f4c01f')))),
      el('div', { class: 'admin-dash-grid' },
        insightPanel(t('الأكثر تنزيلاً'), 'apps', el('div', { class: 'table-wrap' }, topTable)),
        insightPanel(t('المنصات'), 'phone',
          insightBar(t('أندرويد'), Number((data.platforms || {}).android) || 0, Math.max(1, (data.platforms || {}).android || 0), '#4caf50'),
          insightBar(t('iOS'), Number((data.platforms || {}).ios) || 0, Math.max(1, (data.platforms || {}).android || 0), '#a78bfa'),
          insightBar(t('الويب'), Number((data.platforms || {}).web) || 0, Math.max(1, (data.platforms || {}).android || 0), '#4c9ffe'),
          el('div', { class: 'hint' }, `${t('التطبيقات')}: ${formatNum((data.types || {}).app?.count || 0)} · ${t('الألعاب')}: ${formatNum((data.types || {}).game?.count || 0)}`))),
      el('div', { class: 'admin-dash-grid' },
        insightPanel(t('سجل الإصدارات'), 'download',
          (data.releases || []).length ? el('div', { class: 'admin-phase2-list' }, ...(data.releases || []).map((r) =>
            el('div', { class: 'admin-phase2-row' }, el('strong', null, r.version_name || '—'),
              el('span', { class: 'admin-order-meta' }, r.created_at ? formatDate(r.created_at) : '—'))))
            : el('div', { class: 'hint' }, t('لا توجد بيانات بعد'))),
        insightPanel(t('آخر النشاطات'), 'clock',
          (data.activity || []).length ? el('div', { class: 'admin-phase2-list' }, ...(data.activity || []).map((r) =>
            el('div', { class: 'admin-phase2-row' }, el('strong', null, r.action || '—'))))
            : el('div', { class: 'hint' }, t('لا نشاطات بعد')))),
    );
  }

  function notificationCard(n, refreshList) {
    const type = n.type === 'new_app' || n.type === 'update' || n.type === 'announcement' ? n.type : 'announcement';
    const badgeLabel = type === 'new_app' ? 'تطبيق جديد' : type === 'update' ? 'تحديث' : 'إعلان';
    const card = el('div', { class: 'notif-card' });
    const delBtn = el('button', {
      class: 'btn btn-sm btn-secondary',
      type: 'button',
      onclick: async () => {
        delBtn.disabled = true;
        try {
          await api(`/api/admin/notifications/${n.id}`, { method: 'DELETE' });
          toast('تم الحذف', 'success');
            if (refreshList) {
              await refreshList();
            } else {
              card.remove();
            }
        } catch {
          delBtn.disabled = false;
          toast('تعذر الحذف', 'error');
        }
      },
    }, ico('trash'), 'حذف');

    card.append(
      el('div', { class: 'notif-top' },
        el('span', { class: `notif-badge ${type}` }, badgeLabel),
        el('strong', null, n.title || ''),
        el('span', { class: 'tab-spacer' }),
        el('span', { class: 'notif-meta' }, formatDate(n.created_at)),
        delBtn,
      ),
      n.body ? el('div', { class: 'notif-body' }, n.body) : null,
    );
    return card;
  }

  function requestCard(r, body) {
    const isUpdate = r.type === 'update';
    const isPublish = r.type === 'publish';
    const card = el('div', { class: 'req-card' + (isPublish ? ' req-card-publish' : '') });
    const dismissBtn = el('button', { class: 'btn btn-sm btn-secondary', onclick: async () => {
      dismissBtn.disabled = true;
      try { await api(`/api/admin/requests/${r.id}`, { method: 'DELETE' }); card.remove(); toast('تم الحذف', 'success'); }
      catch { dismissBtn.disabled = false; toast('تعذّر الحذف', 'error'); }
    } }, ico('trash'), 'حذف');

    card.append(
      el('div', { class: 'req-top' },
        el('span', { class: `req-badge ${isPublish ? 'publish' : isUpdate ? 'update' : 'report'}` },
          isPublish ? 'طلب نشر' : isUpdate ? 'طلب تحديث' : 'بلاغ'),
        el('strong', null, r.app_name || r.slug || (isPublish ? 'طلب نشر' : '—')),
        el('span', { class: 'tab-spacer' }),
        r.slug ? el('a', { class: 'btn btn-sm btn-secondary', href: `/app?slug=${encodeURIComponent(r.slug)}`, target: '_blank' }, ico('external'), 'عرض') : null,
        dismissBtn,
      ),
      el('div', { class: 'req-meta' }, r.ts ? formatDate(r.ts) : ''),
    );

    if (isPublish) {
      card.append(el('div', { class: 'req-detail' }, r.details || ''));
      return card;
    }
    if (isUpdate) {
      card.append(el('div', { class: 'req-detail' }, `الإصدار الحالي: ${r.current_version || '—'} ← الإصدار المطلوب: ${r.new_version || '—'}`));
      if (r.source) card.append(el('div', { class: 'req-detail' }, 'المصدر: ', el('a', { href: r.source, target: '_blank', rel: 'noopener' }, r.source)));
    } else {
      card.append(el('div', { class: 'req-detail' }, `السبب: ${r.reason || '—'}`));
      if (r.details) card.append(el('div', { class: 'req-detail' }, r.details));
    }
    return card;
  }

  // -------- apps list --------

  /* ---------------- Users directory: search + pagination ---------------- */
  async function renderUsers(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    let payload = { users: [], total: 0, note: '' };
    try { payload = await api('/api/admin/users?limit=1000'); } catch (e) {}
    const all = Array.isArray(payload.users) ? payload.users : [];
    const state = { q: '', page: 1, pageSize: 10, sort: 'recent' };
    body.innerHTML = '';

    const countEl = el('span', { class: 'admin-table-count' });
    const searchInput = el('input', {
      class: 'input admin-table-search', type: 'search',
      placeholder: t('ابحث بالمعرّف أو المصدر أو القناة'),
      'aria-label': t('بحث في المستخدمين'),
    });
    const sortSel = el('select', { class: 'input admin-table-filter', 'aria-label': t('فرز حسب') },
      el('option', { value: 'recent' }, t('الأحدث نشاطاً')),
      el('option', { value: 'devices' }, t('الأكثر أجهزة')),
      el('option', { value: 'uid' }, t('المعرّف')));
    const tableWrap = el('div', { class: 'table-wrap' });

    function visible() {
      const q = state.q.trim().toLowerCase();
      const list = all.filter((u) => {
        if (!q) return true;
        return [u.uid, u.uid_masked, (u.sources || []).join(' '), (u.channels || []).join(' ')]
          .some((v) => String(v || '').toLowerCase().includes(q));
      });
      list.sort((a, b) => {
        if (state.sort === 'devices') return Number(b.devices || 0) - Number(a.devices || 0);
        if (state.sort === 'uid') return String(a.uid || '').localeCompare(String(b.uid || ''));
        return Number(b.last_seen_at || 0) - Number(a.last_seen_at || 0);
      });
      return list;
    }
    function renderTable() {
      const list = visible();
      const pages = Math.max(1, Math.ceil(list.length / state.pageSize));
      state.page = Math.min(state.page, pages);
      const slice = list.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
      countEl.textContent = `${list.length} / ${all.length} ${t('مستخدم')}`;
      tableWrap.innerHTML = '';
      if (!slice.length) {
        tableWrap.append(emptyMsg(t('لا توجد نتائج'), t('غيّر عبارة البحث.')));
        return;
      }
      const headRow = el('tr', null,
        el('th', null, t('المعرّف')), el('th', null, t('الأجهزة')),
        el('th', null, t('القنوات')), el('th', null, t('المصادر')),
        el('th', null, t('آخر نشاط')));
      const bodyRows = slice.map((u) => el('tr', null,
        el('td', { 'data-label': t('المعرّف') }, el('code', { class: 'admin-uid' }, u.uid_masked || u.uid)),
        el('td', { 'data-label': t('الأجهزة') }, formatNum(u.devices || 0)),
        el('td', { 'data-label': t('القنوات') }, (u.channels || []).join(' / ') || '—'),
        el('td', { 'data-label': t('المصادر') }, (u.sources || []).join(' / ') || '—'),
        el('td', { 'data-label': t('آخر نشاط') }, u.last_seen_at ? formatDate(u.last_seen_at) : '—')));
      const table = el('table', { class: 'table admin-table admin-users-table' },
        el('thead', null, headRow), el('tbody', null, ...bodyRows));
      tableWrap.append(table);
      tableWrap.append(pager(list.length, state.page, state.pageSize, (p) => {
        state.page = p; renderTable();
      }));
    }
    searchInput.addEventListener('input', () => { state.q = searchInput.value; state.page = 1; renderTable(); });
    sortSel.addEventListener('change', () => { state.sort = sortSel.value; state.page = 1; renderTable(); });

    body.append(
      el('div', { class: 'admin-page-head' },
        el('div', null,
          el('h1', { class: 'admin-page-title' }, t('المستخدمون')),
          el('p', { class: 'admin-page-sub' },
            t('معرفات حقيقية من سجل الأجهزة والتقييمات والدعم — بحث وترقيم صفحات، بلا بيانات مُخمّنة.'))),
        el('button', { class: 'btn btn-secondary btn-sm', type: 'button',
          onclick: () => renderUsers(body) }, ico('refresh'), t('تحديث'))),
      el('div', { class: 'admin-table-toolbar' }, searchInput, sortSel, countEl),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('users', 'icon'), t('دليل المستخدمين')),
        tableWrap),
      el('div', { class: 'hint', style: { marginTop: '10px' } }, payload.note || ''),
    );
    renderTable();
  }

  async function renderAppsList(body, kind) {
    kind = kind === 'game' ? 'game' : 'app';
    const isGame = (a) => a.type === 'game';
    const noun = kind === 'game' ? 'لعبة' : 'تطبيق';
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    try {
      const { apps: allApps } = await api('/api/admin/apps');
      const apps = allApps.filter((a) => kind === 'game' ? isGame(a) : !isGame(a));
      body.innerHTML = '';
      const state = { q: '', cat: '', sort: 'downloads', page: 1, pageSize: 12, selected: new Set() };

      const countEl = el('span', { class: 'admin-table-count' });
      const searchInput = el('input', {
        class: 'input admin-table-search', type: 'search',
        placeholder: t('ابحث في الأقسام والتطبيقات'), 'aria-label': t('بحث'),
      });
      const catSel = el('select', { class: 'input admin-table-filter', 'aria-label': t('تصفية') },
        el('option', { value: '' }, t('كل التصنيفات')),
        ...cats.map((c) => el('option', { value: c.slug }, t(c.name) || c.slug)));
      const sortSel = el('select', { class: 'input admin-table-filter', 'aria-label': t('فرز حسب') },
        el('option', { value: 'downloads' }, 'الأكثر تنزيلاً'),
        el('option', { value: 'name' }, 'الاسم'),
        el('option', { value: 'rating' }, 'الأعلى تقييماً'),
        el('option', { value: 'created' }, t('الأحدث')),
        el('option', { value: 'size' }, 'الحجم'));
      const selectAll = el('input', { type: 'checkbox', class: 'admin-check', 'aria-label': t('تحديد الكل') });
      const tableWrap = el('div', { class: 'table-wrap' });

      function visible() {
        const q = state.q.trim().toLowerCase();
        const list = apps.filter((a) => {
          if (state.cat && a.category !== state.cat) return false;
          if (!q) return true;
          return [a.name, a.package_name, a.developer, a.category, a.version_name]
            .some((v) => String(v || '').toLowerCase().includes(q));
        });
        list.sort((x, y) => {
          if (state.sort === 'name') return String(x.name || '').localeCompare(String(y.name || ''), 'ar');
          if (state.sort === 'rating') return Number(y.stars || y.rating || 0) - Number(x.stars || x.rating || 0);
          if (state.sort === 'created') return Number(y.created_at || 0) - Number(x.created_at || 0);
          if (state.sort === 'size') return Number(y.size_bytes || 0) - Number(x.size_bytes || 0);
          return Number(y.downloads || 0) - Number(x.downloads || 0);
        });
        return list;
      }
      function selection() {
        return visible().filter((a) => state.selected.has(a.id));
      }
      function updateBulk() {
        const n = state.selected.size;
        bulkBar.classList.toggle('is-visible', n > 0);
        bulkCount.textContent = `${n} ${t('محدّد')}`;
      }
      function downloadFile(name, text, type) {
        const blob = new Blob([text], { type });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: name });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      function exportRows(fmt) {
        const rows = selection().length ? selection() : visible();
        if (!rows.length) { toast(t('لا توجد نتائج'), 'error'); return; }
        const picked = rows.map((a) => ({
          id: a.id, slug: a.slug, name: a.name, package_name: a.package_name,
          type: a.type, category: a.category, version_name: a.version_name,
          size_bytes: a.size_bytes, downloads: a.downloads, created_at: a.created_at,
        }));
        if (fmt === 'json') downloadFile(`goldenstore-${kind}s.json`, JSON.stringify(picked, null, 2), 'application/json');
        else {
          const cols = Object.keys(picked[0]);
          const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
          downloadFile(`goldenstore-${kind}s.csv`,
            '\ufeff' + [cols.join(','), ...picked.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'),
            'text/csv;charset=utf-8');
        }
        logAdminAction(`تصدير ${rows.length} ${noun} بصيغة ${fmt.toUpperCase()}`);
        toast(t('تم التصدير'), 'success');
      }
      function previewApp(a) {
        const overlay = el('div', { class: 'admin-preview-overlay', role: 'dialog', 'aria-modal': 'true' });
        const card = el('div', { class: 'admin-preview-card' },
          el('div', { class: 'admin-preview-top' },
            a.icon_url ? el('img', { src: a.icon_url, alt: '' }) : el('div', { class: 'admin-preview-icon' }, ico('package', 'icon')),
            el('div', null, el('h2', null, a.name || '—'),
              el('span', null, a.package_name || '')),
            el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('إغلاق'),
              onclick: () => overlay.remove() }, ico('close'))),
          el('p', { class: 'admin-preview-desc' }, a.short_description || a.description || '—'),
          el('div', { class: 'admin-preview-meta' },
            el('span', null, t('الإصدار') + ': ' + (a.version_name || '—')),
            el('span', null, t('التنزيلات') + ': ' + formatNum(a.downloads || 0)),
            el('span', null, t('حجم التحديث') + ': ' + formatBytes(a.size_bytes || 0))),
          el('a', { class: 'btn btn-primary', href: `/app?slug=${a.slug}`, target: '_blank' },
            ico('external'), t('عرض المتجر')));
        overlay.append(card);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.append(overlay);
      }
      function duplicateApp(a) {
        try { sessionStorage.setItem('gs_admin_duplicate', JSON.stringify(a)); } catch (e) {}
        newKind = kind;
        logAdminAction(`تكرار «${a.name}»`);
        goTab('new');
      }
      async function bulkDelete() {
        const rows = selection();
        if (!rows.length) return;
        if (!confirm(`حذف ${rows.length} ${noun} نهائياً؟`)) return;
        let done = 0;
        for (const a of rows) {
          try { await api(`/api/admin/apps/${a.id}`, { method: 'DELETE' }); done++; } catch (e) {}
        }
        logAdminAction(`حذف جماعي: ${done} ${noun}`);
        toast(`تم حذف ${done} / ${rows.length}`, 'success');
        renderApp();
      }
      function renderTable() {
        const filtered = visible();
        const pages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
        state.page = Math.min(state.page, pages);
        const list = filtered.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
        countEl.textContent = `${filtered.length} / ${apps.length} • ${t('صفحة')} ${state.page}/${pages}`;
        tableWrap.innerHTML = '';
        if (!list.length) { tableWrap.append(emptyMsg(t('لا توجد نتائج'), 'غيّر البحث أو التصفية.')); return; }
        const table = el('table', { class: 'table admin-table' },
          el('thead', null, el('tr', null,
            el('th', { class: 'admin-check-cell' }, selectAll),
            el('th', null, ''), el('th', null, 'الاسم'), el('th', null, 'التصنيف'),
            el('th', null, 'الإصدار'), el('th', null, 'الحجم'),
            el('th', null, 'التنزيلات'), el('th', null, 'الإجراءات'))),
          el('tbody', null, ...list.map((a) => {
            const cb = el('input', { type: 'checkbox', class: 'admin-check', 'aria-label': `تحديد ${a.name}` });
            cb.checked = state.selected.has(a.id);
            cb.addEventListener('change', () => {
              if (cb.checked) state.selected.add(a.id); else state.selected.delete(a.id);
              updateBulk();
            });
            return el('tr', { 'data-id': a.id },
              el('td', { class: 'admin-check-cell' }, cb),
              el('td', { class: 'cell-icon' }, a.icon_url
                ? el('img', { src: a.icon_url, class: 'ico-sm' }) : el('div', { class: 'ico-sm' })),
              el('td', { 'data-label': 'الاسم' }, el('div', null, a.name),
                (a.stars > 0) ? el('span', { class: 'star-pin', style: 'position:relative; top:auto; inset-inline-end:auto; display:inline-flex; margin-top:6px;' }, ico('star'), formatNum(a.stars)) : null),
              el('td', { 'data-label': 'التصنيف' }, t(cats.find((c) => c.slug === a.category)?.name) || t(a.category) || '—'),
              el('td', { 'data-label': 'الإصدار' }, a.version_name || '—'),
              el('td', { 'data-label': 'الحجم' }, formatBytes(a.size_bytes)),
              el('td', { 'data-label': 'التنزيلات' }, formatNum(a.downloads)),
              el('td', { class: 'cell-actions' }, el('div', { class: 'row-actions' },
                el('button', { class: 'btn btn-sm btn-secondary', type: 'button', title: t('معاينة'), onclick: () => previewApp(a) }, ico('eye', 'icon'), t('معاينة')),
                el('a', { class: 'btn btn-sm btn-secondary', href: `/app?slug=${a.slug}`, target: '_blank' }, ico('external'), 'عرض'),
                el('button', { class: 'btn btn-sm btn-secondary', type: 'button', title: t('تكرار'), onclick: () => duplicateApp(a) }, ico('copy', 'icon'), t('تكرار')),
                el('button', { class: 'btn btn-sm btn-secondary', type: 'button', onclick: () => goTab(`edit:${a.id}`) }, ico('edit'), 'تعديل'),
                el('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => {
                  if (!confirm(`حذف «${a.name}» نهائياً؟`)) return;
                  try {
                    const del = await api(`/api/admin/apps/${a.id}`, { method: 'DELETE' });
                    logAdminAction(`حذف «${a.name}»`);
                    toast(deleteResultText(del), (del && del.failed_files) ? 'info' : 'success');
                    await renderApp();
                  } catch (err) {
                    /* «فشل الحذف» alone told the owner nothing and sent them
                       hunting the wrong problem (round 79: the row was never
                       deleted because the old order required R2 to succeed
                       first). Say which step failed. */
                    toast(deleteErrorText(err, a.name), 'error');
                  }
                } }, ico('trash'), 'حذف'),
              )),
            );
          })),
        );
        tableWrap.append(table);
        // Pagination never changes the bulk selection: "select all" still
        // applies to every filtered row, and CSV/JSON export keeps all rows.
        tableWrap.append(pager(filtered.length, state.page, state.pageSize, (p) => {
          state.page = p; renderTable();
        }));
        selectAll.checked = list.length > 0 && list.every((a) => state.selected.has(a.id));
      }

      const bulkCount = el('strong', { class: 'admin-bulk-count' });
      const bulkAction = el('select', { class: 'input admin-table-filter', 'aria-label': t('إجراء جماعي') },
        el('option', { value: '' }, t('إجراء جماعي')),
        el('option', { value: 'status:published' }, t('منشور')),
        el('option', { value: 'status:draft' }, t('مسودة')),
        el('option', { value: 'type:app' }, 'تطبيق'),
        el('option', { value: 'type:game' }, 'لعبة'),
        ...cats.map((c) => el('option', { value: `category:${c.slug}` }, t(c.name) || c.slug)));
      async function applyBulk() {
        const value = bulkAction.value;
        const rows = selection();
        if (!value || !rows.length) { toast(t('إجراء جماعي'), 'error'); return; }
        if (!confirm(`${t('تطبيق الإجراء')} — ${rows.length} ${t('محدّد')}؟`)) return;
        let done = 0;
        for (const a of rows) {
          try {
            if (value.startsWith('status:')) {
              await api('/api/admin/publication', { method: 'POST', body: { slug: a.slug, status: value.slice(7) } });
            } else {
              const [k, v] = value.split(':');
              await api(`/api/admin/apps/${a.id}`, { method: 'PATCH', body: { [k]: v } });
            }
            done++;
          } catch (e) {}
        }
        logAdminAction(`${t('إجراء جماعي')}: ${value} (${done})`);
        toast(`${done} / ${rows.length}`, 'success');
        renderApp();
      }
      const bulkBar = el('div', { class: 'admin-bulk-bar' },
        bulkCount, bulkAction,
        el('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: applyBulk }, t('تطبيق الإجراء')),
        el('button', { class: 'btn btn-sm btn-secondary', type: 'button', onclick: () => exportRows('csv') }, t('تصدير CSV')),
        el('button', { class: 'btn btn-sm btn-secondary', type: 'button', onclick: () => exportRows('json') }, t('تصدير JSON')),
        el('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: bulkDelete }, t('حذف المحدد')),
        el('button', { class: 'btn btn-sm btn-secondary', type: 'button', onclick: () => { state.selected.clear(); updateBulk(); renderTable(); } }, t('إلغاء التحديد')));
      selectAll.addEventListener('change', () => {
        const list = visible();
        if (selectAll.checked) list.forEach((a) => state.selected.add(a.id));
        else list.forEach((a) => state.selected.delete(a.id));
        updateBulk(); renderTable();
      });
      searchInput.addEventListener('input', () => { state.q = searchInput.value; state.page = 1; renderTable(); });
      catSel.addEventListener('change', () => { state.cat = catSel.value; state.page = 1; renderTable(); });
      sortSel.addEventListener('change', () => { state.sort = sortSel.value; state.page = 1; renderTable(); });

      const densityBtn = el('button', {
        class: 'btn btn-sm btn-secondary admin-density-btn' + (document.body.classList.contains('admin-compact') ? ' is-on' : ''),
        type: 'button', title: t('كثافة مضغوطة'), 'aria-label': t('كثافة مضغوطة'),
        onclick: (e) => {
          const on = document.body.classList.toggle('admin-compact');
          try { localStorage.setItem('gs_admin_compact', on ? '1' : '0'); } catch (err) {}
          e.currentTarget.classList.toggle('is-on', on);
        },
      }, ico('grid', 'icon'), t('كثافة مضغوطة'));
      body.append(
        el('div', { class: 'admin-page-head' },
          el('div', null,
            el('h1', { class: 'admin-page-title' }, `${kind === 'game' ? 'الألعاب' : 'التطبيقات'} (${apps.length})`),
            el('p', { class: 'admin-page-sub' }, 'بحث، تصفية، فرز، إجراءات جماعية وتصدير — كل ما تحتاجه لإدارة الكتالوج.')),
          el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => { newKind = kind; goTab('new'); } },
            ico('plus'), kind === 'game' ? 'إضافة لعبة' : 'إضافة تطبيق')),
        el('div', { class: 'admin-table-toolbar' }, searchInput, catSel, sortSel, countEl, densityBtn),
        bulkBar,
        tableWrap,
      );
      renderTable();
      updateBulk();
    } catch (e) {
      body.innerHTML = '';
      body.append(emptyMsg('تعذر التحميل', e.message));
    }
  }

  // -------- new app form --------
  async function renderNewApp(body) {
    body.innerHTML = '';
    // A fresh visit to the form is a fresh publish attempt.
    window.__gsPublishStamp = Date.now();

    const apkDz = dropzone({ accept: '.apk', label: 'اسحب أو اختر ملف APK' });
    const iconDz = dropzone({ accept: 'image/*', label: 'اختر أيقونة (PNG/JPG)' });
    const featDz = dropzone({ accept: 'image/*', label: 'اختر صورة عرضية (يفضّل 1024×500)' });
    const ssDz = dropzone({ accept: 'image/*', multiple: true, label: 'اختر لقطات الشاشة (متعددة)' });
    /* The video editor reads the product name LIVE from the form, so a thumbnail
       uploaded before the name is typed still lands on the item's own name
       instead of the generic «video». */
    const nameInput = () => form.querySelector('[name="name"]');
    const ve = videoEditor({ videos: [], slugHint: () => (nameInput() && nameInput().value) || '', onAdd: (v) => v, onDelete: () => true });

    const form = el('form', { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      const apkFiles = apkDz.getFiles();
      if (!apkFiles.length) { toast('يجب رفع ملف APK', 'error'); return; }
      const maxMb = Number((window.GSSettings && window.GSSettings.get('max_upload_mb', '200')) || 200);
      if (apkFiles[0] && apkFiles[0].size > maxMb * 1024 * 1024) {
        toast(`أقصى حجم مسموح: ${maxMb} م.ب`, 'error'); return;
      }
      const data = Object.fromEntries(new FormData(form).entries());
      const submitBtn = form.querySelector('button[type=submit]');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '';
      submitBtn.append(el('div', { class: 'spinner', style: 'width:18px; height:18px; border-width:2px;' }));

      let step = 'apk';
      // Set the moment the row exists; everything after that is a resume, not a
      // failed publish.
      let savedId = '';
      try {
        /* ── «ملف التطبيق أولاً ثم الصور» ─────────────────────────────────────
         * The APK is uploaded ALONE and the row is saved as soon as it lands;
         * only then do the pictures go up, attached to a row that already
         * exists. Two things this fixes, both reported:
         *
         *  • «تعذّر الاتصال بالخادم أثناء ملف التطبيق» — the row used to be
         *    created after EVERY byte, so one connection had to survive the APK,
         *    the icon, the feature image and every screenshot. A break at any
         *    point failed the whole publish and swept the uploaded files away.
         *  • the owner's order: the app goes down first, the pictures after it.
         *
         * A break now costs at most the file in flight: what already uploaded
         * stays attached to the row, and pressing publish again resumes.
         */
        const slugHint = (data.name || 'app').slice(0, 60);
        toast('بدء رفع ملف التطبيق…');
        step = 'apk';
        /* An APK that a previous attempt already sent is reused: the key is
           deterministic per item, so the bytes in the bucket ARE this file.
           Re-sending 40 MB because the connection dropped once is the exact
           waste the owner reported. */
        const stagedApk = stagedKeyFor(data, 'apk', apkFiles[0]);
        let apk_key;
        if (stagedApk) {
          apk_key = stagedApk;
          apkDz.setProgress(0, 1);
          trackUploaded(apk_key, 'apk');
          toast('ملف التطبيق مرفوع مسبقاً — لن يُرفع مرة أخرى');
        } else {
          apk_key = await r2Upload(apkFiles[0], 'apk', slugHint, (r) => apkDz.setProgress(0, r));
        }

        // The shell row: name, package and nothing else that needs bytes. It is
        // not announced and not downloadable until the file is attached below.
        step = 'create';
        let created;
        try {
          created = await api('/api/admin/apps', {
            method: 'POST',
            timeoutMs: 60000,
            body: {
              name: data.name,
              package_name: data.package_name,
              developer: data.developer,
              category: data.category,
              type: data.type === 'game' ? 'game' : 'app',
              short_description: data.short_description,
              description: data.description,
              version_name: data.version_name,
              version_code: data.version_code ? Number(data.version_code) : undefined,
              min_sdk: data.min_sdk ? Number(data.min_sdk) : undefined,
              post_create: true,
            },
          });
        } catch (e) {
          // The files are already in the bucket; the row may exist anyway. Check
          // before reporting a failure — that false «Internet error» is exactly
          // what was reported twice.
          const found = await findCreatedApp(data.name).catch(() => null);
          if (!found) throw e;
          created = found;
        }
        if (created && created.existing) {
          toast(created.duplicate
            ? 'هذا العنصر منشور بالفعل — فتحنا نسخته الأصلية ولم ننشئ نسخة ثانية'
            : 'الاسم مستخدم بالفعل لعنصر آخر — فتحناه ولم ننشئ نسخة ثانية. غيّر الاسم أو عدّل العنصر الموجود', 'info');
          uploadSession.keys.length = 0;
          activeTab = `edit:${created.id}`;
          renderApp();
          return;
        }
        if (!created || (!created.id && !created.slug)) {
          throw Object.assign(new Error('row_not_saved'), { status: 502 });
        }
        const newId = created.id;
        savedId = newId;

        /* The file that makes the item real. This is also the single moment the
         * «new app» notice is written, so the announcement can never arrive
         * before the download exists. */
        step = 'apk';
        const apkRes = await api(`/api/admin/apps/${newId}/apk`, {
          method: 'POST',
          timeoutMs: 60000,
          body: {
            apk_key,
            version_name: data.version_name || null,
            version_code: data.version_code ? Number(data.version_code) : undefined,
          },
        });
        const apkNotified = !!(apkRes && apkRes.notified);
        uploadSession.keys.length = 0;   // the row owns the APK from here on
        toast('تم رفع ملف التطبيق — الآن الصور…');

        /* Pictures: one at a time, in the owner's order, each attached as soon
         * as it lands. iconTrouble collects what failed so the owner is told
         * exactly which picture did not go up instead of a bare «فشل». */
        const iconTrouble = [];
        const attach = async (kind, file, idx, list, call) => {
          try {
            const key = await r2Upload(file, kind, slugHint, (r) => (kind === 'icon' ? iconDz : kind === 'feature' ? featDz : ssDz).setProgress(idx, r));
            await call(key);
          } catch (e) {
            iconTrouble.push({ kind, message: publishErrorText(e, kind === 'screenshot' ? 'screenshots' : kind, data.name) });
          }
        };
        const iconFiles = iconDz.getFiles();
        if (iconFiles.length) {
          step = 'icon';
          await attach('icon', iconFiles[0], 0, null, (key) =>
            api(`/api/admin/apps/${newId}/icon`, { method: 'POST', body: { icon_key: key } }));
        }
        const featFiles = featDz.getFiles();
        if (featFiles.length) {
          step = 'feature';
          await attach('feature', featFiles[0], 0, null, (key) =>
            api(`/api/admin/apps/${newId}/feature`, { method: 'POST', body: { feature_key: key } }));
        }
        const ssFiles = ssDz.getFiles();
        const ssKeys = [];
        for (let i = 0; i < ssFiles.length; i++) {
          step = 'screenshots';
          try {
            ssKeys.push(await r2Upload(ssFiles[i], 'screenshot', slugHint, (r) => ssDz.setProgress(i, r)));
          } catch (e) {
            iconTrouble.push({ kind: 'screenshot', message: publishErrorText(e, 'screenshots', data.name) });
          }
        }
        if (ssKeys.length) {
          try {
            await api(`/api/admin/apps/${newId}/screenshots`, { method: 'POST', timeoutMs: 120000, body: { screenshot_keys: ssKeys } });
          } catch (e) {
            iconTrouble.push({ kind: 'screenshot', message: publishErrorText(e, 'screenshots', data.name) });
          }
        }
        try {
          const vids = ve.getVideos();
          if (vids && vids.length) {
            for (let i = 0; i < vids.length; i++) {
              await api(`/api/admin/apps/${newId}/videos`, { method: 'POST', body: vids[i] });
            }
          }
        } catch (e) {
          iconTrouble.push({ kind: 'video', message: publishErrorText(e, 'create', data.name) });
        }

        /* Everything that matters is already saved. The item is published and
         * downloadable, so a picture problem is a warning, not a lost publish. */
        clearDraft(data);   // the row owns every file from here on
        const res = { id: newId, slug: created.slug, notified: apkNotified };
        if (iconTrouble.length) {
          toast(`تم نشر التطبيق وملفه، لكن ${iconTrouble.length} من الصور لم تُرفع: `
            + iconTrouble.map((x) => x.message).filter((m, i2, a2) => a2.indexOf(m) === i2).join(' — ')
            + ' — افتح التطبيق من القائمة وأعد رفعها.', 'error');
        } else {
          toast('تم رفع التطبيق بنجاح', 'success');
        }
        activeTab = `edit:${res.id}`;
        renderApp();
        return;
      } catch (err) {
        /* «تعذّر الاتصال… وأُزيلت 3 ملفات» must never happen again.
         *
         * The sweep below only exists for files that NOTHING points at. Once the
         * row is saved it owns every file already uploaded, so throwing them away
         * would delete a published item's own APK. So: before the row exists, an
         * abandoned attempt is swept; after it exists, nothing is deleted and the
         * owner is told what is still missing and that pressing publish again
         * resumes from where it stopped. */
        const base = publishErrorText(err, step, data.name);
        /* Nothing is deleted while the owner still wants this item.
         *
         * The files already uploaded are remembered as a STAGING draft (in this
         * browser only). Uploading the same files again reuses them — so a
         * dropped connection costs a click, not the megabytes that already
         * travelled — and pressing publish again resumes. The drafts are only
         * cleared once a row owns them, or when the owner cancels. */
        let swept = { deleted: 0 };
        if (!savedId) {
          stashDraft(data, {
            apk_key: uploadedKeysOf('apk'), icon: uploadedKeysOf('icon'),
            feature: uploadedKeysOf('feature'), screenshots: uploadedKeysOf('screenshot'),
          });
          uploadSession.keys.length = 0;
        }
        if (savedId) {
          /* The row exists: the connection dropped while a picture was going up.
             Say what really happened, name the app, and keep every byte. */
          const pkg = (appListCache || []).find((x) => x.id === savedId);
          const title = (pkg && pkg.name) || data.name;
          toast(`${base} — لكن «${title}» محفوظ ولم يُفقد شيء من ملفاته. `
            + 'افتحه من القائمة وأعد رفع الصورة التي توقفت.', 'error');
          activeTab = `edit:${savedId}`;
          renderApp();
        } else {
          toast(swept.deleted
            ? `${base} — وأُزيلت ${swept.deleted} ملفات رُفعت ثم لم تُستخدم.`
            : base, 'error');
          submitBtn.disabled = false;
          submitBtn.innerHTML = '';
          submitBtn.append(ico('upload'), document.createTextNode('رفع التطبيق'));
        }
      }
    } });

    form.append(
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('plus'), newKind === 'game' ? 'إضافة لعبة جديدة' : 'إضافة تطبيق جديد'),
        formField('name', 'الاسم', 'text', { required: true, placeholder: newKind === 'game' ? 'مثلاً: لعبة الألغاز' : 'مثلاً: تطبيق محرر النصوص' }),
        formField('package_name', 'اسم الحزمة (Package name)', 'text', { required: true, placeholder: 'com.example.app' }),
        formRow(
          formField('developer', 'المطوّر', 'text', { placeholder: 'اسم المطوّر' }),
          categoryField('category', null, 'type'),
        ),
        typeField('type', newKind),
        formField('short_description', 'وصف مختصر', 'text', { placeholder: 'سطر واحد يصف التطبيق' }),
        formTextarea('description', 'الوصف الكامل', { placeholder: 'تفاصيل التطبيق وميزاته…', rows: 5 }),
        formRow(
          formField('version_name', 'اسم الإصدار', 'text', { placeholder: '1.0.0' }),
          formField('version_code', 'رمز الإصدار (رقم)', 'number', { placeholder: '1' }),
        ),
        formField('min_sdk', 'الحد الأدنى لـ Android SDK', 'number', { placeholder: '21', hint: '21 = أندرويد 5.0' }),
      ),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('android'), 'ملف APK *'),
        apkDz,
      ),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('image'), 'الأيقونة'),
        iconDz,
      ),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('image'), 'الصورة العرضية (تظهر في بطاقات اختيارات المحررين)'),
        featDz,
      ),
      el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('image'), 'لقطات الشاشة'),
        ssDz,
      ),
      ve.panel,
      el('div', { class: 'flex gap-md' },
        el('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, ico('upload'), 'رفع التطبيق'),
        /* Cancelling releases the files this attempt uploaded: nothing points at
           them, and the owner has always asked that the bucket not accumulate
           leftovers nobody can trace («ماذا الذي لا يحذف من اين اتى»). Abandoning
           a draft is the moment to delete them, and the result is reported. */
        el('button', { type: 'button', class: 'btn btn-secondary', onclick: async () => {
          const held = releaseDraft(data);
          clearDraft(data);
          if (held.length) {
            const out = await discardUploadedKeys(held);
            toast(out.deleted
              ? `أُلغي النشر وأُزيلت ${out.deleted} ملفات رُفعت في هذه المحاولة`
              : 'أُلغي النشر — تعذّر إزالة الملفات المرفوعة، ستُمسح من لوحة التخزين', out.deleted ? 'info' : 'error');
          }
          activeTab = 'apps';
          renderApp();
        } }, 'إلغاء'),
      ),
    );
    // Pre-fill the form when an existing item was duplicated from the list.
    try {
      const dupRaw = sessionStorage.getItem('gs_admin_duplicate');
      if (dupRaw) {
        sessionStorage.removeItem('gs_admin_duplicate');
        const dup = JSON.parse(dupRaw);
        Object.keys(dup).forEach((k) => {
          const f = form.elements[k];
          if (f && f.value !== undefined && dup[k] != null) f.value = String(dup[k]);
        });
        toast('تم نسخ البيانات — غيّر الاسم وارفع APK جديداً', 'info');
      }
    } catch (e) {}
    // Settings: prefill the default type/category for a brand-new item.
    try {
      const cfg = window.GSSettings;
      if (cfg) {
        const tField = form.elements.type;
        const cField = form.elements.category;
        if (tField && cfg.get('default_type')) tField.value = cfg.get('default_type');
        if (cField && cfg.get('default_category')) cField.value = cfg.get('default_category');
      }
    } catch (e) {}
    body.append(form);
  }

  // -------- edit app --------
  async function renderEditApp(body, id) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    try {
      const { app, screenshots, videos = [] } = await api(`/api/admin/apps/${id}`);
      body.innerHTML = '';

      // Header
      body.append(
        el('div', { class: 'flex gap-md mt-md', style: 'align-items:center;' },
          el('button', { class: 'btn btn-secondary btn-sm', onclick: () => { activeTab = 'apps'; renderApp(); } },
            ico('arrowRight'), 'العودة'),
          el('h2', { class: 'section-title' }, app.name),
          el('span', { class: 'right' },
            el('a', { class: 'btn btn-secondary btn-sm', href: `/app?slug=${app.slug}`, target: '_blank' }, ico('external'), 'عرض في المتجر'),
          ),
        ),
      );

      // Metadata form
      const form = el('form', { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        if (data.version_code === '') delete data.version_code;
        if (data.min_sdk === '') delete data.min_sdk;
        /* Owner: «أريد عند التعديل عليها تستبدل المعلومات القديمة ولا تنشر إعلان
           ولا تأتي منها نسخة ثانية».
           The answer now says WHICH of those happened, and the page replaces what
           it shows with the saved values instead of asking the owner to reload:
             • a rename/re-categorise/description edit → «استُبدلت المعلومات …
               بلا إشعار ولا نسخة ثانية»,
             • a real version bump → says so, because that one IS announced,
             • a clash with another item → nothing is saved and the reason is
               spelled out (the same title or package already exists). */
        const submitBtn = form.querySelector('button[type=submit]');
        if (submitBtn) submitBtn.disabled = true;
        try {
          const res = await api(`/api/admin/apps/${id}`, { method: 'PATCH', body: data });
          const n = (res && res.changed) ? res.changed.length : 0;
          if (res && res.notified) {
            toast(`استُبدلت البيانات (${n} حقلاً) — وأُرسل إشعار إصدار جديد لأن رقم الإصدار ارتفع`, 'info');
          } else {
            toast(`استُبدلت البيانات (${n} حقلاً) — بلا إشعار ولا نسخة ثانية`, 'success');
          }
          /* Replace what is on screen with the saved values. A reload is what
             made an edit feel like a re-publish. */
          if (res && res.app) {
            const setField = (key, val) => {
              const input = form.querySelector(`[name="${key}"]`);
              if (input && val !== undefined) input.value = val ?? '';
            };
            setField('name', res.app.name);
            setField('package_name', res.app.package_name);
            setField('developer', res.app.developer);
            setField('version_name', res.app.version_name);
            const h2 = body.querySelector('.section-title');
            if (h2 && res.app.name) h2.textContent = res.app.name;
          }
          if (res && res.invalidate_device_package && window.Store && Store.clearResolvedPackage) {
            try { Store.clearResolvedPackage(app.slug); } catch (e2) {}
          }
          load();
        } catch (err) {
          const msg = (err && err.data && err.data.message) || '';
          if (err && (err.status === 409 || msg)) toast(msg || 'الاسم أو اسم الحزمة مستخدم بالفعل — لم يُحفظ شيء', 'error');
          else toast('فشل الحفظ', 'error');
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      } });
      form.append(
        el('div', { class: 'panel' },
          el('div', { class: 'panel-head' }, ico('edit'), 'البيانات الأساسية'),
          formField('name', 'اسم التطبيق', 'text', { required: true, value: app.name }),
          formField('package_name', 'اسم الحزمة', 'text', { required: true, value: app.package_name }),
          formRow(
            formField('developer', 'المطوّر', 'text', { value: app.developer || '' }),
            categoryField('category', app.category, 'type'),
          ),
          typeField('type', app.type),
          formField('short_description', 'وصف مختصر', 'text', { value: app.short_description || '' }),
          formTextarea('description', 'الوصف الكامل', { rows: 5, value: app.description || '' }),
          formRow(
            formField('version_name', 'اسم الإصدار', 'text', { value: app.version_name || '' }),
            formField('version_code', 'رمز الإصدار', 'number', { value: app.version_code ?? '' }),
          ),
          formField('min_sdk', 'الحد الأدنى لـ SDK', 'number', { value: app.min_sdk ?? '' }),
          el('button', { type: 'submit', class: 'btn btn-primary' }, ico('check'), 'حفظ التغييرات'),
        ),
      );
      body.append(form);

      // APK replace
      const apkDz = dropzone({ accept: '.apk', label: 'استبدل ملف APK' });
      const apkForm = el('form', { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        const files = apkDz.getFiles();
        if (!files.length) { toast('اختر ملف APK', 'error'); return; }
        const vn = apkForm.querySelector('[name=version_name]').value;
        const vc = apkForm.querySelector('[name=version_code]').value;
        try {
          const apk_key = await r2Upload(files[0], 'apk', app.slug, (r) => apkDz.setProgress(0, r), { app_id: app.id });
          const rep = await api(`/api/admin/apps/${id}/apk`, {
            method: 'POST',
            body: { apk_key, version_name: vn || undefined, version_code: vc ? Number(vc) : undefined },
          });
          /* «أريد عند التحديث يحذف القديم» + «لا يبعث إشعاراً». The server
             reports three separate facts now — the file replaced, the old one
             removed, and whether the notification (+push) actually went out —
             so the panel never claims something that did not happen. */
          const pushState = (rep && rep.push) || {};
          const pushNote = pushState.skipped === 'push_disabled' ? ' — الإشعار محفوظ، والدفع متوقف من الإعدادات'
            : pushState.skipped === 'quiet_hours' ? ' — الإشعار محفوظ، والدفع مؤجّل (ساعات الهدوء)'
            : pushState.error ? ' — تعذّر الدفع' : ' — أُرسل إشعار الإصدار';
          const lines = [
            rep && rep.notified === false ? 'حُدّث الملف، لكن لم يُسجّل إشعار' : `حُدّث الإصدار ${(rep && rep.version && rep.version.name) || ''}${rep && rep.notified ? pushNote : ''}`,
            rep && rep.cleaned === false ? 'الملف القديم بقي في كلاود — احذفه من «تنظيف الحاوية»' : 'وحُذف الملف القديم',
          ];
          toast(lines.join(' · '), rep && (rep.cleaned === false || rep.notified === false) ? 'info' : 'success');
          renderEditApp(body, id);
        } catch (err) {
          // Say WHY, in words: the upload step and the row update are different
          // failures and used to share one sentence.
          toast(publishErrorText(err, 'apk', app.name), 'error');
        }
      } });
      apkForm.append(
        apkDz,
        formRow(
          formField('version_name', 'اسم الإصدار الجديد', 'text', { placeholder: 'مثلاً: 1.1.0' }),
          formField('version_code', 'رمز الإصدار', 'number', { placeholder: '2' }),
        ),
        el('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, ico('upload'), 'تحديث APK'),
      );
      body.append(el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('android'), 'تحديث ملف APK'),
        el('p', { class: 'muted', style: 'font-size:13px;' }, `الحالي: ${formatBytes(app.size_bytes)} · ${app.version_name || '—'}`),
        apkForm,
      ));

      // Icon replace
      const iconDz = dropzone({ accept: 'image/*', label: 'اختر أيقونة جديدة' });
      const iconForm = el('form', { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        const files = iconDz.getFiles();
        if (!files.length) { toast('اختر صورة', 'error'); return; }
        try {
          const icon_key = await r2Upload(files[0], 'icon', app.slug, (r) => iconDz.setProgress(0, r), { app_id: app.id });
          const rep = await api(`/api/admin/apps/${id}/icon`, { method: 'POST', body: { icon_key } });
          toast(rep && rep.cleaned === false
            ? 'حُدّثت الأيقونة، لكن القديمة بقيت في كلاود — احذفها من «ملفات غير مستخدمة»'
            : 'تم تحديث الأيقونة وحُذفت القديمة', rep && rep.cleaned === false ? 'info' : 'success');
          renderEditApp(body, id);
        } catch (err) { toast(publishErrorText(err, 'icon', app.name), 'error'); }
      } });
      iconForm.append(iconDz, el('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, ico('upload'), 'استبدال الأيقونة'));
      body.append(el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('image'), 'الأيقونة'),
        app.icon_url ? el('img', { src: app.icon_url, style: 'width:80px; height:80px; border-radius:18px; border:1px solid var(--line); margin-bottom:12px;' }) : null,
        iconForm,
      ));

      // Feature graphic (wide image used in the home editors-choice carousel)
      const featDz = dropzone({ accept: 'image/*', label: 'اختر صورة عرضية (يفضّل 1024×500)' });
      const featForm = el('form', { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        const files = featDz.getFiles();
        if (!files.length) { toast('اختر صورة', 'error'); return; }
        try {
          const feature_key = await r2Upload(files[0], 'feature', app.slug, (r) => featDz.setProgress(0, r), { app_id: app.id });
          const rep = await api(`/api/admin/apps/${id}/feature`, { method: 'POST', body: { feature_key } });
          toast(rep && rep.cleaned === false
            ? 'حُدّثت الصورة، لكن القديمة بقيت في كلاود — احذفها من «ملفات غير مستخدمة»'
            : 'تم تحديث الصورة وحُذفت القديمة', rep && rep.cleaned === false ? 'info' : 'success');
          renderEditApp(body, id);
        } catch (err) { toast(publishErrorText(err, 'feature', app.name), 'error'); }
      } });
      featForm.append(featDz, el('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, ico('upload'), 'حفظ الصورة العرضية'));
      body.append(el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('image'), 'الصورة العرضية (بطاقات اختيارات المحررين)'),
        app.feature_url ? el('img', { src: app.feature_url, style: 'width:100%; max-width:420px; aspect-ratio:1024/500; object-fit:cover; border-radius:16px; border:1px solid var(--line); margin-bottom:12px;' }) : null,
        featForm,
      ));

      /* Screenshots.
       *
       * «عندما حدّثت التطبيق كل الصور نُشرت مرة ثانية». Two faults met here:
       * adding a new picture always uploaded it into the NEXT free slot, so a
       * RE-UPLOAD (the same slot, perhaps a corrected picture) could only ever
       * add another one; and the server appended a row per key, so the page
       * ended up showing the same slot twice.
       *
       * The picker now asks for the slot, the server updates a slot that already
       * exists instead of duplicating it, and the toast says exactly how many
       * were replaced and how many were added. */
      const ssDz = dropzone({ accept: 'image/*', multiple: true, label: 'أضف لقطات جديدة' });
      const freeSlot = (() => {
        let n = 1;
        const used = new Set((screenshots || []).map((s) => Number(s.position) || 0));
        while (used.has(n)) n++;
        return n;
      })();
      const ssSlot = formField('slot', 'رقم اللقطة (اختر رقماً موجوداً لاستبدالها)', 'number',
        { value: freeSlot, min: 1 });
      const ssForm = el('form', { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        const files = ssDz.getFiles();
        if (!files.length) { toast('اختر صور', 'error'); return; }
        const first = Math.max(1, Number(ssForm.querySelector('[name=slot]').value) || freeSlot);
        try {
          const screenshot_keys = [];
          for (let i = 0; i < files.length; i++) {
            const k = await r2Upload(files[i], 'screenshot', app.slug, (r) => ssDz.setProgress(i, r), { app_id: app.id, slot: first + i });
            screenshot_keys.push(k);
          }
          const res = await api(`/api/admin/apps/${id}/screenshots`, { method: 'POST', body: { screenshot_keys } });
          const didReplace = (res && res.replaced) || [];
          const didAdd = (res && res.added) || [];
          const bits = [];
          if (didReplace.length) bits.push(`استُبدلت ${didReplace.length}`);
          if (didAdd.length) bits.push(`أُضيفت ${didAdd.length}`);
          toast(bits.length ? bits.join(' · ') : 'لم يتغيّر شيء', 'success');
          renderEditApp(body, id);
        } catch (err) { toast(publishErrorText(err, 'screenshots', app.name), 'error'); }
      } });
      ssForm.append(ssDz, ssSlot,
        el('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, ico('upload'), 'رفع / استبدال'));
      const ssPanel = el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('image'), 'لقطات الشاشة'),
      );
      if (screenshots.length) {
        const row = el('div', { class: 'screenshots' });
        screenshots.forEach((ss) => {
          const wrap = el('div', { style: 'position:relative; flex-shrink:0;' },
            ss.url ? el('img', { src: ss.url, style: 'max-height:180px; width:auto; max-width:320px; min-width:72px; object-fit:contain; background:var(--surface-2); border:1px solid var(--line); border-radius:8px;' }) : null,
            (() => {
              // Replacing a picture used to be impossible: the picker always
              // uploaded into a NEW slot, so the old one could only be deleted.
              const inp = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
              inp.addEventListener('change', async () => {
                const f = (inp.files || [])[0];
                if (!f) return;
                try {
                  const key = await r2Upload(f, 'screenshot', app.slug, () => {}, { app_id: app.id, slot: ss.position });
                  const res = await api(`/api/admin/apps/${id}/screenshots`, { method: 'POST', body: { screenshot_keys: [key] } });
                  toast((res && (res.replaced || []).length) ? 'استُبدلت اللقطة في مكانها' : 'أُضيفت اللقطة', 'success');
                  renderEditApp(body, id);
                } catch (err) { toast(publishErrorText(err, 'screenshots', app.name), 'error'); }
              });
              return el('button', { class: 'btn btn-sm btn-secondary', title: 'استبدال هذه الصورة',
                style: 'position:absolute; top:6px; inset-inline-start:6px;',
                onclick: () => inp.click() }, ico('upload'));
            })(),
            el('button', { class: 'btn btn-sm btn-danger', style: 'position:absolute; top:6px; inset-inline-end:6px;',
              onclick: async () => {
                if (!confirm('حذف هذه اللقطة؟')) return;
                try {
                  const r = await api(`/api/admin/apps/${id}/screenshots/${ss.id}`, { method: 'DELETE' });
                  /* The row is gone either way, but the FILE may still be in the
                     bucket — say which of the two happened instead of «تم الحذف». */
                  toast(r && r.cleaned === false
                    ? 'حُذفت اللقطة، لكن ملفها بقي في كلاود — احذفه من «ملفات غير مستخدمة»'
                    : 'حُذفت اللقطة وملفها', r && r.cleaned === false ? 'info' : 'success');
                  renderEditApp(body, id);
                } catch { toast('فشل الحذف', 'error'); }
              } }, ico('trash')),
          );
          row.append(wrap);
        });
        ssPanel.append(row);
      }
      ssPanel.append(el('div', { class: 'mt-md' }, ssForm));
      body.append(ssPanel);

      /* ── بقايا هذا العنصر ──────────────────────────────────────────────────
       * Owner: «قمت بتعديل صغير وأعدت النشر» then saw extra files in Cloudflare
       * («apk/getting-over-it.apk» beside the row that was just edited) and the
       * bug was real: a re-publish used to write a NEW object and the previous
       * one stayed. The upload naming is fixed now, and this card removes what
       * earlier rounds left behind — files that carry this item's own name and
       * that no row points at. Nothing in use can ever appear here. */
      const leftoverOut = el('div', { style: { fontSize: '13px', lineHeight: '1.7', whiteSpace: 'pre-wrap', width: '100%' } });
      const leftoverScan = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, ico('search'), 'افحص بقايا هذا العنصر');
      const leftoverDel = el('button', { class: 'btn btn-danger btn-sm', type: 'button' }, ico('trash'), 'احذف البقايا من كلاود');
      leftoverDel.disabled = true;
      leftoverScan.onclick = async () => {
        leftoverScan.disabled = true;
        leftoverOut.textContent = 'أقارن ملفات هذا العنصر بما يشير إليه المتجر…';
        try {
          const r = await api(`/api/admin/apps/${id}/leftovers`, { timeoutMs: 120000 });
          leftoverOut.innerHTML = '';
          if (!r.count) {
            leftoverOut.append(el('div', { class: 'hint' }, 'لا بقايا — كل ملفات هذا العنصر مستخدمة.'));
            leftoverDel.disabled = true;
          } else {
            leftoverOut.append(el('div', null,
              `${formatNum(r.count)} ملفاً باسم هذا العنصر لا يشير إليه المتجر (${formatBytes(r.bytes)}). لم يُحذف شيء بعد.`));
            leftoverOut.append(el('pre', { style: { marginTop: '6px', fontSize: '11px', whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'left', opacity: '.85' } },
              (r.keys || []).slice(0, 20).join('\n')));
            leftoverDel.disabled = false;
          }
        } catch (e) {
          leftoverOut.textContent = (e && e.status >= 500) ? 'الخادم لا يستجيب الآن — لم يتغيّر شيء.' : 'تعذّر الفحص.';
        } finally { leftoverScan.disabled = false; }
      };
      leftoverDel.onclick = async () => {
        if (!confirm('حذف ملفات هذا العنصر التي لا يستخدمها المتجر؟ لا يمكن التراجع.')) return;
        leftoverDel.disabled = true;
        leftoverOut.textContent = 'أحذف…';
        try {
          const r = await api(`/api/admin/apps/${id}/leftovers/clean`, { method: 'POST', body: { confirm: 'CLEAN-LEFTOVERS' }, timeoutMs: 240000 });
          leftoverOut.textContent = r.failed
            ? `حُذف ${r.deleted} وبقي ${r.failed} — أعد المحاولة.`
            : `حُذف ${r.deleted} ملفاً — لا بقايا لهذا العنصر الآن.`;
          toast(`حُذف ${r.deleted} ملفاً قديماً`, 'success');
          leftoverDel.disabled = true;
          load();
        } catch (e) {
          leftoverOut.textContent = 'تعذّر الحذف: ' + ((e && e.message) || 'حاول لاحقاً');
          leftoverDel.disabled = false;
        }
      };
      body.append(el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('trash'), 'بقايا هذا العنصر في كلاود'),
        el('div', { class: 'hint' }, 'ملفات تحمل اسم هذا العنصر ولا يشير إليها المتجر — بقايا نشر سابق أو رفع لم يكتمل. لا يظهر هنا أي ملف مستخدم.'),
        el('div', { class: 'row-actions', style: { marginTop: '8px' } }, leftoverScan, leftoverDel),
        leftoverOut));

      // YouTube videos / Shorts
      const ve = videoEditor({
        videos,
        slugHint: app.slug,
        appId: app.id,
        onAdd: async (v) => {
          const r = await api(`/api/admin/apps/${id}/videos`, {
            method: 'POST',
            body: { url: v.url, title: v.title, kind: v.kind, thumb_key: v.thumb_key || null },
          });
          return r.video;
        },
        onThumbSave: async (v, thumb_key) => {
          const r = await api(`/api/admin/apps/${id}/videos/${v.id}`, {
            method: 'PATCH', body: { thumb_key },
          });
          return r.video;
        },
        onThumbReset: async (v) => {
          await api(`/api/admin/apps/${id}/videos/${v.id}`, {
            method: 'PATCH', body: { thumb_key: null },
          });
          return true;
        },
        onDelete: async (v) => {
          await api(`/api/admin/apps/${id}/videos/${v.id}`, { method: 'DELETE' });
          return true;
        },
      });
      body.append(ve.panel);

      // Danger zone
      body.append(el('div', { class: 'panel' },
        el('div', { class: 'panel-head', style: 'border-color: var(--danger);' }, ico('trash'), 'منطقة الخطر'),
        el('p', { class: 'muted', style: 'font-size:13px;' }, 'حذف التطبيق يحذف ملف APK والأيقونة وجميع اللقطات والفيديوهات نهائياً.'),
        el('button', { class: 'btn btn-danger mt-md', onclick: async () => {
          if (!confirm(`حذف «${app.name}» نهائياً؟`)) return;
          try {
            const del = await api(`/api/admin/apps/${id}`, { method: 'DELETE' });
            toast(deleteResultText(del), (del && del.failed_files) ? 'info' : 'success');
            activeTab = 'apps'; renderApp();
          } catch { toast('فشل الحذف', 'error'); }
        } }, ico('trash'), 'حذف التطبيق نهائياً'),
      ));
    } catch (e) {
      body.innerHTML = '';
      body.append(emptyMsg('تعذر التحميل', e.message));
    }
  }

  // ---------------- form builders ----------------

  function formField(name, label, type = 'text', opts = {}) {
    const inp = el('input', {
      name, type,
      placeholder: opts.placeholder || '',
      required: opts.required ? true : null,
      value: opts.value != null ? String(opts.value) : null,
    });
    return el('div', { class: 'field' },
      el('label', null, label, opts.required ? el('span', { class: 'req' }, ' *') : null),
      inp,
      opts.hint ? el('div', { class: 'hint' }, opts.hint) : null,
    );
  }
  function formTextarea(name, label, opts = {}) {
    const ta = el('textarea', { name, placeholder: opts.placeholder || '', rows: String(opts.rows || 4) });
    if (opts.value) ta.value = opts.value;
    return el('div', { class: 'field' },
      el('label', null, label),
      ta,
    );
  }
  function formRow(...children) {
    return el('div', { class: 'form-row' }, ...children);
  }

  /* ---------- YouTube video links (2026-11-06) --------------------------
     Same URL rules as the Worker: only youtube.com / youtu.be /
     youtube-nocookie.com, an 11-char id, /shorts/ auto-detected but
     overridable with the explicit type selector. */
  function parseYouTubeUrl(raw, kindHint) {
    const str = String(raw == null ? '' : raw).trim();
    if (!str || str.length > 500) return null;
    let id = '', short = false;
    try {
      if (/^[A-Za-z0-9_-]{11}$/.test(str)) id = str;
      else {
        const u = new URL(str);
        if (!/^https?:$/.test(u.protocol)) return null;
        const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
        const path = u.pathname || '';
        if (host === 'youtu.be') id = path.split('/').filter(Boolean)[0] || '';
        else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
          if (path.indexOf('/shorts/') === 0) { id = path.split('/')[2] || ''; short = true; }
          else if (/^\/(embed|v|e|live)\//.test(path)) id = path.split('/')[2] || '';
          else if (path === '/watch' || path === '/watch/') id = u.searchParams.get('v') || '';
          else if (path.indexOf('/watch/') === 0) id = path.split('/')[2] || '';
        }
      }
    } catch { return null; }
    id = String(id).split(/[?&#/]/)[0] || '';
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    const hint = String(kindHint || 'auto');
    const kind = hint === 'short' ? 'short' : hint === 'video' ? 'video' : (short ? 'short' : 'video');
    const url = kind === 'short'
      ? `https://www.youtube.com/shorts/${id}`
      : `https://www.youtube.com/watch?v=${id}`;
    return { video_id: id, kind, url };
  }
  function videoThumb(id) { return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`; }

  function videoEditor(opts) {
    opts = opts || {};
    let items = (opts.videos || []).slice();
    const list = el('div', { class: 'gs-admin-video-list' });
    const urlInput = el('input', {
      class: 'input', type: 'url', placeholder: 'https://youtube.com/watch?v=…  ·  youtu.be/…  ·  /shorts/…',
      'aria-label': t('رابط فيديو يوتيوب'),
    });
    const titleInput = el('input', {
      class: 'input', type: 'text', placeholder: t('عنوان الفيديو (اختياري)'),
      'aria-label': t('عنوان الفيديو (اختياري)'),
    });
    const kindSelect = el('select', { class: 'input', 'aria-label': t('نوع الفيديو') },
      el('option', { value: 'auto' }, t('اكتشاف تلقائي')),
      el('option', { value: 'video' }, t('فيديو عادي')),
      el('option', { value: 'short' }, t('شورت')));
    // Optional custom thumbnail: uploaded to R2 (vthumb/) instead of using
    // YouTube's automatic i.ytimg.com poster.
    const thumbDz = dropzone({ accept: 'image/*', label: t('صورة مصغّرة مخصّصة (اختياري)') });
    thumbDz.classList.add('gs-admin-video-dropzone');
    const addBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: add },
      ico('plus'), t('إضافة فيديو'));

    function thumbSrc(v) { return v.thumb_preview || v.thumb_url || videoThumb(v.video_id); }
    function hasCustomThumb(v) { return !!(v.thumb_preview || v.thumb_url || v.thumb_key); }

    async function uploadThumb(file) {
      if (!file || !/^image\//.test(file.type || '')) { toast(t('اختر صورة'), 'error'); return null; }
      try {
        /* Owner: «لماذا ... الأيقونات مختلطة». Custom video thumbnails used to be
           uploaded with the literal hint «video», so they all landed on
           vthumb/video.jpg and vthumb/video-2.jpg — every new item's picture
           replaced a stranger's. The item's own slug is used now, and a slot
           number keeps two videos of the same item apart. */
        let hint = typeof opts.slugHint === 'function' ? opts.slugHint() : opts.slugHint;
        hint = (hint && hint !== 'video') ? hint : '';
        const optsForUpload = { app_id: opts.appId || undefined, slot: (thumbsUsed() + 1) };
        return await r2Upload(file, 'video-thumb', hint, () => {}, optsForUpload);
      } catch { toast(t('فشل رفع الصورة المصغّرة'), 'error'); return null; }
    }
    // how many custom thumbnails this item already has (so slots never collide)
    function thumbsUsed() {
      try {
        const list = (typeof opts.videos === 'function' ? opts.videos() : opts.videos) || [];
        return list.filter((x) => x && x.thumb_key).length;
      } catch (e) { return 0; }
    }

    async function applyThumb(v, file) {
      const key = await uploadThumb(file);
      if (!key) return;
      try {
        if (opts.onThumbSave) {
          const saved = await opts.onThumbSave(v, key);
          if (saved) { v.thumb_url = saved.thumb_url || null; delete v.thumb_preview; }
        } else {
          try { v.thumb_preview = URL.createObjectURL(file); } catch {}
        }
        v.thumb_key = key;
        renderList();
        toast(t('تم تحديث الصورة المصغّرة'), 'success');
      } catch { toast(t('فشل تحديث الصورة المصغّرة'), 'error'); }
    }

    async function resetThumb(v) {
      try {
        if (opts.onThumbReset) await opts.onThumbReset(v);
        v.thumb_key = null; v.thumb_url = null; delete v.thumb_preview;
        renderList();
        toast(t('تم تحديث الصورة المصغّرة'), 'success');
      } catch { toast(t('فشل تحديث الصورة المصغّرة'), 'error'); }
    }

    function renderList() {
      list.innerHTML = '';
      if (!items.length) {
        list.append(el('div', { class: 'gs-admin-video-empty' }, t('لا توجد فيديوهات بعد')));
        return;
      }
      items.forEach((v) => {
        const isShort = v.kind === 'short';
        const fileInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
        fileInput.addEventListener('change', async () => {
          const f = (fileInput.files || [])[0];
          if (f) await applyThumb(v, f);
          fileInput.value = '';
        });
        const changeBtn = el('button', {
          class: 'btn btn-sm btn-secondary', type: 'button',
          title: t('تغيير الصورة المصغّرة'), 'aria-label': t('تغيير الصورة المصغّرة'),
          onclick: () => fileInput.click(),
        }, ico('image'), t('تغيير الصورة المصغّرة'));
        const resetBtn = hasCustomThumb(v) ? el('button', {
          class: 'btn btn-sm btn-secondary', type: 'button',
          title: t('استخدام صورة يوتيوب'), 'aria-label': t('استخدام صورة يوتيوب'),
          onclick: () => resetThumb(v),
        }, ico('youtube'), t('استخدام صورة يوتيوب')) : null;
        list.append(el('div', { class: 'gs-admin-video-row' },
          el('img', {
            class: `gs-admin-video-thumb ${isShort ? 'is-short' : 'is-video'}`,
            src: thumbSrc(v), alt: t('صورة مصغّرة للفيديو'), loading: 'lazy',
            'data-orient': isShort ? 'portrait' : 'landscape',
          }),
          el('div', { class: 'gs-admin-video-meta' },
            el('div', { class: 'gs-admin-video-badges' },
              el('span', { class: `gs-admin-video-badge${isShort ? ' is-short' : ''}` },
                isShort ? t('شورت') : t('فيديو')),
              hasCustomThumb(v) ? el('span', { class: 'gs-admin-video-badge is-custom' },
                t('صورة مخصّصة')) : null,
            ),
            el('div', { class: 'gs-admin-video-title' }, v.title || v.url),
            el('a', { class: 'gs-admin-video-link', href: v.url, target: '_blank',
              rel: 'noopener noreferrer nofollow' }, v.url),
          ),
          el('div', { class: 'gs-admin-video-actions' },
            fileInput, changeBtn, resetBtn,
            el('button', {
              class: 'btn btn-sm btn-danger', type: 'button',
              'aria-label': t('حذف الفيديو'), title: t('حذف الفيديو'),
              onclick: async () => {
                if (!confirm(t('حذف هذا الفيديو؟'))) return;
                try {
                  const done = await opts.onDelete(v);
                  if (done === false) throw new Error('not_found');
                  items = items.filter((x) => x !== v);
                  renderList();
                  toast(t('تم حذف الفيديو'), 'success');
                } catch { toast(t('فشل حذف الفيديو'), 'error'); }
              },
            }, ico('trash')),
          ),
        ));
      });
    }

    async function add() {
      const parsed = parseYouTubeUrl(urlInput.value, kindSelect.value);
      if (!parsed || items.some((x) => x.video_id === parsed.video_id)) {
        toast(t('رابط يوتيوب غير صالح'), 'error'); return;
      }
      const v = { ...parsed, title: titleInput.value.trim() };
      const thumbFiles = thumbDz.getFiles();
      if (thumbFiles.length) {
        const key = await uploadThumb(thumbFiles[0]);
        if (!key) return;
        v.thumb_key = key;
        try { v.thumb_preview = URL.createObjectURL(thumbFiles[0]); } catch {}
      }
      try {
        const saved = await opts.onAdd(v);
        items.push(saved || v);
        urlInput.value = ''; titleInput.value = ''; kindSelect.value = 'auto';
        thumbDz.reset();
        renderList();
        toast(t('تمت إضافة الفيديو'), 'success');
      } catch { toast(t('فشل إضافة الفيديو'), 'error'); }
    }

    const panel = el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, ico('youtube'), t('فيديوهات يوتيوب')),
      el('p', { class: 'muted', style: 'font-size:13px;' },
        t('أضف روابط فيديوهات يوتيوب') + ' — ' + t('اكتشاف تلقائي')),
      el('div', { class: 'gs-admin-video-form' },
        el('div', { class: 'field' },
          el('label', null, t('رابط فيديو يوتيوب')), urlInput,
          el('div', { class: 'hint' }, 'youtube.com/watch?v=…  ·  youtu.be/…  ·  youtube.com/shorts/…')),
        el('div', { class: 'field' },
          el('label', null, t('عنوان الفيديو (اختياري)')), titleInput),
        el('div', { class: 'field' },
          el('label', null, t('نوع الفيديو')), kindSelect),
      ),
      el('div', { class: 'field gs-admin-video-thumb-field' },
        el('label', null, t('صورة مصغّرة مخصّصة (اختياري)')),
        thumbDz,
        el('div', { class: 'hint' },
          t('تُستخدم صورة يوتيوب تلقائياً عند ترك هذا الحقل فارغاً') + ' · ' +
          t('يفضّل صورة أفقية 16:9 للفيديو وعمودية 9:16 للشورت')),
      ),
      el('div', { class: 'mt-md' }, addBtn),
      list,
    );
    renderList();
    return {
      panel,
      getVideos: () => items.map((v) => {
        const out = { url: v.url, title: v.title || '', kind: v.kind };
        if (v.thumb_key) out.thumb_key = v.thumb_key;
        return out;
      }),
    };
  }
  function categoryField(name, value, typeSelectName) {
    const sel = el('select', { name });
    function populateCats(currentType) {
      const selected = sel.value || value || 'other';
      sel.innerHTML = '';
      cats.forEach((c) => {
        // Show app categories for apps, game categories for games
        const isGameCat = c.slug.startsWith('game_');
        if (currentType === 'game' && !isGameCat && c.slug !== 'other') return;
        if (currentType !== 'game' && isGameCat) return;
        const opt = el('option', { value: c.slug }, t(c.name));
        if (selected === c.slug) opt.selected = true;
        sel.append(opt);
      });
    }
    // Defer linking to type select to allow DOM construction
    setTimeout(() => {
      const typeEl = typeSelectName && sel.closest('form')?.querySelector(`[name="${typeSelectName}"]`);
      if (typeEl) {
        populateCats(typeEl.value);
        typeEl.addEventListener('change', () => populateCats(typeEl.value));
      } else {
        populateCats(value && value.startsWith('game_') ? 'game' : 'app');
      }
    }, 0);
    populateCats(value && value.startsWith('game_') ? 'game' : 'app');
    return el('div', { class: 'field' },
      el('label', null, 'التصنيف'),
      sel,
    );
  }
  function typeField(name, value) {
    const sel = el('select', { name });
    [['app', 'تطبيق'], ['game', 'لعبة']].forEach(([v, lbl]) => {
      const opt = el('option', { value: v }, lbl);
      if ((value || 'app') === v) opt.selected = true;
      sel.append(opt);
    });
    return el('div', { class: 'field' },
      el('label', null, 'النوع'),
      sel,
      el('div', { class: 'hint' }, 'الألعاب تظهر في تبويب «ألعاب» بالشريط السفلي'),
    );
  }
  function formToggle(name, label, checked) {
    const inp = el('input', { type: 'checkbox', name });
    if (checked) inp.checked = true;
    return el('label', { class: 'toggle', style: 'padding-top:6px;' },
      inp,
      el('span', { class: 'track' }),
      el('span', null, label),
    );
  }

  // ---------------- init ----------------
  try { if (localStorage.getItem('gs_admin_compact') === '1') document.body.classList.add('admin-compact'); } catch (e) {}
  applyAdminWidth();
  let saveSettingsFn = null;
  let gsChord = 0;
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault(); openCommandPalette(); return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && activeTab === 'settings' && saveSettingsFn) {
      e.preventDefault(); saveSettingsFn(); return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && activeTab !== 'settings' && tag === 'input') {
      e.preventDefault(); return;
    }
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === '?') { e.preventDefault(); showShortcutsDialog(); return; }
    if (e.key === '/') {
      e.preventDefault();
      const box = document.querySelector('.admin-table-search');
      if (box) box.focus(); else openCommandPalette();
      return;
    }
    if (e.key === 'Escape') {
      const sc = document.getElementById('admin-shortcuts'); if (sc) sc.remove();
      return;
    }
    const now = Date.now();
    if (e.key === 'g' || e.key === 'G') { gsChord = now; return; }
    if (gsChord && now - gsChord < 1200) {
      const map = { d: 'dashboard', a: 'apps', g: 'games', n: 'new', q: 'quality', u: 'app-update' };
      const key = map[(e.key || '').toLowerCase()];
      gsChord = 0;
      if (key) { e.preventDefault(); goTab(key); }
    }
  });
  try {
    me = await api('/api/me');
  } catch {}
  if (me && me.authenticated) await renderApp();
  else await renderLogin();
})();
