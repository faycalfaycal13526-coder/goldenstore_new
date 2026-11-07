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
    ] },
    { id: 'growth', label: 'النمو', icon: 'trending', items: [
      { key: 'notifications', icon: 'bell', label: 'الإشعارات' },
      { key: 'advanced-push', icon: 'bell', label: 'إشعارات متقدمة' },
      { key: 'analytics', icon: 'dashboard', label: 'الإحصائيات' },
    ] },
    { id: 'system', label: 'النظام', icon: 'settings', items: [
      { key: 'app-update', icon: 'download', label: t('مركز التحديث') },
      { key: 'publishing', icon: 'clock', label: t('النشر والترتيب') },
      { key: 'categories', icon: 'grid', label: t('الفئات') },
      { key: 'activity', icon: 'clock', label: t('سجل النشاطات') },
      { key: 'team', icon: 'shield', label: t('المشرفون والصلاحيات') },
      { key: 'backup', icon: 'storage', label: t('النسخ الاحتياطي') },
      { key: 'preview', icon: 'external', label: t('معاينة الأجهزة') },
      { key: 'settings', icon: 'settings', label: 'إعدادات المتجر' },
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

  async function r2Upload(file, kind, slugHint, onProgress) {
    const contentType = file.type || 'application/octet-stream';

    if (file.size > MULTIPART_THRESHOLD) {
      return await r2MultipartUpload(file, kind, slugHint, contentType, onProgress);
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
          },
        });
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
    const { url, key } = presign;

    await retryXhrPut(url, file, contentType, (loaded, total) => {
      if (onProgress) onProgress(loaded / total);
    }, 2, 30 * 60 * 1000);  // 30-min timeout for single PUT (large APKs)
    return key;
  }

  async function r2MultipartUpload(file, kind, slugHint, contentType, onProgress) {
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
      },
    });

    const { key, uploadId, partSize, parts: partUrls } = mp;
    const completedParts = [];
    let totalUploaded = 0;

    try {
      // 2. Upload each part with retry
      for (let i = 0; i < partUrls.length; i++) {
        const start = i * partSize;
        const end = Math.min(start + partSize, file.size);
        const chunk = file.slice(start, end);
        const partNum = partUrls[i].partNumber;
        const partUrl = partUrls[i].url;

        const etag = await retryXhrPut(partUrl, chunk, null, (loaded) => {
          if (onProgress) onProgress((totalUploaded + loaded) / file.size);
        }, 3, 10 * 60 * 1000);  // 10-min timeout per 10MB part

        if (!etag) {
          throw new Error('upload_etag_missing');
        }

        totalUploaded += (end - start);
        if (onProgress) onProgress(totalUploaded / file.size);

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

      return key;
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

    const form = el('form', { class: 'form', autocomplete: 'on', onsubmit: async (e) => {
      e.preventDefault();
      const password = passInput.value;
      if (!password) { passInput.focus(); return; }
      setBusy(true);
      try {
        await api('/api/login', { method: 'POST', body: { password } });
        // Direct in — no extra round trip; render the admin app immediately.
        activeTab = 'dashboard';
        await renderApp();
      } catch (err) {
        setBusy(false);
        passInput.select();
        let msg = 'كلمة المرور غير صحيحة';
        if (err && (err.status === 0 || err.message === 'timeout')) {
          msg = 'تعذّر الاتصال بالخادم. حدّث الصفحة وحاول من جديد.';
        } else if (err && err.status === 500) {
          msg = 'الإعدادات ناقصة على الخادم. تواصل مع مالك المتجر.';
        } else if (err && err.status >= 502 && err.status <= 504) {
          msg = 'الخادم لا يستجيب حالياً. حاول لاحقاً.';
        }
        toast(msg, 'error');
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
    const storeLink = el('a', {
      class: 'icon-btn', href: '/', target: '_blank', rel: 'noopener',
      'aria-label': t('عرض المتجر'), title: t('عرض المتجر'),
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
        el('div', { class: 'admin-actions' }, widthSelect(), searchTrigger, pinnedBar(), pinBtn, helpBtn, storeLink, themeBtn, logoutBtn),
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
    else if (activeTab === 'notifications') await renderNotifications(body);
    else if (activeTab === 'advanced-push') {
      if (window.GSAdminAdvanced) await window.GSAdminAdvanced.renderPush(body);
      else body.innerHTML = '<div class="hint">تعذّر تحميل وحدة الإشعارات المتقدمة — أعد تحميل الصفحة.</div>';
    }
    else if (activeTab === 'analytics') {
      if (window.GSAdminAdvanced) await window.GSAdminAdvanced.renderAnalytics(body);
      else body.innerHTML = '<div class="hint">تعذّر تحميل وحدة الإحصائيات — أعد تحميل الصفحة.</div>';
    }
    else if (activeTab === 'app-update') await renderAppUpdate(body);
    else if (activeTab === 'publishing') await renderPublishing(body);
    else if (activeTab === 'categories') await renderCategories(body);
    else if (activeTab === 'activity') await renderActivity(body);
    else if (activeTab === 'team') await renderTeam(body);
    else if (activeTab === 'backup') await renderBackup(body);
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
  async function renderDashboard(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    let stats = { total_apps: 0, total_downloads: 0, total_size_bytes: 0, top_apps: [] };
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

    const kpi = (icon, label, value, sub) => el('div', { class: 'admin-kpi' },
      el('div', { class: 'admin-kpi-top' }, el('span', { class: 'admin-kpi-icon' }, ico(icon, 'icon')),
        el('span', { class: 'admin-kpi-label' }, label)),
      el('div', { class: 'admin-kpi-value' }, value),
      el('div', { class: 'admin-kpi-sub' }, sub || ''));

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

    body.append(
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
          } catch { toast('فشل التحديث', 'error'); }
          btn.disabled = false;
        } }, ico('check'), 'تعيين النوع للعناصر القديمة')),
    );
  }

  // -------- store settings --------
  async function renderStoreSettings(body) {
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    try {
      const res = await api('/api/admin/settings');
      let enabled = !res.settings || res.settings.notify_new_publications !== false;
      body.innerHTML = '';

      const toggle = el('input', {
        type: 'checkbox',
        class: 'admin-switch-input',
        'aria-label': t('إشعار المستخدمين عند نشر تطبيق أو لعبة'),
      });
      toggle.checked = enabled;
      const state = el('span', { class: 'admin-setting-state' }, enabled ? t('مفعّلة') : t('معطّلة'));

      toggle.addEventListener('change', async () => {
        const next = toggle.checked;
        toggle.disabled = true;
        state.textContent = t('جارٍ الحفظ…');
        try {
          await api('/api/admin/settings', {
            method: 'PATCH',
            body: { notify_new_publications: next },
          });
          enabled = next;
          state.textContent = enabled ? t('مفعّلة') : t('معطّلة');
          toast(t(enabled ? 'تم تفعيل الإشعارات التلقائية' : 'تم تعطيل الإشعارات التلقائية'), 'success');
        } catch (e) {
          toggle.checked = enabled;
          state.textContent = enabled ? t('مفعّلة') : t('معطّلة');
          toast(t('تعذّر حفظ الإعداد'), 'error');
        } finally {
          toggle.disabled = false;
        }
      });

      body.append(
        el('div', { class: 'panel' },
          el('div', { class: 'panel-head' }, ico('settings'), t('إعدادات الإشعارات التلقائية')),
          el('p', { class: 'store-settings-intro' },
            t('تحكّم في الإشعارات التي تُرسل تلقائياً عند نشر تطبيق أو لعبة جديدة.')),
          el('div', { class: 'admin-setting-row' },
            el('div', { class: 'admin-setting-copy' },
              el('strong', null, t('إشعار المستخدمين عند نشر تطبيق أو لعبة')),
              el('span', null,
                t('عند التعطيل، لن يُحفظ إشعار جديد ولن يصل إشعار فوري للمستخدمين. الإعلانات اليدوية وإشعارات تحديث المتجر لا تتأثر.')),
            ),
            el('div', { class: 'admin-setting-control' },
              el('label', { class: 'admin-switch' },
                toggle,
                el('span', { class: 'admin-switch-track', 'aria-hidden': 'true' }, el('span', { class: 'admin-switch-thumb' })),
              ),
              state,
            ),
          ),
        ),
      );
    } catch (e) {
      body.innerHTML = '';
      body.append(emptyMsg(t('تعذّر تحميل البيانات'), e.message));
    }
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

    async function runDelete(path, successMsg, errorMsg) {
      const confirmBtn = actionsCell.querySelector('.btn-danger');
      if (confirmBtn) confirmBtn.disabled = true;
      try {
        await api(path, { method: 'DELETE' });
        toast(successMsg, 'success');
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
          const res = await api('/api/admin/notifications', {
            method: 'POST',
            body: { title, body: bodyText },
          });
          titleInput.value = '';
          bodyInput.value = '';
          showPush(res && res.push);
          toast('تم نشر الإشعار', 'success');
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
          el('div', { class: 'panel-head' }, ico('bell'), 'نشر إشعار جديد'),
          el('div', { class: 'form' },
            el('div', { class: 'field' },
              el('label', null, 'عنوان الإشعار'),
              titleInput,
            ),
            el('div', { class: 'field' },
              el('label', null, 'النص'),
              bodyInput,
            ),
            el('div', { class: 'btn-row', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, publishBtn, testBtn, syncBtn),
            pushInfo,
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
    const card = el('div', { class: 'req-card' });
    const dismissBtn = el('button', { class: 'btn btn-sm btn-secondary', onclick: async () => {
      dismissBtn.disabled = true;
      try { await api(`/api/admin/requests/${r.id}`, { method: 'DELETE' }); card.remove(); toast('تم الحذف', 'success'); }
      catch { dismissBtn.disabled = false; toast('تعذّر الحذف', 'error'); }
    } }, ico('trash'), 'حذف');

    card.append(
      el('div', { class: 'req-top' },
        el('span', { class: `req-badge ${isUpdate ? 'update' : 'report'}` }, isUpdate ? 'طلب تحديث' : 'بلاغ'),
        el('strong', null, r.app_name || r.slug),
        el('span', { class: 'tab-spacer' }),
        el('a', { class: 'btn btn-sm btn-secondary', href: `/app?slug=${encodeURIComponent(r.slug)}`, target: '_blank' }, ico('external'), 'عرض'),
        dismissBtn,
      ),
      el('div', { class: 'req-meta' }, r.ts ? formatDate(r.ts) : ''),
    );

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
  async function renderAppsList(body, kind) {
    kind = kind === 'game' ? 'game' : 'app';
    const isGame = (a) => a.type === 'game';
    const noun = kind === 'game' ? 'لعبة' : 'تطبيق';
    body.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    try {
      const { apps: allApps } = await api('/api/admin/apps');
      const apps = allApps.filter((a) => kind === 'game' ? isGame(a) : !isGame(a));
      body.innerHTML = '';
      const state = { q: '', cat: '', sort: 'downloads', selected: new Set() };

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
        const list = visible();
        countEl.textContent = `${list.length} / ${apps.length}`;
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
                    await api(`/api/admin/apps/${a.id}`, { method: 'DELETE' });
                    logAdminAction(`حذف «${a.name}»`);
                    toast('تم الحذف', 'success'); renderApp();
                  } catch { toast('فشل الحذف', 'error'); }
                } }, ico('trash'), 'حذف'),
              )),
            );
          })),
        );
        tableWrap.append(table);
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
      searchInput.addEventListener('input', () => { state.q = searchInput.value; renderTable(); });
      catSel.addEventListener('change', () => { state.cat = catSel.value; renderTable(); });
      sortSel.addEventListener('change', () => { state.sort = sortSel.value; renderTable(); });

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

    const apkDz = dropzone({ accept: '.apk', label: 'اسحب أو اختر ملف APK' });
    const iconDz = dropzone({ accept: 'image/*', label: 'اختر أيقونة (PNG/JPG)' });
    const featDz = dropzone({ accept: 'image/*', label: 'اختر صورة عرضية (يفضّل 1024×500)' });
    const ssDz = dropzone({ accept: 'image/*', multiple: true, label: 'اختر لقطات الشاشة (متعددة)' });
    const ve = videoEditor({ videos: [], slugHint: 'video', onAdd: (v) => v, onDelete: () => true });

    const form = el('form', { class: 'form', onsubmit: async (e) => {
      e.preventDefault();
      const apkFiles = apkDz.getFiles();
      if (!apkFiles.length) { toast('يجب رفع ملف APK', 'error'); return; }
      const data = Object.fromEntries(new FormData(form).entries());
      const submitBtn = form.querySelector('button[type=submit]');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '';
      submitBtn.append(el('div', { class: 'spinner', style: 'width:18px; height:18px; border-width:2px;' }));

      try {
        const slugHint = (data.name || 'app').slice(0, 60);

        // Upload APK first
        toast('بدء رفع الملفات…');
        const apk_key = await r2Upload(apkFiles[0], 'apk', slugHint, (r) => apkDz.setProgress(0, r));
        let icon_key = null;
        const iconFiles = iconDz.getFiles();
        if (iconFiles.length) icon_key = await r2Upload(iconFiles[0], 'icon', slugHint, (r) => iconDz.setProgress(0, r));
        let feature_key = null;
        const featFiles = featDz.getFiles();
        if (featFiles.length) feature_key = await r2Upload(featFiles[0], 'feature', slugHint, (r) => featDz.setProgress(0, r));
        const screenshot_keys = [];
        const ssFiles = ssDz.getFiles();
        for (let i = 0; i < ssFiles.length; i++) {
          const k = await r2Upload(ssFiles[i], 'screenshot', slugHint, (r) => ssDz.setProgress(i, r));
          screenshot_keys.push(k);
        }

        const payload = {
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
          apk_key,
          icon_key,
          feature_key,
          screenshot_keys,
          videos: ve.getVideos(),
        };
        const res = await api('/api/admin/apps', { method: 'POST', body: payload });
        toast('تم رفع التطبيق بنجاح', 'success');
        activeTab = `edit:${res.id}`;
        renderApp();
      } catch (err) {
        toast(t('فشل الرفع') + ': ' + (err.message || ''), 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '';
        submitBtn.append(ico('upload'), document.createTextNode('رفع التطبيق'));
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
        el('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { activeTab = 'apps'; renderApp(); } }, 'إلغاء'),
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
        try {
          await api(`/api/admin/apps/${id}`, { method: 'PATCH', body: data });
          toast('تم الحفظ', 'success');
        } catch (err) {
          toast('فشل الحفظ', 'error');
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
          const apk_key = await r2Upload(files[0], 'apk', app.slug, (r) => apkDz.setProgress(0, r));
          await api(`/api/admin/apps/${id}/apk`, {
            method: 'POST',
            body: { apk_key, version_name: vn || undefined, version_code: vc ? Number(vc) : undefined },
          });
          toast('تم تحديث APK', 'success');
          renderEditApp(body, id);
        } catch (err) { toast('فشل التحديث', 'error'); }
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
          const icon_key = await r2Upload(files[0], 'icon', app.slug, (r) => iconDz.setProgress(0, r));
          await api(`/api/admin/apps/${id}/icon`, { method: 'POST', body: { icon_key } });
          toast('تم تحديث الأيقونة', 'success');
          renderEditApp(body, id);
        } catch (err) { toast('فشل التحديث', 'error'); }
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
          const feature_key = await r2Upload(files[0], 'feature', app.slug, (r) => featDz.setProgress(0, r));
          await api(`/api/admin/apps/${id}/feature`, { method: 'POST', body: { feature_key } });
          toast('تم تحديث الصورة العرضية', 'success');
          renderEditApp(body, id);
        } catch (err) { toast('فشل التحديث', 'error'); }
      } });
      featForm.append(featDz, el('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, ico('upload'), 'حفظ الصورة العرضية'));
      body.append(el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('image'), 'الصورة العرضية (بطاقات اختيارات المحررين)'),
        app.feature_url ? el('img', { src: app.feature_url, style: 'width:100%; max-width:420px; aspect-ratio:1024/500; object-fit:cover; border-radius:16px; border:1px solid var(--line); margin-bottom:12px;' }) : null,
        featForm,
      ));

      // Screenshots
      const ssDz = dropzone({ accept: 'image/*', multiple: true, label: 'أضف لقطات جديدة' });
      const ssForm = el('form', { class: 'form', onsubmit: async (e) => {
        e.preventDefault();
        const files = ssDz.getFiles();
        if (!files.length) { toast('اختر صور', 'error'); return; }
        try {
          const screenshot_keys = [];
          for (let i = 0; i < files.length; i++) {
            const k = await r2Upload(files[i], 'screenshot', app.slug, (r) => ssDz.setProgress(i, r));
            screenshot_keys.push(k);
          }
          await api(`/api/admin/apps/${id}/screenshots`, { method: 'POST', body: { screenshot_keys } });
          toast('تمت الإضافة', 'success');
          renderEditApp(body, id);
        } catch (err) { toast('فشل الرفع', 'error'); }
      } });
      ssForm.append(ssDz, el('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, ico('upload'), 'إضافة لقطات'));
      const ssPanel = el('div', { class: 'panel' },
        el('div', { class: 'panel-head' }, ico('image'), 'لقطات الشاشة'),
      );
      if (screenshots.length) {
        const row = el('div', { class: 'screenshots' });
        screenshots.forEach((ss) => {
          const wrap = el('div', { style: 'position:relative; flex-shrink:0;' },
            ss.url ? el('img', { src: ss.url, style: 'max-height:180px; width:auto; max-width:320px; min-width:72px; object-fit:contain; background:var(--surface-2); border:1px solid var(--line); border-radius:8px;' }) : null,
            el('button', { class: 'btn btn-sm btn-danger', style: 'position:absolute; top:6px; inset-inline-end:6px;',
              onclick: async () => {
                if (!confirm('حذف هذه اللقطة؟')) return;
                try {
                  await api(`/api/admin/apps/${id}/screenshots/${ss.id}`, { method: 'DELETE' });
                  toast('تم الحذف', 'success');
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

      // YouTube videos / Shorts
      const ve = videoEditor({
        videos,
        slugHint: app.slug,
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
            await api(`/api/admin/apps/${id}`, { method: 'DELETE' });
            toast('تم الحذف', 'success');
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
        return await r2Upload(file, 'video-thumb', opts.slugHint || 'video', () => {});
      } catch { toast(t('فشل رفع الصورة المصغّرة'), 'error'); return null; }
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
  let gsChord = 0;
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault(); openCommandPalette(); return;
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
