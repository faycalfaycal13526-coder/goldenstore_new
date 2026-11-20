// App detail page — Google Play–style.
(function () {
  const S = window.Store;
  const { el, ico, api, getQuery, formatBytes, formatNum, formatCount, formatDate, ratingOf, toast } = S;
  // JS-generated UI (menus, dialogs, toasts, confirmations) must resolve
  // through the manual i18n dictionary instead of the MutationObserver-based
  // machine translator, so every string is translated immediately.
  const t = (source) => {
    try {
      return window.GSI18N && typeof window.GSI18N.t === 'function'
        ? window.GSI18N.t(source) : source;
    } catch { return source; }
  };
  const root = document.getElementById('root');
  S.bottomNav('');

  const slug = getQuery('slug');

  /* =====================================================================
     Review interactions — likes, reports and device-local hiding.
     The viewer id is the Firebase uid when signed in, otherwise a stable
     random id kept in localStorage so anonymous likes survive reloads.
     ===================================================================== */
  const HIDDEN_REVIEWS_KEY = 'gs_hidden_reviews';
  const VIEWER_ID_KEY = 'gs_review_viewer_id';
  const REVIEW_REPORT_REASONS = [
    { code: 'spam', label: () => t('رسائل مزعجة أو إعلانات') },
    { code: 'harassment', label: () => t('إساءة أو تحرش') },
    { code: 'hate', label: () => t('خطاب كراهية') },
    { code: 'inappropriate', label: () => t('محتوى غير لائق') },
    { code: 'misleading', label: () => t('معلومات مضللة أو احتيال') },
    { code: 'off_topic', label: () => t('محتوى خارج عن الموضوع') },
    { code: 'other', label: () => t('سبب آخر') },
  ];

  const pendingLikes = new Set();
  let reportDialogSeq = 0;
  let reviewsState = [];          // the array owned by ratingSection()
  let refreshReviewViews = () => {};
  let activeReviewMenu = null;

  function readStoredArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value.map(String) : [];
    } catch { return []; }
  }
  function writeStoredArray(key, values) {
    try { localStorage.setItem(key, JSON.stringify(values)); } catch {}
  }
  function hiddenReviewIds() { return new Set(readStoredArray(HIDDEN_REVIEWS_KEY)); }
  function setReviewHidden(id, hidden) {
    if (!id) return;
    const ids = hiddenReviewIds();
    if (hidden) ids.add(String(id)); else ids.delete(String(id));
    writeStoredArray(HIDDEN_REVIEWS_KEY, Array.from(ids));
  }
  function viewerId() {
    try {
      const user = S.getUser && S.getUser();
      if (user && user.uid) return String(user.uid).slice(0, 128);
    } catch {}
    let id = '';
    try { id = localStorage.getItem(VIEWER_ID_KEY) || ''; } catch {}
    if (!id) {
      const rand = (window.crypto && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID().replace(/-/g, '')
        : (Math.random().toString(36).slice(2) + Date.now().toString(36));
      id = 'gs_' + rand;
      try { localStorage.setItem(VIEWER_ID_KEY, id); } catch {}
    }
    return id;
  }

  /** Toast with an inline action (used to undo a locally hidden review). */
  function actionToast(message, actionLabel, onAction) {
    let stack = document.querySelector('.toast-stack');
    if (!stack) { stack = el('div', { class: 'toast-stack' }); document.body.append(stack); }
    const item = el('div', { class: 'toast toast-action' },
      el('span', null, message),
      el('button', {
        class: 'toast-action-btn', type: 'button',
        onclick: () => { clearTimeout(timer); item.remove(); onAction(); },
      }, actionLabel),
    );
    stack.append(item);
    const timer = setTimeout(() => {
      item.style.transition = 'opacity .2s, transform .2s';
      item.style.opacity = '0';
      item.style.transform = 'translateY(8px)';
      setTimeout(() => item.remove(), 200);
    }, 6000);
  }

  /** Keep every rendered copy of a review (page list + modal) in sync. */
  function applyReviewState(id, patch) {
    const idStr = String(id);
    const target = reviewsState.find((r) => String(r.id) === idStr);
    if (target) Object.assign(target, patch);
    const liked = !!(target && target.liked);
    const count = Math.max(0, Number((target && target.likes_count) || 0));
    document.querySelectorAll('.review[data-review-id]').forEach((card) => {
      if (card.getAttribute('data-review-id') !== idStr) return;
      const btn = card.querySelector('.review-like');
      if (!btn) return;
      const label = liked ? t('إزالة الإعجاب') : t('أعجبني');
      btn.classList.toggle('is-liked', liked);
      btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
      const counter = btn.querySelector('.review-like-count');
      if (counter) counter.textContent = formatNum(count);
      btn.classList.remove('pop');
      void btn.offsetWidth;
      btn.classList.add('pop');
    });
  }

  async function toggleReviewLike(r) {
    const id = r && r.id ? String(r.id) : '';
    if (!id || pendingLikes.has(id)) return;
    const previous = { liked: !!r.liked, likes_count: Number(r.likes_count) || 0 };
    const optimistic = {
      liked: !previous.liked,
      likes_count: Math.max(0, previous.likes_count + (previous.liked ? -1 : 1)),
    };
    pendingLikes.add(id);
    applyReviewState(id, optimistic);
    try {
      // The token (when signed in) lets the API know the real viewer account, so
      // a like can never notify its own author. Tapping the like is never
      // blocked by this: if the token call fails we retry anonymously.
      const likePath = `/api/apps/${encodeURIComponent(slug)}/reviews/${encodeURIComponent(id)}/like`;
      let res;
      try {
        res = await S.authedApi(likePath, { method: 'POST', body: { userId: viewerId() } });
      } catch (authErr) {
        res = await api(likePath, { method: 'POST', body: { userId: viewerId() } });
      }
      applyReviewState(id, {
        liked: !!res.liked,
        likes_count: Math.max(0, Number(res.likes_count) || 0),
      });
    } catch {
      applyReviewState(id, previous);
      toast(t('تعذّر تسجيل الإعجاب، حاول مجدداً'), 'error');
    } finally {
      pendingLikes.delete(id);
    }
  }

  /* Owner question: «لماذا الإعجاب على تعليقي لا يعمل؟».
     A like is delivered as a notification to the review's AUTHOR, which needs
     that author to have an account. Reviews written without signing in cannot
     receive one, so the composer states it plainly instead of failing silently. */
  /* Round 41 — a single «you need an account» gate for likes, ratings and
     comments. Native app: the bridge has its own session, so nothing is asked. */
  /* Round 42: remember what the visitor was trying to do while the sign-in sheet
     was open, and finish it once the account exists. */
  let pendingAccountAction = null;

  async function requireAccountFor(what, retry) {
    /* Round 42e (owner): «يجب التسجيل كي تقييم وتعلّق» — the same rule inside the
       Android app. The APK has its own Google sign-in through the bridge, and a
       signed-in user is a real Firebase user, so `isLoggedIn()` is the truth
       everywhere; a guest is asked to sign in there too. */
    try { if (S.isLoggedIn && S.isLoggedIn()) return true; } catch (e) {}
    toast(t('سجّل الدخول أولاً لتستطيع') + ' ' + what, 'info');
    if (typeof retry === 'function') pendingAccountAction = retry;
    try {
      await S.requireAuth();
      pendingAccountAction = null;      // handled by the auth listener above
      return true;
    } catch (e) {
      pendingAccountAction = null;
      return false;
    }
  }

  function likeHintNode() {
    let signed = false;
    try { signed = !!(S.isLoggedIn && S.isLoggedIn()); } catch (e) { signed = false; }
    if (signed) return null;
    return el('div', { class: 'rate-like-hint' },
      ico('bell', 'icon icon-sm'),
      el('span', null, t('ستصلك إشعارات الإعجابات بتعليقك عندما تسجّل الدخول قبل النشر.')),
    );
  }

  function openReviewMenu(wrap, btn, list) {
    closeReviewMenu();
    // Flip upwards when there is not enough room below (review lists and
    // the "all reviews" sheet are scrollable containers).
    const rect = btn.getBoundingClientRect();
    wrap.classList.toggle('drop-up', window.innerHeight - rect.bottom < 220);
    wrap.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    activeReviewMenu = { wrap, btn, list };
    const first = list.querySelector('button');
    if (first) setTimeout(() => first.focus(), 0);
  }
  function closeReviewMenu() {
    if (!activeReviewMenu) return;
    activeReviewMenu.wrap.classList.remove('open', 'drop-up');
    activeReviewMenu.btn.setAttribute('aria-expanded', 'false');
    activeReviewMenu = null;
  }
  document.addEventListener('click', (e) => {
    if (activeReviewMenu && !activeReviewMenu.wrap.contains(e.target)) closeReviewMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeReviewMenu(); return; }
    if (!activeReviewMenu || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const items = Array.from(activeReviewMenu.list.querySelectorAll('button'));
    if (!items.length) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown'
      ? (idx + 1) % items.length
      : (idx <= 0 ? items.length - 1 : idx - 1);
    items[next].focus();
  });

  function hideReview(r) {
    if (!r || !r.id) return;
    setReviewHidden(r.id, true);
    refreshReviewViews();
    actionToast(t('تم إخفاء المراجعة على هذا الجهاز'), t('تراجع'), () => {
      setReviewHidden(r.id, false);
      refreshReviewViews();
    });
  }
  function restoreHiddenReviews() {
    const ids = hiddenReviewIds();
    reviewsState.forEach((r) => { if (r.id) ids.delete(String(r.id)); });
    writeStoredArray(HIDDEN_REVIEWS_KEY, Array.from(ids));
    refreshReviewViews();
    toast(t('تمت استعادة المراجعات المخفية'), 'success');
  }

  function openReportReviewModal(r) {
    if (!r || !r.id) { toast(t('تعذّر الإبلاغ عن هذه المراجعة'), 'error'); return; }
    let selected = '';
    const radioName = `gs-report-reason-${++reportDialogSeq}`;
    const overlay = el('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) close(); } });
    const errLine = el('div', { class: 'dialog-err' });
    const reasonList = el('div', { class: 'report-reasons', role: 'radiogroup', 'aria-label': t('سبب البلاغ') });
    const radios = [];
    REVIEW_REPORT_REASONS.forEach((reason) => {
      const input = el('input', { type: 'radio', name: radioName, class: 'report-reason-input', value: reason.code });
      input.addEventListener('change', () => { selected = reason.code; errLine.textContent = ''; });
      radios.push(input);
      reasonList.append(el('label', { class: 'report-reason' },
        input,
        el('span', { class: 'report-radio', 'aria-hidden': 'true' }),
        el('span', { class: 'report-reason-label' }, reason.label()),
      ));
    });
    const preview = el('div', { class: 'report-review-preview' },
      el('div', { class: 'report-preview-head' },
        ico('message', 'icon icon-sm'),
        el('strong', null, r.name || t('مستخدم')),
      ),
      r.comment ? el('div', { class: 'report-preview-text' }, String(r.comment).slice(0, 240)) : null,
    );
    const submitLabel = el('span', null, t('إرسال البلاغ'));
    const submitBtn = el('button', { class: 'btn btn-danger', type: 'button' }, ico('flag', 'icon icon-sm'), submitLabel);
    submitBtn.addEventListener('click', async () => {
      if (!selected) {
        errLine.textContent = t('اختر سبب البلاغ');
        if (radios[0]) radios[0].focus();
        return;
      }
      submitBtn.disabled = true;
      submitLabel.textContent = t('جاري الإرسال...');
      errLine.textContent = '';
      try {
        const res = await api(`/api/apps/${encodeURIComponent(slug)}/reviews/${encodeURIComponent(String(r.id))}/report`, {
          method: 'POST', body: { userId: viewerId(), reason: selected },
        });
        close();
        toast(res && res.duplicate ? t('لقد أبلغت عن هذه المراجعة مسبقاً') : t('تم إرسال البلاغ بنجاح'),
          res && res.duplicate ? 'info' : 'success');
      } catch {
        submitBtn.disabled = false;
        submitLabel.textContent = t('إرسال البلاغ');
        errLine.textContent = t('حدث خطأ أثناء إرسال البلاغ');
      }
    });
    const card = el('div', {
      class: 'dialog-card report-dialog', dir: document.documentElement.dir || 'rtl',
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-report-title',
    },
      el('div', { class: 'dialog-head' },
        el('div', { class: 'dialog-title', id: 'gs-report-title' }, ico('flag', 'icon'), t('الإبلاغ عن المراجعة')),
        el('button', { class: 'dialog-close', type: 'button', 'aria-label': t('إغلاق'), onclick: () => close() }, ico('close')),
      ),
      el('div', { class: 'dialog-body' },
        preview,
        el('div', { class: 'dialog-field' },
          el('span', { class: 'dialog-label' }, t('سبب البلاغ'), el('b', { class: 'req' }, ' *')),
          reasonList,
        ),
        errLine,
      ),
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'btn btn-secondary', type: 'button', onclick: () => close() }, t('إلغاء')),
        submitBtn,
      ),
    );
    overlay.append(card);
    function close() { overlay.remove(); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);
    document.body.append(overlay);
    if (radios[0]) setTimeout(() => radios[0].focus(), 0);
  }

  function isNativeApp() {
    return !!(window.GSAndroid && typeof window.GSAndroid.downloadApk === 'function');
  }

  const apkStateHandlers = Object.create(null);
  /* Set while the Android system installer («هل تريد تثبيت التطبيق؟») is open.
     On decline we must NOT let the store hub delete the downloaded APK state. */
  const installPromptBySlug = Object.create(null);
  function markInstallPrompt(slug, filename) { if (slug) installPromptBySlug[slug] = filename || ''; }
  function clearInstallPrompt(slug) { if (slug) delete installPromptBySlug[slug]; }
  function hasInstallPrompt(slug) { return !!(slug && Object.prototype.hasOwnProperty.call(installPromptBySlug, slug)); }
  function installPromptFilename(slug) { return hasInstallPrompt(slug) ? installPromptBySlug[slug] : ''; }

  const storeApkHandler = window.__gsApkDownloadUpdate;
  window.__gsApkDownloadUpdate = function (slug, status, progress, message) {
    let hubStatus = status, hubProgress = progress;
    const missing = status === 'failed' && message === 'file_missing';
    // A declined/failed INSTALL is not a cancelled DOWNLOAD: keep the file.
    // EXCEPT file_missing: that APK was deleted and must be forgotten.
    if (slug && slug !== 'app-update' && hasInstallPrompt(slug)
        && (status === 'cancelled' || (status === 'failed' && !missing))) {
      hubStatus = 'downloaded'; hubProgress = 1;
    }
    if (typeof storeApkHandler === 'function') storeApkHandler(slug, hubStatus, hubProgress, message);
    const h = apkStateHandlers[slug];
    if (h) h(status, (typeof progress === 'number' ? progress : -1), message);
  };

  function sdkName(sdk) {
    const map = { 21: '5.0', 22: '5.1', 23: '6.0', 24: '7.0', 25: '7.1', 26: '8.0', 27: '8.1', 28: '9', 29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15' };
    return map[sdk] || (sdk ? `SDK ${sdk}` : '—');
  }

  /* ===================================================================
     Screenshots — large orientation-aware cards + full-screen lightbox.
     Gesture-only viewer: hand swipe / mouse drag, X to close, backdrop and
     keyboard. No counter, no bottom hint line, no thumbnail strip.
     New control labels are translated here (not via lang.js) so en/fr/es
     keep working while lang.js stays untouched.
     =================================================================== */
  const GALLERY_I18N = {
    'معرض لقطات الشاشة': { en: 'Screenshots', fr: 'Captures d’écran', es: 'Capturas de pantalla' },
    'تعذّر تحميل الصورة': { en: 'Could not load image', fr: 'Impossible de charger l’image', es: 'No se pudo cargar la imagen' },
  };
  function gt(ar) {
    let lang = 'ar';
    try { lang = (window.GSI18N && window.GSI18N.lang) || 'ar'; } catch {}
    if (lang === 'ar') return ar;
    const local = GALLERY_I18N[ar] && GALLERY_I18N[ar][lang];
    return local || t(ar);
  }

  let closeActiveGallery = null;

  function openGallery(urls, startIndex, trigger, labelOverride) {
    const list = (Array.isArray(urls) ? urls : []).filter((u) => typeof u === 'string' && u.trim());
    if (!list.length) return;
    if (closeActiveGallery) closeActiveGallery();
    const label = typeof labelOverride === 'string' && labelOverride.trim()
      ? labelOverride : gt('معرض لقطات الشاشة');
    let index = Math.max(0, Math.min(Number(startIndex) || 0, list.length - 1));
    const prevFocus = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    let closed = false;
    // Mouse-drag state. lastDragAt suppresses the synthetic click browsers
    // fire after a drag, so a swipe never accidentally closes the lightbox.
    let dragStartX = null, dragStartY = null, dragged = false, lastDragAt = 0;

    const img = el('img', { class: 'lb-image', alt: '', draggable: 'false' });
    const errLine = el('div', { class: 'lb-error' });
    const stage = el('div', { class: 'lb-stage' }, img, errLine);
    const closeBtn = el('button', {
      class: 'lb-close', type: 'button',
      'aria-label': t('إغلاق'), title: t('إغلاق'),
      onclick: () => close(),
    }, ico('close', 'icon'));
    const overlay = el('div', {
      class: 'gs-lightbox', role: 'dialog', 'aria-modal': 'true',
      'aria-label': label, tabindex: '-1',
      onclick: (e) => {
        if (Date.now() - lastDragAt < 300) return;
        if (e.target === overlay || e.target === stage) close();
      },
    },
      closeBtn,
      stage,
    );

    function preload(i) {
      [i - 1, i + 1].forEach((j) => {
        const u = list[(j + list.length) % list.length];
        if (!u) return;
        try { const pre = new Image(); pre.src = u; } catch {}
      });
    }

    function show(i) {
      index = (i + list.length) % list.length;
      img.classList.remove('is-ready');
      errLine.textContent = '';
      img.alt = `${label} — ${index + 1} / ${list.length}`;
      img.onload = () => img.classList.add('is-ready');
      img.onerror = () => {
        img.classList.remove('is-ready');
        img.removeAttribute('src');
        errLine.textContent = gt('تعذّر تحميل الصورة');
      };
      img.src = list[index];
      // A cached image (or re-selecting the same thumbnail) may not fire a
      // second load event — reveal it immediately in that case.
      if (img.complete && img.naturalWidth) img.classList.add('is-ready');
      // Position is exposed as data attributes for assistive tech and tests,
      // but there is no visible counter, bottom line or thumbnail strip.
      overlay.dataset.index = String(index + 1);
      overlay.dataset.total = String(list.length);
      preload(index);
    }

    function go(step) { if (list.length > 1) show(index + step); }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'Tab') {
        const focusables = [closeBtn];
        if (!focusables.length) return;
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    // Touch swipe (mobile): horizontal gestures navigate, vertical ones scroll.
    let sx = null, sy = null;
    stage.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (sx == null || !e.changedTouches || !e.changedTouches.length) return;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      sx = null; sy = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) go(dx < 0 ? 1 : -1);
    }, { passive: true });

    // Desktop: a normal press-and-drag with the mouse navigates images.
    // Touch/pen pointers are left to the touch handlers above (no double nav).
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || (e.button != null && e.button !== 0)) return;
      dragStartX = e.clientX; dragStartY = e.clientY; dragged = false;
      stage.classList.add('is-dragging');
      if (e.pointerId != null && typeof stage.setPointerCapture === 'function') {
        try { stage.setPointerCapture(e.pointerId); } catch {}
      }
    });
    stage.addEventListener('pointermove', (e) => {
      if (dragStartX == null) return;
      if (Math.abs(e.clientX - dragStartX) > 8) dragged = true;
    });
    stage.addEventListener('pointerup', (e) => {
      if (dragStartX == null) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      dragStartX = null; dragStartY = null;
      stage.classList.remove('is-dragging');
      if (dragged) lastDragAt = Date.now();
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) go(dx < 0 ? 1 : -1);
    });
    stage.addEventListener('pointercancel', () => {
      dragStartX = null; dragStartY = null; stage.classList.remove('is-dragging');
    });

    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      document.body.style.overflow = prevOverflow;
      if (closeActiveGallery === close) closeActiveGallery = null;
      const target = (trigger && trigger.focus) ? trigger : prevFocus;
      if (target && typeof target.focus === 'function') { try { target.focus(); } catch {} }
    }

    document.addEventListener('keydown', onKey, true);
    document.body.style.overflow = 'hidden';
    document.body.append(overlay);
    closeActiveGallery = close;
    show(index);
    try { overlay.focus(); } catch {}
  }

  // Backwards-compatible single-image entry point.
  function openModal(src) { openGallery([src], 0); }

  /* -------------------------------------------------------------------
     YouTube videos / Shorts — Play Store-style thumbnails inside the very
     same swipeable strip as the screenshots, plus an inline player with an
     explicit "open on YouTube" link. Only a validated 11-char id is used.
     ------------------------------------------------------------------- */
  function safeVideoId(v) {
    const id = String((v && v.video_id) || '');
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
  }
  function videoThumb(id) { return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`; }
  // A custom thumbnail uploaded from the admin panel wins; otherwise fall
  // back to YouTube's own poster. Both are drawn with the same card CSS.
  function videoThumbSrc(v, id) {
    const custom = v && typeof v.thumb_url === 'string' && /^https?:\/\//i.test(v.thumb_url)
      ? v.thumb_url.trim() : '';
    return custom || videoThumb(id);
  }

  function openVideo(v, trigger) {
    const id = safeVideoId(v);
    if (!id) return;
    if (closeActiveGallery) closeActiveGallery();
    const isShort = !!(v && v.kind === 'short');
    const label = isShort ? t('شورت يوتيوب') : t('فيديو يوتيوب');
    const prevOverflow = document.body.style.overflow;
    const prevFocus = document.activeElement;
    let closed = false;
    const frame = el('iframe', {
      class: 'gs-video-frame',
      src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`,
      title: label,
      allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
      allowfullscreen: 'true',
      referrerpolicy: 'strict-origin-when-cross-origin',
      loading: 'eager',
    });
    const stage = el('div', { class: `gs-video-stage${isShort ? ' is-short' : ''}` }, frame);
    const openLink = el('a', {
      class: 'gs-video-open',
      href: (v && v.url) || (isShort ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`),
      target: '_blank', rel: 'noopener noreferrer nofollow',
    }, ico('external', 'icon icon-sm'), t('فتح في يوتيوب'));
    const closeBtn = el('button', {
      class: 'gs-video-close', type: 'button',
      'aria-label': t('إغلاق'), title: t('إغلاق'), onclick: () => close(),
    }, ico('close', 'icon'));
    const overlay = el('div', {
      class: 'gs-video-modal', role: 'dialog', 'aria-modal': 'true',
      'aria-label': label, tabindex: '-1',
      onclick: (e) => { if (e.target === overlay) close(); },
    },
      closeBtn,
      stage,
      el('div', { class: 'gs-video-bar' }, openLink),
    );
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') {
        const first = closeBtn, last = openLink;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      document.body.style.overflow = prevOverflow;
      if (closeActiveGallery === close) closeActiveGallery = null;
      const target = (trigger && trigger.focus) ? trigger : prevFocus;
      if (target && typeof target.focus === 'function') { try { target.focus(); } catch {} }
    }
    document.addEventListener('keydown', onKey, true);
    document.body.style.overflow = 'hidden';
    document.body.append(overlay);
    closeActiveGallery = close;
    try { overlay.focus(); } catch {}
  }

  function renderScreenshots(screenshots, videos = []) {
    const urls = (screenshots || []).map((x) => (x && x.url) || '').filter(Boolean);
    const safeVideos = (videos || []).filter((v) => safeVideoId(v));
    const shots = el('div', {
      class: 'shots', role: 'list',
      'aria-label': safeVideos.length ? t('الفيديوهات واللقطات') : t('لقطات الشاشة'),
    });

    // Play Store puts the video before the stills. Every video card carries
    // the SAME .shot-card class as the stills, so it has the identical width,
    // height, corners, background, hover, focus, snap and object-fit rules.
    // A regular video takes the LANDSCAPE screenshot class (16:9 / 1280x720),
    // a Short takes the PORTRAIT screenshot class (9:16). The thumbnail is a
    // .shot-img too, so it inherits exactly the same fill/letterbox treatment
    // as the corresponding screenshot — including a custom uploaded poster.
    safeVideos.forEach((v, vi) => {
      const id = safeVideoId(v);
      const isShort = v.kind === 'short';
      const orient = isShort ? 'is-portrait' : 'is-landscape';
      const kindLabel = isShort ? t('شورت يوتيوب') : t('فيديو يوتيوب');
      const img = el('img', {
        class: 'shot-img gs-video-thumb', src: videoThumbSrc(v, id), alt: '',
        draggable: 'false', decoding: 'async', loading: vi < 2 ? 'eager' : 'lazy',
        'data-thumb': v.thumb_url ? 'custom' : 'youtube',
        'data-orient': isShort ? 'portrait' : 'landscape',
      });
      // The thumbnail carries ONLY the play triangle. All type/platform
      // badges (YouTube logo, «شورت» pill, title strip) were intentionally
      // removed; a11y metadata stays on the button/iframe instead.
      const card = el('button', {
        class: `shot-card gs-video-card is-${isShort ? 'short' : 'video'} ${orient}`,
        type: 'button', role: 'listitem',
        'aria-label': v.title ? `${kindLabel} — ${v.title}` : kindLabel,
        onclick: () => openVideo(v, card),
      },
        img,
        el('span', { class: 'gs-video-play', 'aria-hidden': 'true' }, ico('play', 'icon')),
      );
      img.addEventListener('error', () => card.classList.add('is-error'));
      shots.append(card);
    });

    urls.forEach((url, i) => {
      const img = el('img', {
        class: 'shot-img', src: url, alt: '', draggable: 'false', decoding: 'async',
        loading: i < 2 ? 'eager' : 'lazy',
      });
      const card = el('button', {
        class: 'shot-card', type: 'button', role: 'listitem',
        'aria-label': `${t('لقطات الشاشة')} ${i + 1} / ${urls.length}`,
        onclick: () => openGallery(urls, i, card),
      },
        img,
        el('span', { class: 'shot-zoom', 'aria-hidden': 'true' }, ico('image', 'icon icon-sm')),
      );
      function orient() {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) return;
        const ratio = w / h;
        card.classList.remove('is-portrait', 'is-landscape', 'is-square');
        card.classList.add(ratio >= 1.15 ? 'is-landscape' : ratio <= 0.85 ? 'is-portrait' : 'is-square');
      }
      img.addEventListener('load', orient);
      img.addEventListener('error', () => card.classList.add('is-error'));
      if (img.complete && img.naturalWidth) orient();
      shots.append(card);
    });
    return el('div', { class: 'd-section' }, shots);
  }

  async function getFingerprint() {
    const parts = [];
    try {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
      const ctx = cv.getContext('2d'); ctx.textBaseline = 'top'; ctx.font = '14px Arial';
      ctx.fillStyle = '#f60'; ctx.fillRect(50, 0, 100, 30);
      ctx.fillStyle = '#069'; ctx.fillText('GoldenStore\uD83D\uDE00fp', 2, 4);
      parts.push(cv.toDataURL());
    } catch { parts.push('no-canvas'); }
    parts.push(`${screen.width}x${screen.height}x${screen.colorDepth}`);
    parts.push(String(navigator.hardwareConcurrency || 0));
    parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    parts.push(navigator.language || '');
    parts.push(navigator.platform || '');
    const raw = parts.join('|||');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  S.ready(async () => {
    root.innerHTML = '';

    const menuBtn = el('button', { class: 'icon-btn', 'aria-label': t('مشاركة'), onclick: () => share(app) }, ico('share'));
    const nav = S.topbarNav('', [menuBtn]);
    root.append(nav);
    const content = el('div', { class: 'detail' });
    root.append(content);
    content.append(S.skeletonDetail());

    // Professional share sheet: preview, copyable link, native OS share and a
    // safe "open link" action. Built lazily so it never touches page load.
    function share(a) {
      const origin = (window.Store && window.Store.publicOrigin) ? window.Store.publicOrigin() : null;
      const slugValue = (a && a.slug) ? a.slug : slug;
      /* Owner request (round 34): the shared link is the APP PAGE, not the
         internal `/api/apps/<slug>/download` endpoint — a person receiving the
         link now lands on the clean detail page (icon, name, install button)
         and downloads from there. */
      const pageUrl = (() => {
        const base = origin || location.origin;
        return slugValue ? `${base}/app?slug=${encodeURIComponent(slugValue)}` : `${base}/`;
      })();
      const url = pageUrl;
      const name = (a && a.name) || 'Golden Store';
      const isGame = !!(a && a.type === 'game');
      const payload = {
        title: name,
        // Wording matches the kind: a game is never called «تطبيق».
        text: isGame
          ? `${t('العبها الآن من Golden Store')} — ${name}`
          : `${t('حمّل التطبيق الآن من Golden Store')} — ${name}`,
        url, pageUrl, icon: (a && a.icon_url) || '',
        kind: isGame ? 'game' : 'app',
      };
      if (window.GSShare && typeof window.GSShare.open === 'function') {
        window.GSShare.open(payload);
      } else if (isNativeApp() && window.GSAndroid) {
        /* Round 42d: inside the app there is no navigator.share — without this
           the share button did nothing at all. */
        const txt = payload.text + '\n' + url;
        let shared = false;
        for (const fn of ['shareText', 'share', 'shareUrl', 'shareLink']) {
          try { if (typeof window.GSAndroid[fn] === 'function') { window.GSAndroid[fn](txt, payload.title); shared = true; break; } } catch (e) {}
        }
        if (!shared) { try { window.GSAndroid.openExternal(url); shared = true; } catch (e) {} }
        if (!shared) toast(t('انسخ الرابط من شريط العنوان'), 'info');
      } else if (navigator.share) {
        navigator.share({ title: payload.title, text: payload.text, url }).catch(() => {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url); toast(t('تم نسخ الرابط'), 'success');
      }
    }

    if (!slug) { content.innerHTML = ''; content.append(S.emptyState(t('لا يوجد تطبيق محدد'), t('الرابط غير صحيح.'), 'info')); return; }

    let app, screenshots, videos;
    try {
      const data = await api(`/api/apps/${encodeURIComponent(slug)}`);
      app = data.app; screenshots = data.screenshots || []; videos = data.videos || [];
    } catch (e) {
      content.innerHTML = '';
      const errTitle = (e && (e.status === 0 || e.message === 'timeout')) ? t('تعذّر الاتصال بالخادم') : t('التطبيق غير موجود');
      content.append(S.emptyState(errTitle, t('تأكد من الرابط أو عُد للرئيسية.'), 'info'),
        el('div', { style: { textAlign: 'center', marginTop: '16px' } }, el('a', { class: 'btn btn-primary', href: '/' }, t('العودة للرئيسية'))));
      return;
    }

    document.title = `${S.appName(app)} — Golden Store`;
    nav.querySelector('.title') && (nav.querySelector('.title').textContent = '');
    content.innerHTML = '';

    const iconInner = app.icon_url ? el('img', { src: app.icon_url, alt: S.appName(app) }) : ico('package', 'icon icon-lg');
    const iconBtn = app.icon_url ? el('button', {
      class: 'd-icon is-zoomable', type: 'button',
      'aria-label': t('اضغط لتكبير صورة التطبيق'), title: t('اضغط لتكبير صورة التطبيق'),
      onclick: () => {
        const media = [app.icon_url, app.feature_url].filter(Boolean);
        openGallery(media, 0, iconBtn, t('صورة التطبيق'));
      },
    }, iconInner) : el('div', { class: 'd-icon' }, iconInner);
    content.append(el('div', { class: 'd-head' },
      iconBtn,
      el('div', { class: 'd-titles' },
        el('div', { class: 'd-name', 'data-i18n-app': app.name }, S.appName(app)),
        el('div', { class: 'd-dev' }, app.developer || S.STORE.name),
        el('div', { class: 'd-sub' }, S.categoryName(app.category) || S.STORE.name),
      ),
    ));

    const rt = ratingOf(app);
    content.append(el('div', { class: 'd-stats' },
      stat(rt ? el('span', null, rt, ico('star', 'icon fill')) : el('span', null, '—'), t('تقييمات')),
      stat(formatCount(app.downloads), t('تنزيلات'), 'gs-download-stat d-stat-downloads'),
      stat(formatBytes(app.size_bytes || 0), t('الحجم')),
      stat(sdkName(app.min_sdk), t('أندرويد')),
    ));

    content.append(installControl(app));
    content.append(el('div', { class: 'd-note' }, t('سيتم تنزيل ملف APK') + ` (${formatBytes(app.size_bytes || 0)}). ` + t('فعّل «تثبيت من مصادر غير معروفة» لإكمال التثبيت.')));

    if (screenshots.length || videos.length) content.append(renderScreenshots(screenshots, videos));

    if (app.short_description || app.description) {
      content.append(el('div', { class: 'd-section' },
        el('h3', null, t('لمحة عن هذا التطبيق')),
        el('div', { class: 'd-desc' }, app.description || app.short_description),
      ));
    }

    const createdAt = Number(app.created_at) || 0;
    const updatedAt = Number(app.updated_at) || 0;
    const dateChip = (createdAt || updatedAt)
      ? (updatedAt > createdAt
          ? el('span', { class: 'chip' }, t('آخر تحديث') + ' ' + formatDate(updatedAt))
          : el('span', { class: 'chip' }, t('تاريخ النشر') + ' ' + formatDate(createdAt)))
      : null;
    content.append(el('div', { class: 'chip-row' },
      app.category ? el('span', { class: 'chip' }, S.categoryName(app.category)) : null,
      el('span', { class: 'chip' }, t('الإصدار') + ' ' + (app.version_name || '—')),
      dateChip,
    ));

    content.append(ratingSection(app));

    loadSimilar(app, content);

    function stat(value, label, extraClass) {
      const v = el('div', { class: 'v' });
      if (value && value.nodeType) v.append(value); else v.textContent = value;
      return el('div', { class: `d-stat${extraClass ? ' ' + extraClass : ''}` },
        v, el('div', { class: 'l' }, label));
    }
  });

  async function loadSimilar(app, container) {
    const simTitle = app.type === 'game' ? t('ألعاب مماثلة') : t('تطبيقات مماثلة');
    const section = el('div', { class: 'd-section' },
      el('h3', null, simTitle),
      S.skeletonSimilar(),
    );
    container.append(section);
    try {
      const catParam = app.category ? `&category=${encodeURIComponent(app.category)}` : '';
      const typeParam = app.type ? `&type=${encodeURIComponent(app.type)}` : '';
      const res = await api(`/api/apps?limit=20${catParam}${typeParam}&sort=popular`);
      const similar = (res.apps || []).filter((a) => a.slug !== app.slug).slice(0, 10);
      if (!similar.length) { section.remove(); return; }
      const row = el('div', { class: 'hrow' });
      similar.forEach((a) => row.append(S.posterCard(a)));
      section.innerHTML = '';
      const href = `/more?section=similar&type=${app.type === 'game' ? 'game' : 'app'}`
        + `${app.category ? `&category=${encodeURIComponent(app.category)}` : ''}&exclude=${encodeURIComponent(app.slug)}`;
      section.append(
        el('a', { class: 'd-section-head section-link', href, 'aria-label': `${simTitle} — ${t('عرض المزيد')}` },
          el('h3', null, simTitle),
          el('span', { class: 'more', 'aria-hidden': 'true' }, ico('chevronStart', 'icon')),
        ),
        row,
      );
    } catch (e) {
      section.remove();
    }
  }

  function starBar(value) {
    const wrap = el('div', { class: 'rate-static', style: { marginTop: '4px' } });
    const rounded = Math.round(Number(value) || 0);
    for (let i = 1; i <= 5; i++) wrap.append(el('span', { class: `star ${i <= rounded ? 'on' : ''}` }, i <= rounded ? '★' : '☆'));
    return wrap;
  }

  function distRow(starN, c, total) {
    const pct = total > 0 ? Math.round((c / total) * 100) : 0;
    return el('div', { class: 'row' },
      el('span', { class: 'lbl' }, String(starN)),
      el('div', { class: 'bar' }, el('span', { style: { width: pct + '%' } })),
    );
  }

  function reviewCard(r) {
    const review = r || {};
    const id = review.id ? String(review.id) : '';
    /* Round 41: a review row is «interactive» for a signed-in visitor (or in the
       native app). A guest can still READ everything; tapping like opens the
       sign-in gate instead of doing nothing. */
    let signedIn = false;
    try { if (S.isLoggedIn && S.isLoggedIn()) signedIn = true; } catch (e) {}
    const canInteract = !!id && signedIn;
    const initial = ((review.name || 'م').trim().charAt(0) || 'م').toUpperCase();
    const stars = el('div', { class: 'stars' });
    const rt = Math.round(Number(review.rating) || 0);
    for (let i = 1; i <= 5; i++) stars.append(el('span', { class: `star ${i <= rt ? 'on' : ''}` }, i <= rt ? '★' : '☆'));
    const avatar = el('div', { class: 'avatar' });
    if (review.photo_url) avatar.append(el('img', { src: review.photo_url, alt: '', referrerpolicy: 'no-referrer' }));
    else avatar.textContent = initial;

    const liked = !!review.liked;
    const likeLabel = liked ? t('إزالة الإعجاب') : t('أعجبني');
    /* Round 41 (owner): «إذا المستخدم لم يسجل لا يستطيع التعليق ولا التقييم ولا
       الإعجاب» — a guest gets ONE clear invitation to sign in instead of a
       button that silently does nothing (the old `disabled`). */
    const likeBtn = el('button', {
      class: `review-like${liked ? ' is-liked' : ''}${canInteract ? '' : ' is-guest'}`,
      type: 'button',
      'aria-pressed': liked ? 'true' : 'false',
      'aria-label': likeLabel,
      title: likeLabel,
      onclick: () => {
        if (!canInteract) { requireAccountFor(t('الإعجاب'), () => toggleReviewLike(review)); return; }
        toggleReviewLike(review);
      },
    },
      ico('heart', 'icon icon-sm'),
      el('span', { class: 'review-like-count' }, formatNum(Number(review.likes_count) || 0)),
    );

    const menuWrap = el('div', { class: 'review-menu' });
    const menuBtn = el('button', {
      class: 'review-menu-btn', type: 'button',
      'aria-label': t('خيارات المراجعة'), title: t('خيارات المراجعة'),
      'aria-haspopup': 'menu', 'aria-expanded': 'false',
      disabled: canInteract ? null : 'disabled',
    }, ico('moreVert', 'icon icon-sm'));
    const menuList = el('div', { class: 'review-menu-list', role: 'menu' },
      el('button', {
        class: 'review-menu-item', type: 'button', role: 'menuitem',
        onclick: () => { closeReviewMenu(); openReportReviewModal(review); },
      }, ico('flag', 'icon icon-sm'), el('span', null, t('الإبلاغ عن المراجعة'))),
      el('button', {
        class: 'review-menu-item', type: 'button', role: 'menuitem',
        onclick: () => { closeReviewMenu(); hideReview(review); },
      }, ico('close', 'icon icon-sm'),
        el('span', null, t('إخفاء المراجعة'), el('small', null, t('على هذا الجهاز فقط')))),
    );
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeReviewMenu && activeReviewMenu.wrap === menuWrap) closeReviewMenu();
      else openReviewMenu(menuWrap, menuBtn, menuList);
    });
    menuWrap.append(menuBtn, menuList);

    return el('div', { class: 'review', 'data-review-id': id },
      el('div', { class: 'head' },
        avatar,
        el('div', { class: 'who' },
          el('div', { class: 'nm' }, review.name || t('مستخدم')),
          el('div', { class: 'dt' }, formatDate(review.ts)),
        ),
        menuWrap,
      ),
      stars,
      review.comment ? el('div', { class: 'body' }, review.comment) : null,
      el('div', { class: 'review-actions' }, likeBtn),
    );
  }

  const isInstalled = (slug) => S.isInstalledStored(slug);
  const markInstalledStored = (slug) => S.markInstalledStored(slug);
  const unmarkInstalledStored = (slug) => S.unmarkInstalledStored(slug);

  function openDialog({ icon, title, fields, submitLabel, onSubmit }) {
    const overlay = el('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) close(); } });
    const inputs = {};
    const body = el('div', { class: 'dialog-body' });
    fields.forEach((f) => {
      const lbl = el('label', { class: 'dialog-field' },
        el('span', { class: 'dialog-label' }, f.label, f.required ? el('b', { class: 'req' }, ' *') : null));
      let input;
      if (f.type === 'textarea') input = el('textarea', { class: 'field', rows: '3', placeholder: f.placeholder || '', maxlength: f.maxlength || '2000' });
      else if (f.type === 'select') {
        input = el('select', { class: 'field' });
        (f.options || []).forEach((o) => input.append(el('option', { value: o }, o)));
      } else input = el('input', { class: 'field', type: 'text', placeholder: f.placeholder || '', maxlength: f.maxlength || '200', value: f.value || '', disabled: f.readonly ? true : false });
      inputs[f.key] = input;
      lbl.append(input);
      body.append(lbl);
    });

    const submitBtn = el('button', { class: 'btn btn-primary' }, ico(icon, 'icon'), submitLabel);
    const errLine = el('div', { class: 'dialog-err' });
    submitBtn.addEventListener('click', async () => {
      const values = {};
      for (const f of fields) values[f.key] = (inputs[f.key].value || '').trim();
      for (const f of fields) {
        if (f.required && !values[f.key]) { errLine.textContent = t('يرجى ملء الحقول المطلوبة'); inputs[f.key].focus(); return; }
      }
      submitBtn.disabled = true; errLine.textContent = '';
      try { await onSubmit(values); close(); toast(t('تم إرسال طلبك إلى الإدارة'), 'success'); }
      catch (e) { submitBtn.disabled = false; errLine.textContent = t('تعذّر الإرسال، حاول مجدداً'); }
    });

    const card = el('div', { class: 'dialog-card', dir: document.documentElement.dir || 'rtl' },
      el('div', { class: 'dialog-head' },
        el('div', { class: 'dialog-title' }, ico(icon, 'icon'), title),
        el('button', { class: 'dialog-close', 'aria-label': t('إغلاق'), onclick: () => close() }, ico('close')),
      ),
      body,
      errLine,
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'btn btn-secondary', onclick: () => close() }, t('إلغاء')),
        submitBtn,
      ),
    );
    overlay.append(card);
    function close() { overlay.remove(); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);
    document.body.append(overlay);
  }

  function openRequestUpdate(app) {
    openDialog({
      icon: 'refresh', title: t('طلب تحديث'), submitLabel: t('إرسال الطلب'),
      fields: [
        { key: 'current', label: t('الإصدار الحالي'), value: app.version_name || '—', readonly: true },
        { key: 'new_version', label: t('الإصدار الجديد'), required: true, placeholder: t('مثال: 2.5.1'), maxlength: '60' },
        { key: 'source', label: t('رابط المصدر'), placeholder: t('مثال: https://play.google.com/...'), maxlength: '500' },
      ],
      onSubmit: (v) => api(`/api/apps/${encodeURIComponent(app.slug)}/request-update`, {
        method: 'POST', body: { new_version: v.new_version, source: v.source },
      }),
    });
  }

  function openReport(app) {
    openDialog({
      icon: 'flag', title: t('إبلاغ عن التطبيق'), submitLabel: t('إرسال البلاغ'),
      fields: [
        { key: 'reason', label: t('سبب البلاغ'), required: true, type: 'select',
          options: [t('التطبيق فيه فيروس'), t('رابط التحميل لا يعمل'), t('محتوى غير لائق'), t('انتهاك حقوق نشر'), t('معلومات خاطئة'), t('سبب آخر')] },
        { key: 'details', label: t('تفاصيل إضافية'), type: 'textarea', placeholder: t('اشرح المشكلة…'), maxlength: '2000' },
      ],
      onSubmit: (v) => api(`/api/apps/${encodeURIComponent(app.slug)}/report`, {
        method: 'POST', body: { reason: v.reason, details: v.details },
      }),
    });
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename, style: { display: 'none' } });
    document.body.append(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 30000);
  }

  function fallbackDownload(slug) {
    const a = el('a', { href: `/api/apps/${encodeURIComponent(slug)}/download`, download: '', style: { display: 'none' } });
    document.body.append(a);
    a.click();
    setTimeout(() => a.remove(), 30000);
  }

  function installControl(app) {
    const label = el('span', { class: 'install-label', 'data-noi18n': '' }, t('تثبيت'));
    const fill = el('span', { class: 'install-fill' });
    const btn = el('button', { class: 'btn btn-primary btn-lg install-btn', type: 'button' }, fill, label);

    // تعريف group و cancelBtn أولاً لتجنب الخطأ
    const group = el('div', { class: 'install-group' }, btn);
    // Local, stable anchor: resolveInstallState() may run BEFORE this wrapper
    // is attached to .detail. Never use .detail.prepend() as a fallback —
    // that put the «تثبيت / حذف الملف» bar above the app icon (the glitch).
    const actionsWrap = el('div', { class: 'd-actions' }, group);
    let pendingActionsBar = null;
    const cancelBtn = el('button', {
      class: 'btn btn-secondary btn-lg download-cancel-btn hidden',
      type: 'button',
      'aria-label': t('إلغاء التنزيل'),
      title: t('إلغاء التنزيل'),
    }, ico('close', 'icon icon-sm'));
    group.append(cancelBtn);

    let nativeActiveDownloadRegistered = false;
    let activeDownloadController = null;
    let activeStreamReader = null;
    let cancelRequested = false;
    let nativeLeaveHandler = null;
    let nativeDownloadFinished = false;
    let fileMissingRetries = 0;
    let autoRestartInProgress = false;
    /* «تحديث التطبيق» means: download the new APK AND open the system
       installer by itself. Without this the button only produced a download
       counter and the user never got the install prompt. */
    let updateIntent = false;
    let lastLaunchAt = 0;
    let launchInFlight = false;
    function clearNativeLeaveHandler() {
      if (nativeLeaveHandler) {
        try { window.removeEventListener('pagehide', nativeLeaveHandler); } catch (e) {}
        nativeLeaveHandler = null;
      }
    }

    function setCancelVisible(visible) {
      group.classList.toggle('split-active', visible);
      cancelBtn.classList.toggle('hidden', !visible);
      if (visible) cancelBtn.disabled = false;
    }

    /* The X must react to the FIRST tap. Some Android WebViews swallow the
       synthetic `click` on an element that sits inside a flex bar (or the tap
       lands on the label underneath), so it listens to `pointerup`/`touchend`
       as well — with one shared debounce — and there is a delegated document
       fallback right after the control is created. */
    let lastCancelAt = 0;
    function onCancelTap(e) {
      if (e && e.cancelable) { try { e.preventDefault(); } catch (err) {} }
      const now = Date.now();
      if (now - lastCancelAt < 350) return;
      lastCancelAt = now;
      handleCancelDownload();
    }
    cancelBtn.addEventListener('pointerup', onCancelTap);
    cancelBtn.addEventListener('touchend', onCancelTap, { passive: false });
    cancelBtn.addEventListener('click', onCancelTap);
    const onDocCancelClick = (e) => {
      const t2 = e && e.target;
      if (!t2 || !t2.closest) return;
      const hit = t2.closest('.download-cancel-btn');
      if (!hit || hit !== cancelBtn) return;
      if (cancelBtn.classList.contains('hidden')) return;
      onCancelTap(e);
    };
    document.addEventListener('click', onDocCancelClick, true);

    function handleCancelDownload() {
      if (cancelBtn.disabled || cancelBtn.classList.contains('hidden')) return;
      cancelBtn.disabled = true;
      cancelRequested = true;
      updateIntent = false;
      clearInstallPrompt(app.slug);
      cancelBtn.classList.add('hidden');
      // Abort ONLY this slug's controller/reader; other concurrent downloads
      // (other apps/games, other tabs) are untouched.
      try { S.abortWebDownload(app.slug); } catch (e) {}
      try { S.cancelDownload(app.slug); } catch (e) {}
      removeInstalledActions();
      showIdle();
      toast(t('تم إلغاء التنزيل'), 'info');
    }

    // Exactly the SAME bar/label as a normal download — an update must not
    // look like a different, confusing control.
    function setProgress(ratio) {
      const v = normProgress(ratio);
      if (v < 0) return;
      // Monotonic: a late/partial bridge value (0.02 after 0.60) can no longer
      // drag the bar back or scramble the number.
      displayedProgress = Math.max(displayedProgress, v);
      const pct = Math.round(displayedProgress * 100);
      btn.classList.remove('indeterminate');
      fill.style.transition = 'width .15s linear';
      fill.style.width = pct + '%';
      label.textContent = `${t('جارٍ التنزيل…')} ${pct}%`;
      // The dedicated update bar (if shown) mirrors the same value.
      paintUpdateBar(pct);
    }
    function setIndeterminate() {
      btn.classList.add('indeterminate');
      label.textContent = t('جارٍ التنزيل…');
    }
    /* The Android bridge may report progress as 0..1 OR as 0..100 — mixing the
       two made the numbers jump wildly (4500%). Everything is normalised to
       0..1 here, and the painted value is MONOTONIC: it can only grow. */
    let displayedProgress = 0;
    function normProgress(p) {
      const n = Number(p);
      if (!isFinite(n) || n < 0) return -1;
      if (n > 1.5) return Math.max(0, Math.min(1, n / 100));   // percentage
      return Math.max(0, Math.min(1, n));
    }
    /* Even when the bridge (or a streamed response without Content-Length)
       sends no progress, the bar must never look frozen: it creeps smoothly
       toward 95%, and real progress always wins — never backwards. */
    let creepTimer = null;
    let creepValue = 0;
    let lastRealProgressAt = 0;
    /* The bridge repeats the SAME percentage while it waits for the network.
       That used to refresh the «real progress» timestamp forever, so the clock
       creep never took over and the bar froze (the reported 46 % stall). Now
       only an ADVANCING value counts as real progress. */
    let lastRealValue = 0;
    let dlStartedAt = 0;
    /* Round 41 — «يتوقف شريط التنزيل ويتجمّد العداد في 49».
       The creep clock used to start at the TAP, so the ~10 s advertisement was
       already counted as download time: by the time the transfer began the bar
       sat at ~45–50 %, and the honest cap (last real value + 12 points) kept it
       there forever → a frozen 49 %. The clock is now armed only when the real
       transfer starts, and a long silence refreshes that cap. */
    let transferStartedAt = 0;
    function markTransferStart() {
      if (!transferStartedAt) transferStartedAt = Date.now();
      dlStartedAt = Date.now();
    }
    function armDownloadClock() {
      transferStartedAt = 0;
      dlStartedAt = 0;
    }
    function stopCreep() {
      if (creepTimer) { clearInterval(creepTimer); creepTimer = null; }
    }
    /* TIME-BASED counting: the value is derived from the elapsed time since the
       tap, not from the number of ticks. Timers are paused while the Android
       WebView shows the ad in another app, so on return the bar is already at
       the right position instead of restarting from zero. */
    function creepFromClock() {
      if (!dlStartedAt || !transferStartedAt) return 0;
      const elapsed = Math.max(0, (Date.now() - dlStartedAt) / 1000);
      return Math.min(0.95, 0.01 + elapsed * 0.045);   // ~21s to 95%
    }
    function startCreep(from) {
      stopCreep();
      const base = Math.max(0, Math.min(0.94, Number(from) || 0));
      // A new download starts its own clock; a resume keeps the old one.
      // A zero clock means «transfer not started yet» (the ad is playing).
      if (base <= 0.02 && dlStartedAt) dlStartedAt = Date.now();
      creepValue = Math.max(base, creepFromClock());
      if (creepValue <= 0) setProgress(0.01);
      creepTimer = setInterval(() => {
        if (!btn.classList.contains('installing')) { stopCreep(); return; }
        const clock = creepFromClock();
        const silent = Date.now() - lastRealProgressAt;
        // Real progress owns the number while it keeps advancing.
        if (silent < 2000) {
          if (clock > creepValue + 0.05) creepValue = clock;
          return;
        }
        // Silence: move forward at a steady, visible pace — but stay honest.
        // The cap grows with the silence (12 points for a short hiccup, up to
        // 45 after ~20 s of nothing), otherwise a stalled bridge froze the bar
        // at exactly «last real value + 12» (the reported 49 %).
        const silentSec = silent / 1000;
        const headroom = lastRealValue > 0 ? Math.min(0.45, 0.12 + silentSec * 0.0125) : 0.95;
        const cap = Math.min(0.97, lastRealValue + headroom);
        const step = lastRealValue > 0 ? creepValue + 0.012 : Math.max(creepValue + 0.012, clock);
        const nextVal = Math.min(cap, step);
        if (nextVal <= creepValue + 0.0005) return;
        creepValue = nextVal;
        setProgress(creepValue);
      }, 250);
    }
    function noteRealProgress(p) {
      const v = normProgress(p);
      if (v < 0) return;
      // Only an ADVANCE is real news: a repeated identical value means the
      // bridge is stalled, so the clock creep must be allowed to take over.
      if (v > lastRealValue + 0.0005) {
        lastRealValue = v;
        lastRealProgressAt = Date.now();
      }
      if (v > creepValue) creepValue = v;
      if (v > displayedProgress) displayedProgress = v;
    }
    function resetBar() {
      stopCreep();
      creepValue = 0;
      displayedProgress = 0;
      lastRealValue = 0;
      lastRealProgressAt = 0;
      dlStartedAt = 0;
      transferStartedAt = 0;      // round 41: a reset means «no transfer yet»
      btn.classList.remove('installing', 'indeterminate');
      fill.style.transition = 'none';
      fill.style.width = '0%';
    }
    function showInstalled(mode = 'open') {
      removeInstalledActions();
      setCancelVisible(false);
      resetBar();
      btn.disabled = false;
      label.innerHTML = '';
      if (mode === 'update') {
        btn.classList.remove('installed');
        btn.classList.add('has-update');
        label.append(ico('refresh', 'icon'), document.createTextNode(t('تحديث')));
      } else {
        btn.classList.remove('has-update');
        btn.classList.add('installed');
        // Same version already on the phone: one direct «فتح» action.
        label.append(ico('play', 'icon'), document.createTextNode(t('فتح')));
      }
    }

    function realPackage(a) {
      return (S.resolvedPackageName && S.resolvedPackageName(a.slug)) || a.package_name || '';
    }
    function openInstalled(a) {
      if (isNativeApp() && window.GSAndroid && typeof window.GSAndroid.openInstalledApp === 'function') {
        try { window.GSAndroid.openInstalledApp(realPackage(a), a.slug || ''); return; } catch (e) {}
      }
      toast(t('تعذّر فتح التطبيق'), 'error');
    }
    function uninstallInstalled(a) {
      if (isNativeApp() && window.GSAndroid && typeof window.GSAndroid.uninstallApp === 'function') {
        try {
          const pkg = realPackage(a);
          window.GSAndroid.uninstallApp(pkg, a.slug || '');
          let checks = 0;
          const poll = setInterval(() => {
            checks++;
            if (checks > 60) { clearInterval(poll); return; }
            const st = S.checkAppStatus ? S.checkAppStatus(a.slug, pkg) : null;
            if (st && !st.installed) {
              clearInterval(poll);
              unmarkInstalledStored(a.slug);
              const oldFile = (S.getApkState(a.slug) || {}).filename || '';
              S.removeApkState(a.slug);
              S.removeActiveDownload(a.slug);
              clearInstallPrompt(a.slug);
              // A REAL uninstall means the app is gone: blue «تثبيت» from scratch.
              // Do NOT blacklist the slug, otherwise the fresh download's
              // finished state would be pruned again («ملف التحميل مفقود»).
              if (S.clearDeletedApk) S.clearDeletedApk(a.slug);
              if (oldFile) purgeNativeApk(oldFile, a.slug);
              removeInstalledActions();
              showIdle();
              toast(t('تم إلغاء تثبيت التطبيق'), 'info');
            }
          }, 500);
          return;
        } catch (e) {}
      }
      toast(t('غير متاح في هذا المتصفح'), 'info');
    }
    /* The bridge may expose the installer under several names depending on the
       APK build. Always ASK FOR AN INSTALL (never «open app»), so an update is
       really installed over the older copy that is already on the phone. */
    function launchInstaller(a, filename) {
      const bridge = window.GSAndroid || {};
      const fn = String(filename || '');
      const args = [fn, a.slug || '', a.package_name || ''];
      const methods = ['installDownloadedApk', 'installApk', 'installDownloadedFile', 'openDownloadedApk'];
      for (let i = 0; i < methods.length; i++) {
        const name = methods[i];
        if (typeof bridge[name] === 'function') {
          try { bridge[name](args[0], args[1], args[2]); return name; } catch (e) {}
        }
      }
      return '';
    }
    let installWatchdog = null;
    function clearInstallWatchdog() {
      if (installWatchdog) { clearTimeout(installWatchdog); installWatchdog = null; }
    }
    /* If the system installer never reports back, never leave the user on a
       bare download bar: restore the explicit Install/Delete bar. */
    function armInstallWatchdog(a, file) {
      clearInstallWatchdog();
      installWatchdog = setTimeout(() => {
        installWatchdog = null;
        const st = S.getApkState(a.slug) || {};
        const busy = (S.hasInFlightApk && S.hasInFlightApk(a.slug))
          || st.status === 'installing';
        if (busy) return;
        restoreReadyToInstall(file, { toast: t('لم يُفتح مثبّت النظام، اضغط تثبيت'), kind: 'error' });
      }, 6000);
    }
    /* «تحديث» must look EXACTLY like a normal download: the two buttons
       (تحديث / إلغاء التثبيت) disappear and the one progress bar with the X
       takes their place — immediately, on the tap, before anything async. */
    /* A DEDICATED, self-contained update bar: everything else is hidden and
       only this element is shown. It uses inline styles (so no stylesheet rule
       can hide it or steal the taps) and owns its own cancel button. */
    let updateBarEl = null, updateFillEl = null, updateLabelEl = null;
    /* TRUE from the tap until the update flow really ends. While it is set the
       background state refresh (focus/visibility/heartbeat → resolveInstallState
       → showIdle) is NOT allowed to tear the bar down — that was removing the
       bar a few milliseconds after the tap, which is why it never showed and
       why the X died (its element had been replaced). */
    let updateFlowActive = false;
    function removeUpdateBar() {
      if (updateBarEl && updateBarEl.parentNode) updateBarEl.parentNode.removeChild(updateBarEl);
      updateBarEl = null; updateFillEl = null; updateLabelEl = null;
    }
    function paintUpdateBar(pct, text) {
      if (!updateFillEl) return;
      const v = Math.max(0, Math.min(100, Math.round(pct)));
      updateFillEl.style.width = v + '%';
      if (updateLabelEl) updateLabelEl.textContent = text || `${t('جارٍ التنزيل…')} ${v}%`;
    }
    let lastUpdateXTap = 0;
    function onUpdateXTap(e) {
      if (e && e.cancelable) { try { e.preventDefault(); } catch (err) {} }
      const now = Date.now();
      if (now - lastUpdateXTap < 400) return;
      lastUpdateXTap = now;
      cancelUpdateFlow();
    }
    /* Redundant trigger for «تحديث» itself: the delegated listener runs in the
       capture phase BEFORE the button's own onclick, so the update always
       starts even if that inline handler was lost or swallowed. The launch
       guard (`launchInFlight`, 250ms) makes the second call a no-op. */
    document.addEventListener('click', (e) => {
      const tg = e && e.target;
      if (!tg || !tg.closest) return;
      if (!tg.closest('.gs-action-update')) return;
      updateIntent = true;
      runInstall({ update: true });
    }, true);
    // ONE delegated listener for the whole page (capture phase), so a tap is
    // caught even when the WebView swallows the event on the button itself.
    document.addEventListener('click', (e) => {
      const tg = e && e.target;
      if (!tg || !tg.closest) return;
      if (tg.closest('#gs-update-x')) onUpdateXTap(e);
    }, true);
    document.addEventListener('touchend', (e) => {
      const tg = e && e.target;
      if (!tg || !tg.closest) return;
      if (tg.closest('#gs-update-x')) onUpdateXTap(e);
    }, true);
    function cancelUpdateFlow() {
      cancelRequested = true;
      updateFlowActive = false;
      closeInAppAd();
      clearInstallWatchdog();
      stopCreep();
      try { S.abortWebDownload(app.slug); } catch (e) {}
      try { S.cancelDownload(app.slug); } catch (e) {}
      S.removeApkState(app.slug);
      S.removeActiveDownload(app.slug);
      clearInstallPrompt(app.slug);
      removeUpdateBar();
      // back to the «تحديث / إلغاء التثبيت» pair
      setTimeout(() => { try { resolveInstallState(); } catch (e) {} }, 0);
      toast(t('تم إلغاء التنزيل'), 'info');
    }
    function showUpdateBar() {
      // Hide EVERYTHING that is currently in the action area.
      removeInstalledActions();
      const existing = document.getElementById('gs-installed-actions');
      if (existing) existing.remove();
      actionsWrap.style.display = 'none';
      removeUpdateBar();

      const mk = (tag, css, txt) => {
        const n = document.createElement(tag);
        if (css) n.setAttribute('style', css);
        if (txt) n.textContent = txt;
        return n;
      };
      const fillEl = mk('span', 'position:absolute;inset-inline-start:0;top:0;bottom:0;width:0%;'
        + 'background:rgba(255,255,255,.28);transition:width .2s linear;z-index:0;border-radius:inherit');
      const labelEl = mk('span', 'position:relative;z-index:2;color:#fff;font-size:15px;font-weight:700;'
        + 'pointer-events:none;display:inline-flex;align-items:center;justify-content:center;flex:1 1 auto;'
        + 'padding:0 14px;font-variant-numeric:tabular-nums', `${t('جارٍ التنزيل…')} 0%`);
      const xBtn = mk('button', 'position:relative;z-index:9;pointer-events:auto;display:flex;align-items:center;'
        + 'justify-content:center;width:58px;min-width:58px;height:48px;background:transparent;border:0;'
        + 'border-inline-start:2px solid rgba(255,255,255,.28);color:#fff;font-size:0;cursor:pointer;'
        + 'border-radius:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation');
      xBtn.type = 'button';
      xBtn.id = 'gs-update-x';
      xBtn.setAttribute('aria-label', t('إلغاء التنزيل'));
      xBtn.appendChild(ico('close', 'icon'));
      const barEl = mk('div', 'position:relative;display:flex;align-items:stretch;width:100%;height:48px;'
        + 'min-height:48px;max-height:48px;background:#2b7de9;border-radius:999px;overflow:hidden;'
        + 'margin-top:10px;box-shadow:0 4px 14px rgba(43,125,233,.35);direction:inherit');
      barEl.id = 'gs-update-bar';
      barEl.appendChild(fillEl);
      barEl.appendChild(labelEl);
      barEl.appendChild(xBtn);

      const anchor = actionsWrap.parentNode;
      if (anchor) anchor.insertBefore(barEl, actionsWrap.nextSibling);
      else {
        const det = document.querySelector('.detail') || document.body;
        det.appendChild(barEl);
      }
      updateBarEl = barEl; updateFillEl = fillEl; updateLabelEl = labelEl;

      xBtn.addEventListener('pointerup', onUpdateXTap);
      xBtn.addEventListener('touchend', onUpdateXTap, { passive: false });
      xBtn.addEventListener('click', onUpdateXTap);

      paintUpdateBar(0);
      startCreep(0);
    }
    function beginUpdateUi() { showUpdateBar(); }
    /* The APK is already on the phone (or just finished): keep the SAME bar at
       100% and ask the bridge to INSTALL it over the installed copy. */
    function installWithBar(a, file) {
      const fn = String(file || '');
      markInstallPrompt(a.slug, fn);
      S.setApkState(a.slug, {
        slug: a.slug, status: 'installing', progress: 1, filename: fn,
        updated_at: Math.floor(Date.now() / 1000),
      });
      beginUpdateUi();
      setProgress(1);
      const used = launchInstaller(a, fn);
      if (!used) {
        clearInstallPrompt(a.slug);
        restoreReadyToInstall(fn, { toast: t('تعذّر فتح الملف'), kind: 'error' });
        return;
      }
      armInstallWatchdog(a, fn);
      toast(t('جارٍ فتح مثبّت النظام…'), 'info');
    }
    function openDownloadedApk(a, filename) {
      if (isNativeApp() && window.GSAndroid) {
        try {
          // Immediately show ONLY the downloaded-actions bar (no big split
          // button behind the system dialog), and remember we are in the prompt.
          markInstallPrompt(a.slug, filename || '');
          showDownloadedActions(a, filename);
          const used = launchInstaller(a, filename);
          if (!used) { clearInstallPrompt(a.slug); toast(t('تعذّر فتح الملف'), 'error'); return; }
          armInstallWatchdog(a, filename);
          toast(t('جارٍ فتح مثبّت النظام…'), 'info');
        } catch (e) {
          clearInstallPrompt(a.slug);
          toast(t('تعذّر فتح الملف'), 'error');
        }
        return;
      }
      toast(t('غير متاح في هذا المتصفح'), 'info');
    }
    /* The Android side keeps its own «downloaded» record. Deleting the file
       from the phone (or with «حذف الملف») must therefore also purge that
       record and blacklist the filename, otherwise every later tap reopens a
       file that no longer exists and ends in «ملف التحميل مفقود». */
    function purgeNativeApk(filename, slug) {
      const fn = String(filename || '');
      if (fn && S.markDeadApkFile) S.markDeadApkFile(fn);
      if (!isNativeApp()) return;
      ['deleteDownloadedApk', 'deleteDownloadedFile', 'removeDownloadedApk', 'clearDownloadState']
        .forEach((name) => {
          const bridge = window.GSAndroid;
          if (bridge && typeof bridge[name] === 'function') {
            try { bridge[name](fn, slug || ''); } catch (e) {}
          }
        });
    }
    function isDeadFilename(fn) {
      return !!(fn && S.isDeadApkFile && S.isDeadApkFile(fn));
    }
    function deleteDownloadedApk(a, filename) {
      const fn = String(filename || '');
      if (fn && S.markDeadApkFile) S.markDeadApkFile(fn);
      if (isNativeApp() && window.GSAndroid && typeof window.GSAndroid.deleteDownloadedApk === 'function') {
        try { window.GSAndroid.deleteDownloadedApk(fn, a.slug || ''); } catch (e) {}
      }
    }
    /* Place the secondary bar exactly where the main install button lives.
       If the wrapper is not in the DOM yet (synchronous resolveInstallState),
       defer by one microtask instead of prepending to .detail. */
    function placeActionsBar(bar, after) {
      pendingActionsBar = bar;
      const insert = () => {
        if (pendingActionsBar !== bar) return;
        const parent = actionsWrap.parentNode;
        if (!parent) return;
        actionsWrap.style.display = 'none';
        if (after) parent.insertBefore(bar, actionsWrap.nextSibling);
        else parent.insertBefore(bar, actionsWrap);
        pendingActionsBar = null;
        if (!after) {
          const det = document.querySelector('.detail');
          if (det) det.classList.add('gs-downloaded-mode');
        }
      };
      if (actionsWrap.parentNode) insert();
      else Promise.resolve().then(insert);
    }
    function showInstalledActions(a, opts = {}) {
      if (!isNativeApp()) return;
      removeUpdateBar();
      removeInstalledActions();
      const bar = el('div', { class: 'installed-actions', id: 'gs-installed-actions' });
      if (opts.withOpen !== false) {
        bar.append(el('button', { class: 'btn btn-primary btn-lg gs-action-open', type: 'button', onclick: () => openInstalled(a) },
          ico('play', 'icon'), t('فتح')));
      } else {
        // Older build on the device: the user must get BOTH actions —
        // «تحديث التطبيق» (installs the new APK) and «إلغاء التثبيت».
        // Leaving only the uninstall button stranded the update.
        bar.append(el('button', { class: 'btn btn-primary btn-lg gs-action-update', type: 'button', onclick: () => { updateIntent = true; runInstall({ update: true }); } },
          ico('refresh', 'icon'), t('تحديث')));
      }
      bar.append(el('button', { class: 'btn btn-secondary btn-lg gs-action-uninstall', type: 'button', onclick: () => uninstallInstalled(a) },
        ico('trash', 'icon'), t('إلغاء التثبيت')));
      placeActionsBar(bar, true);
    }
    function showDownloadedActions(a, filename) {
      setCancelVisible(false);
      removeUpdateBar();
      if (!isNativeApp()) return;
      removeInstalledActions();
      const bar = el('div', { class: 'installed-actions', id: 'gs-installed-actions' },
        el('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => openDownloadedApk(a, filename) },
          ico('download', 'icon'), t('تثبيت')),
        el('button', { class: 'btn btn-secondary btn-lg', type: 'button', onclick: () => {
          deleteDownloadedApk(a, filename);
          if (S.markDeletedApk) S.markDeletedApk(a.slug);
          S.removeApkState(a.slug);
          S.removeActiveDownload(a.slug);
          clearInstallPrompt(a.slug);
          removeInstalledActions(); showIdle();
          toast(t('تم حذف ملف التحميل'), 'info');
        } },
          ico('trash', 'icon'), t('حذف الملف')),
      );
      placeActionsBar(bar, false);
    }
    function removeInstalledActions() {
      const existing = document.getElementById('gs-installed-actions');
      if (existing) existing.remove();
      pendingActionsBar = null;
      const det = document.querySelector('.detail');
      if (det) det.classList.remove('gs-downloaded-mode');
      setCancelVisible(false);
      actionsWrap.style.display = '';
    }
    function showIdle(opts) {
      if (!updateFlowActive) removeUpdateBar();
      removeInstalledActions();
      setCancelVisible(false);
      resetBar();
      btn.classList.remove('installed', 'has-update');
      btn.disabled = false;
      label.textContent = t('تثبيت');
      // The download button must ALWAYS come back in the normal PRIMARY blue —
      // a grey CTA after «إلغاء التثبيت» was reported as a bug, so any leftover
      // neutral styling is cleared explicitly here.
      btn.classList.remove('gs-btn-grey');
      group.classList.remove('gs-grey');
    }

    /* A deleted APK leaves a stale «downloaded» filename behind. Drop it,
       mark it deleted so native snapshots cannot resurrect it, and re-download
       once automatically instead of showing a dead تثبيت button. */
    function handleMissingFile() {
      if (cancelRequested) return;
      const deadFile = installPromptFilename(app.slug)
        || (S.getApkState(app.slug) || {}).filename || filename;
      clearInstallPrompt(app.slug);
      // Forget the file on BOTH sides (web state + Android record) and never
      // reuse that filename again, so the missing-file loop cannot repeat.
      purgeNativeApk(deadFile, app.slug);
      if (S.markDeletedApk) S.markDeletedApk(app.slug);
      S.removeApkState(app.slug);
      S.removeActiveDownload(app.slug);
      removeInstalledActions();
      showIdle();
      if (fileMissingRetries >= 1) {
        toast(t('ملف التحميل مفقود.'), 'error');
        return;
      }
      fileMissingRetries++;
      toast(t('ملف التحميل مفقود، بدأ تنزيل جديد…'), 'info');
      autoRestartInProgress = true;
      // fresh:true forces a brand-new download instead of reopening the very
      // file we just proved to be gone.
      Promise.resolve().then(() => { try { runInstall({ fresh: true }); } catch (e) {} });
    }

    /* One deterministic state after a declined install: the APK is still
       downloaded, the big button is hidden, and only Install/Delete shows. */
    function restoreReadyToInstall(fn, opts) {
      const file = fn || installPromptFilename(app.slug)
        || (S.getApkState(app.slug) || {}).filename || filename;
      // Never restore a «ready to install» bar for a file we know is gone.
      if (isDeadFilename(file)) {
        purgeNativeApk(file, app.slug);
        S.removeApkState(app.slug);
        S.removeActiveDownload(app.slug);
        removeInstalledActions();
        showIdle();
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      S.setApkState(app.slug, {
        slug: app.slug, status: 'downloaded', progress: 1,
        filename: file, updated_at: now,
      });
      S.removeActiveDownload(app.slug);
      if (S.clearDeletedApk) S.clearDeletedApk(app.slug);
      clearInstallPrompt(app.slug);
      fileMissingRetries = 0;
      setCancelVisible(false);
      btn.classList.remove('installing', 'indeterminate');
      btn.disabled = false;
      setProgress(1);
      label.textContent = t('جاهز للتثبيت');
      showDownloadedActions(app, file);
      try { window.dispatchEvent(new CustomEvent('gs-apk-state', {
        detail: { slug: app.slug, status: 'downloaded', progress: 1, message: file },
      })); } catch (e) {}
      if (opts && opts.toast) toast(opts.toast, opts.kind || 'info');
    }

    apkStateHandlers[app.slug] = function (status, progress, message) {
      if (status === 'downloaded' || status === 'installed'
          || status === 'cancelled' || status === 'failed') {
        nativeDownloadFinished = true;
        clearNativeLeaveHandler();
      }
      if (status === 'downloading' || status === 'downloaded'
          || status === 'installed' || status === 'uninstalled') {
        clearInstallPrompt(app.slug);
      }
      if (status === 'installing' || status === 'installed'
          || status === 'cancelled' || status === 'failed') {
        clearInstallWatchdog();
      }
      const errMap = {
        signature_mismatch: t('تعارض توقيع الحزمة: ألغِ التطبيق المثبت ثم ثبّت النسخة الجديدة.'),
        package_mismatch: t('اسم الحزمة غير متطابق مع التطبيق.'),
        apk_parse_failed: t('تعذّر قراءة ملف APK.'),
        install_error: t('فشل التثبيت.'),
        file_missing: t('ملف التحميل مفقود.'),
      };
      if (status === 'downloading') {
        if (cancelRequested) return;
        // An update keeps its own dedicated bar on screen (nothing else shown).
        if (updateIntent && !updateBarEl) showUpdateBar();
        if (!updateIntent) setCancelVisible(true);
        btn.classList.add('installing');
        btn.disabled = true;
        if (!creepTimer) startCreep(typeof progress === 'number' ? progress : 0);
        noteRealProgress(progress);
        if (!nativeActiveDownloadRegistered) {
          S.setActiveDownload({
            slug: app.slug,
            name: app.name,
            icon_url: app.icon_url || null,
            developer: app.developer || '',
            size_bytes: app.size_bytes || 0,
            progress: progress >= 0 ? progress : 0,
            status: 'downloading',
            started_at: Math.floor(Date.now() / 1000),
          });
          nativeActiveDownloadRegistered = true;
        } else {
          S.updateActiveDownloadProgress(app.slug, progress);
        }
        if (normProgress(progress) >= 0) setProgress(progress);
        else if (!creepTimer) startCreep(displayedProgress);
        return;
      }
      if (status === 'downloaded') {
        stopCreep();
        updateFlowActive = false;
        if (isDeadFilename(message || filename)) { handleMissingFile(); return; }
        const autoInstall = updateIntent;
        updateIntent = false;
        fileMissingRetries = 0;
        if (S.clearDeletedApk) S.clearDeletedApk(app.slug);
        setCancelVisible(false);
        cancelRequested = false;
        setProgress(1);
        btn.classList.remove('installing');
        btn.disabled = false;
        label.textContent = t('جاهز للتثبيت');
        S.removeActiveDownload(app.slug);
        S.addToDownloadHistory(app);
        removeUpdateBar();
        // No Install/Delete flicker during a direct update: the progress bar
        // stays and the installer opens on top of it.
        if (!autoInstall) showDownloadedActions(app, message || filename);
        if (autoInstall) {
          // Direct update: the APK is ready, so open the system installer
          // ourselves (INSTALL over the old version) instead of waiting for a
          // second tap. The bridge reports the real saved filename in
          // `message`, so always prefer it over the name we requested.
          const file = (message && /\.apk$/i.test(message)) ? message
            : (message || (S.getApkState(app.slug) || {}).filename || filename);
          setTimeout(() => { try { installWithBar(app, file); } catch (e) {} }, 250);
        }
        return;
      }
      if (status === 'installing') {
        stopCreep();
        setCancelVisible(false);
        cancelRequested = false;
        btn.classList.add('installing');
        btn.disabled = true;
        setProgress(1);
        label.textContent = t('جارٍ التثبيت…');
        S.setActiveDownload({ slug: app.slug, status: 'installing', progress: 1 });
        return;
      }
      if (status === 'installed') {
        stopCreep();
        updateFlowActive = false;
        removeUpdateBar();
        updateIntent = false;
        fileMissingRetries = 0;
        if (S.clearDeletedApk) S.clearDeletedApk(app.slug);
        markInstalledStored(app.slug);
        S.removeActiveDownload(app.slug);
        S.removeApkState(app.slug);
        if (message && message !== 'installed') S.rememberResolvedPackage(app.slug, message);
        // Compare the STORE build with the DEVICE build. An older installed
        // copy must show «تحديث» and install the APK, never OPEN the old app.
        const hasUpdate = S.appHasUpdate ? S.appHasUpdate(app) : false;
        showInstalled(hasUpdate ? 'update' : 'open');
        showInstalledActions(app, { withOpen: !hasUpdate });
        toast(t('تم تثبيت التطبيق بنجاح'), 'success');
        return;
      }
      if (status === 'cancelled') {
        stopCreep();
        updateFlowActive = false;
        removeUpdateBar();
        if (hasInstallPrompt(app.slug)) {
          const fn = (message && /\.apk$/i.test(message)) ? message : installPromptFilename(app.slug);
          restoreReadyToInstall(fn, { toast: t('تم إلغاء التثبيت، الملف جاهز للتثبيت') });
          return;
        }
        const alreadyNotified = cancelRequested;
        cancelRequested = false;
        updateIntent = false;
        S.removeActiveDownload(app.slug);
        removeInstalledActions();
        showIdle();
        if (!alreadyNotified) toast(t('تم إلغاء التنزيل'), 'info');
        return;
      }
      if (status === 'uninstalled') {
        updateIntent = false;
        fileMissingRetries = 0;
        unmarkInstalledStored(app.slug);
        S.removeApkState(app.slug);
        S.removeActiveDownload(app.slug);
        clearInstallPrompt(app.slug);
        // Uninstalled = starts over with the normal blue «تثبيت» button.
        if (S.clearDeletedApk) S.clearDeletedApk(app.slug);
        removeInstalledActions();
        showIdle();
        toast(t('تم إلغاء تثبيت التطبيق'), 'info');
        return;
      }
      if (status === 'open_failed') {
        toast(t('التطبيق غير مثبت على هذا الجهاز'), 'error');
        return;
      }
      if (status === 'failed') {
        stopCreep();
        updateFlowActive = false;
        removeUpdateBar();
        if (message === 'file_missing') { handleMissingFile(); return; }
        if (hasInstallPrompt(app.slug)) {
          const fn = (message && /\.apk$/i.test(message)) ? message : installPromptFilename(app.slug);
          restoreReadyToInstall(fn, { toast: errMap[message] || t('تعذّر التثبيت، الملف جاهز لإعادة المحاولة'), kind: 'error' });
          return;
        }
        clearInstallPrompt(app.slug);
        updateIntent = false;
        const isInstalled = (S.installedVersionOnDevice && S.installedVersionOnDevice(realPackage(app))) || (S.isSlugInstalled && S.isSlugInstalled(app.slug));
        if (isInstalled) {
          return;
        }
        S.removeActiveDownload(app.slug);
        showIdle();
        toast(errMap[message] || t('تعذّر التنزيل، حاول مجدداً'), 'error');
      }
    };

    window.addEventListener('gs-package-uninstalled', (e) => {
      const d = (e && e.detail) || {};
      const pkg = d.packageName;
      const slug = d.slug;
      const real = realPackage(app);
      const resolved = (S.resolvedPackageName && S.resolvedPackageName(app.slug)) || '';
      const matches = (slug && slug === app.slug)
        || (pkg && (pkg === app.package_name || pkg === real || pkg === resolved));
      if (matches) {
        unmarkInstalledStored(app.slug);
        removeInstalledActions();
        showIdle();
      }
    });

    const filename = `${app.slug || 'app'}-${app.version_name || ''}.apk`.replace(/-+/g, '-');
    let downloadAttempt = 0;
    /* Round 42 — «حتى يكمل الإعلان ثم يبدأ التنزيل»: the APK starts streaming
       the instant the ad opens (so the wait converges instead of starting from
       zero afterwards) but it is SAVED only after the countdown ends. */
    let primedTransfer = null;

    /* A filename that was deleted on the device must never be reused: the
       Android side would answer «downloaded» again for a file that is gone and
       the store would loop on «ملف التحميل مفقود». Every later attempt gets a
       unique suffix instead. */
    function nextDownloadFilename() {
      const base = filename;
      const baseDead = isDeadFilename(base);
      if (!baseDead && !downloadAttempt) return base;
      downloadAttempt += 1;
      const suffix = `-r${downloadAttempt}-${Date.now().toString(36)}.apk`;
      return base.replace(/\.apk$/i, '') + suffix;
    }

    /* ---------------- In-app advertisement ---------------- */
    /* The ad is BACK, but it never leaves the app: it is rendered as a layer
       inside the page (an <iframe>), never with window.open / target=_blank,
       so Chrome is never launched. It runs for exactly AD_SECONDS seconds and
       the transfer only starts when it closes: the 0 % bar is already painted
       underneath, so the moment the ad goes away the real progress takes over. */
    const AD_URL = 'https://www.profitableratecpmnetwork.com/q3nni29t?key=f23e7306d9c04fd6816a2df86159c110';
    const AD_SECONDS = 10;
    let adLayerEl = null, adTimer = null, adResolve = null;
    /* Round 42: the caller may start the transport while the ad is playing. */
    let adStartHook = null;
    function closeInAppAd() {
      if (adTimer) { clearInterval(adTimer); adTimer = null; }
      if (adLayerEl && adLayerEl.parentNode) adLayerEl.parentNode.removeChild(adLayerEl);
      adLayerEl = null;
      const r = adResolve; adResolve = null;
      if (r) { try { r(); } catch (e) {} }
    }
    /* The ad layer must be impossible to lose: it is created on every launch,
       pinned with !important inline declarations, sandboxed so the creative
       cannot navigate the WebView away (that was the «sometimes no ad» bug),
       and watched by a 1s watchdog that re-attaches it if anything removes it. */
    function pinAdLayer(layer) {
      const set = (k, v) => { try { layer.style.setProperty(k, v, 'important'); } catch (e) { layer.style[k] = v; } };
      set('position', 'fixed'); set('top', '0'); set('left', '0'); set('right', '0'); set('bottom', '0');
      set('width', '100vw'); set('height', '100vh'); set('margin', '0'); set('padding', '0');
      set('inset', '0'); set('z-index', '2147482200'); set('background', '#0b0b10');
      set('display', 'flex'); set('flex-direction', 'column'); set('overflow', 'hidden');
      set('visibility', 'visible'); set('opacity', '1'); set('transform', 'none');
      set('pointer-events', 'auto'); set('border-radius', '0');
    }
    function showInAppAd() {
      return new Promise((resolve) => {
        // A previous layer may have been detached by the WebView: only a layer
        // that is still IN THE DOCUMENT may short-circuit the new ad.
        if (adLayerEl && adLayerEl.isConnected && adLayerEl.parentNode) { resolve(); return; }
        closeInAppAd();
        adResolve = resolve;
        const layer = document.createElement('div');
        layer.id = 'gs-ad-layer';
        const head = document.createElement('div');
        head.setAttribute('style', 'display:flex;align-items:center;gap:8px;flex:0 0 auto;'
          + 'padding:calc(env(safe-area-inset-top, 0px) + 12px) 14px 12px;background:#12121a;'
          + 'color:#fff;font-size:13px;font-weight:700;border-bottom:1px solid #24242f');
        const tagEl = document.createElement('span');
        tagEl.setAttribute('style', 'font-size:11px;font-weight:800;letter-spacing:.04em;'
          + 'color:#0b0b10;background:#f5c542;padding:3px 8px;border-radius:6px');
        tagEl.textContent = t('إعلان');
        const cdEl = document.createElement('span');
        cdEl.id = 'gs-ad-count';
        cdEl.setAttribute('style', 'margin-inline-start:auto;font-size:13px;font-weight:600;'
          + 'color:#cfcfd8;font-variant-numeric:tabular-nums');
        const frame = document.createElement('iframe');
        frame.id = 'gs-ad-frame';
        frame.setAttribute('title', t('إعلان'));
        frame.setAttribute('style', 'flex:1 1 auto;width:100%;height:100%;border:0;background:#fff;display:block');
        // No allow-top-navigation: the creative can never replace the store.
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        let frameLoaded = false;
        frame.addEventListener('load', () => { frameLoaded = true; });
        const loadSrc = () => { try { frame.src = AD_URL + '&gs_ad_t=' + Date.now(); } catch (e) {} };
        loadSrc();
        head.appendChild(tagEl); head.appendChild(cdEl);
        layer.appendChild(head); layer.appendChild(frame);
        pinAdLayer(layer);
        (document.body || document.documentElement).appendChild(layer);
        adLayerEl = layer;
        /* Round 42 (owner: «اجعله حتى يكمل الإعلان ثم يبدأ التنزيل»): the file
           starts moving DURING the advertisement — the server connection is
           opened and the response is buffered while the creative plays — and
           the save/UI only happens after the countdown hits zero. Counting
           starts from the first painted frame, so the ad really completes. */
        try { if (typeof adStartHook === 'function') adStartHook(); } catch (e) {}
        let left = AD_SECONDS;
        let retried = false;
        const paintCd = () => {
          cdEl.textContent = left > 0
            ? `${t('يبدأ التحميل بعد')} ${left}`
            : t('جارٍ بدء التحميل…');
        };
        paintCd();
        adTimer = setInterval(() => {
          // Watchdog: if a re-render dropped the layer, put it straight back.
          if (adLayerEl && adLayerEl !== layer) { closeInAppAd(); return; }
          if (layer && !layer.isConnected) {
            try { (document.body || document.documentElement).appendChild(layer); } catch (e) {}
          }
          left -= 1;
          if (left <= 0) { closeInAppAd(); return; }
          // A creative that never renders would leave a black screen: retry it
          // once, then keep the countdown running regardless.
          if (!frameLoaded && !retried && left <= AD_SECONDS - 3) { retried = true; loadSrc(); }
          paintCd();
        }, 1000);
      });
    }

    async function runInstall(opts) {
      const fresh = !!(opts && opts.fresh);
      const update = !!(opts && opts.update);
      if (update) updateIntent = true;
      // Re-entrancy guard: ONE launch at a time, released in `finally` and by a
      // safety timer, so the button can never stay dead.
      if (launchInFlight) return;
      const stamp = Date.now();
      if (stamp - lastLaunchAt < 250) return;   // ignore click+touch double-fire
      lastLaunchAt = stamp;
      // 1) PAINT + COMMIT the bar first: nothing may open a window before this,
      //    and a forced synchronous layout makes the 0% bar visible in-frame.
      // Opening an already installed app needs no ad and no bar.
      const justOpens = !updateIntent && btn.classList.contains('installed')
        && !btn.classList.contains('has-update') && !fresh;
      if (updateIntent) updateFlowActive = true;
      paintLaunchUi();
      forceReflow();
      launchInFlight = true;
      const releaseLaunch = setTimeout(() => { launchInFlight = false; }, (AD_SECONDS + 8) * 1000);
      try {
        // The ad plays INSIDE the app first; the download starts when it ends.
        cancelRequested = false;
        if (!justOpens) {
          armDownloadClock();          // round 41: the ad is NOT download time
          primedTransfer = null;
          adStartHook = () => { try { primeDownloadTransfer(); } catch (e) {} };
          await showInAppAd();         // runs the FULL countdown
          adStartHook = null;
          markTransferStart();
        }
        if (cancelRequested) { updateIntent = false; updateFlowActive = false; return; }
        return await runInstallLaunch({ fresh, update });
      } finally {
        clearTimeout(releaseLaunch);
        launchInFlight = false;
      }
    }

    /* One place that decides what the bar looks like the moment of the tap. */
    function paintLaunchUi() {
      if (updateIntent || btn.classList.contains('has-update')) {
        updateIntent = true;
        beginUpdateUi();
        return;
      }
      if (btn.classList.contains('installed')) return;
      removeInstalledActions();
      btn.classList.remove('installed', 'has-update');
      setCancelVisible(true);
      btn.classList.add('installing');
      btn.classList.remove('indeterminate');
      btn.disabled = true;
      /* Round 42 — «يتوقف شريط التنزيل فيتجمد العداد في 49».
         The bar is painted at ZERO and the creep clock stays OFF while the ad
         plays; the download itself decides when the clock starts (see
         markTransferStart). Nothing can freeze before the transfer exists. */
      setProgress(0);
      stopCreep();
    }
    /* Forces the browser to actually compute and paint the new style NOW. */
    function forceReflow() {
      try {
        void btn.offsetHeight;
        void fill.offsetWidth;
        void document.body.offsetHeight;
      } catch (e) {}
    }

    /* Opens the real download request during the ad and buffers it into memory.
       The UI stays locked until the ad ends; nothing is saved before that. */
    function primeDownloadTransfer() {
      if (isNativeApp()) return;                  // bridge downloads on its call
      if (primedTransfer) return;
      const controller = new AbortController();
      const entry = { controller, ok: false, chunks: [], received: 0, total: 0, done: false, error: null, reader: null, promise: null };
      primedTransfer = entry;
      entry.promise = (async () => {
        const res = await fetch(`/api/apps/${encodeURIComponent(app.slug)}/download?stream=1`, {
          credentials: 'include', signal: controller.signal,
        });
        if (!res.ok || !res.body) { entry.error = new Error('http_' + res.status); entry.done = true; return; }
        entry.total = Number(res.headers.get('Content-Length') || 0);
        const reader = res.body.getReader();
        entry.reader = reader;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          entry.chunks.push(value);
          entry.received += value.length;
        }
        entry.ok = true;
        entry.done = true;
      })().catch((e) => { entry.error = e; entry.done = true; });
      return entry;
    }

    /* Round 42 — the real reason «يتوقف شريط التنزيل فيتجمد العداد»: this call
       referenced a `nextFrame` helper that did not exist, so on the web path the
       launch threw a ReferenceError right after the ad and the transfer never
       started at all (the bar stayed frozen wherever it had reached). */
    const nextFrame = (cb) => {
      try { requestAnimationFrame(() => cb()); }
      catch (e) { setTimeout(cb, 16); }
    };

    async function runInstallLaunch(opts) {
      const fresh = !!(opts && opts.fresh);
      // Unlimited concurrent downloads: no global slot, no cancellation of
      // another app/game. Each slug is tracked independently in Store.
      if (S.canStartConcurrentDownload && !S.canStartConcurrentDownload()) return;
      // Idempotent: the UI was already painted before the ad opened.
      paintLaunchUi();
      // The native bridge is called in THIS task (right after the tap), so the
      // APK really starts downloading immediately.
      // Only the web path needs a frame to paint before it starts fetching.
      if (!isNativeApp()) await new Promise((r) => nextFrame(r));
      if (!autoRestartInProgress) fileMissingRetries = 0;
      autoRestartInProgress = false;
      cancelRequested = false;
      btn.classList.remove('gs-btn-grey');
      group.classList.remove('gs-grey');
      // A fresh attempt must keep the «deleted» marker until the bridge really
      // starts downloading, otherwise a stale native snapshot slips back in.
      if (!fresh && S.clearDeletedApk) S.clearDeletedApk(app.slug);

      if (btn.classList.contains('has-update')) updateIntent = true;
      if (btn.classList.contains('installed') && !updateIntent
          && !(S.appHasUpdate && S.appHasUpdate(app))) { openInstalled(app); return; }

      const liveState = S.getApkState(app.slug);
      const liveFile = (liveState && liveState.filename) || '';
      const liveIsDead = isDeadFilename(liveFile);
      if (fresh || liveIsDead) {
        // We already know this file is not on the phone: purge it everywhere
        // and go straight to a brand-new download with a new filename.
        if (liveFile) purgeNativeApk(liveFile, app.slug);
        S.removeApkState(app.slug);
        S.removeActiveDownload(app.slug);
        showIdle();
        if (updateIntent) beginUpdateUi();
      } else if (isNativeApp() && liveState && liveState.status === 'downloaded' && liveFile) {
        // A file finished SECONDS ago (the user declined the installer) is
        // reused. Anything older is a leftover from a previous session: the
        // owner expects «تحديث» to download again and count, so it is dropped.
        const age = Math.floor(Date.now() / 1000) - Number(liveState.updated_at || 0);
        const freshEnough = age >= 0 && age < 120;
        if (updateIntent && !freshEnough) {
          purgeNativeApk(liveFile, app.slug);
          S.removeApkState(app.slug);
          S.removeActiveDownload(app.slug);
          beginUpdateUi();
        } else if (updateIntent) {
          installWithBar(app, liveFile);
          return;
        } else {
          openDownloadedApk(app, liveFile);
          return;
        }
      } else if (isNativeApp() && liveState && liveState.status === 'installing' && liveFile) {
        if (updateIntent) { installWithBar(app, liveFile); return; }
      }

      if (!isNativeApp() && !S.isLoggedIn()) {
        try { await S.requireAuth(); } catch { return; }
      }

      if (isNativeApp()) {
        // Native bridge is keyed by slug too; starting this game/app does not
        // cancel any other in-flight download (unlimited concurrency).
        const apiBase = (S.apiBaseUrl && S.apiBaseUrl()) || '';
        const dlUrl = `${apiBase}/api/apps/${encodeURIComponent(app.slug)}/download`;
        if (updateIntent) beginUpdateUi();
        setCancelVisible(true);
        btn.classList.add('installing');
        btn.disabled = true;
        markTransferStart();          // round 41: real transfer begins now
        setIndeterminate();
        S.setActiveDownload({
          slug: app.slug,
          name: app.name,
          icon_url: app.icon_url || null,
          developer: app.developer || '',
          size_bytes: app.size_bytes || 0,
          package_name: app.package_name || '',
          progress: 0,
          status: 'downloading',
          started_at: Math.floor(Date.now() / 1000),
        });
        nativeActiveDownloadRegistered = true;
        // Android bridge is keyed by slug. If the user leaves this page while
        // the APK is still downloading, keep THIS entry active in «مكتبتي»
        // alongside any other concurrent native download.
        nativeDownloadFinished = false;
        clearNativeLeaveHandler();
        nativeLeaveHandler = () => {
          if (!nativeDownloadFinished) S.markDownloadHandedOff(app.slug);
        };
        window.addEventListener('pagehide', nativeLeaveHandler, { once: true });
        try {
          // Unique filename when the previous file was deleted on the device,
          // then — and only then — forget the «deleted» marker: a real
          // download is starting, so native snapshots are trustworthy again.
          const dlFilename = nextDownloadFilename();
          if (S.clearDeletedApk) S.clearDeletedApk(app.slug);
          window.GSAndroid.downloadApk(dlUrl, dlFilename, app.slug || '', app.package_name || '', app.name || '', app.icon_url || '');
          toast(t('بدأ التنزيل…'), 'info');
        } catch (e) {
          delete apkStateHandlers[app.slug];
          S.removeActiveDownload(app.slug);
          fallbackDownload(app.slug);
          showIdle();
        }
        return;
      }

      setCancelVisible(true);
      markTransferStart();            // round 41: real transfer begins now
      const controller = new AbortController();
      activeDownloadController = controller;
      S.registerWebDownload(app.slug, controller);
      btn.classList.add('installing');
      btn.disabled = true;
      fill.style.transition = 'none';
      fill.style.width = '0%';
      label.textContent = `${t('جارٍ التنزيل…')} 0%`;

      S.setActiveDownload({
        slug: app.slug,
        name: app.name,
        icon_url: app.icon_url || null,
        developer: app.developer || '',
        size_bytes: app.size_bytes || 0,
        progress: 0,
        status: 'downloading',
        started_at: Math.floor(Date.now() / 1000),
      });

      let finished = false;
      let handoffTriggered = false;
      const onHandoff = () => {
        if (finished || handoffTriggered) return;
        handoffTriggered = true;
        finished = true;                    // never let catch cancel/remove it
        cleanupHandoffListeners();
        // Browser owns the transfer now: keep THIS slug active & indeterminate
        // so «مكتبتي» shows it alongside all other concurrent downloads.
        S.markDownloadHandedOff(app.slug);
        try { fallbackDownload(app.slug); } catch {}
      };
      const cleanupHandoffListeners = () => {
        window.removeEventListener('pagehide', onHandoff);
        window.removeEventListener('beforeunload', onHandoff);
      };
      window.addEventListener('pagehide', onHandoff);
      window.addEventListener('beforeunload', onHandoff);

      try {
        /* Round 42: if the transfer was primed during the ad, finish it here —
           the bytes are already in memory, so the save is immediate. */
        if (primedTransfer) {
          const primed = primedTransfer;
          primedTransfer = null;
          /* Round 42: the bar starts at 0 % when the ad ends and climbs with the
             bytes ALREADY buffered during the ad — it must never look frozen. */
          markTransferStart();
          stopCreep();
          /* The bar LEAVES 0 % when the ad ends and climbs with the bytes that
             were buffered during the ad (content-length known) — it can never
             stand still, and it always ends at 100 %. */
          const knownTotal = primed.total || 0;
          const revealMs = 2400;          // a smooth, believable 0 → 100 %
          const t0 = Date.now();
          await new Promise((resolve) => {
            const tick = setInterval(() => {
              if (primed.error) { clearInterval(tick); resolve(); return; }
              const byClock = (Date.now() - t0) / revealMs;
              const real = knownTotal > 0 ? Math.min(0.99, primed.received / knownTotal) : 0;
              /* Everything buffered during the ad: reveal it at a steady pace.
                 Still arriving: the bytes hold the number, the clock keeps it
                 moving so it can never freeze (the old «49» report). */
              let shown = primed.done
                ? Math.min(0.99, byClock)
                : Math.max(Math.min(0.96, byClock), real, 0.02);
              if (byClock >= 1) shown = 1;
              noteRealProgress(shown);
              setProgress(shown);
              if (S.updateActiveDownloadProgress) S.updateActiveDownloadProgress(app.slug, shown);
              if (shown >= 1) { clearInterval(tick); resolve(); }
            }, 80);
          });
          if (primed.error) throw primed.error;
          if (!primed.ok) throw new Error('http_error');
          await primed.promise;
          setProgress(1);
          const blob = new Blob(primed.chunks, { type: 'application/vnd.android.package-archive' });
          saveBlob(blob, filename);
          finished = true;
          cleanupHandoffListeners();
          activeStreamReader = null;
          activeDownloadController = null;
          S.unregisterWebDownload(app.slug);
          cancelRequested = false;
          S.removeActiveDownload(app.slug);
          markInstalledStored(app.slug);
          S.addToDownloadHistory(app);
          showInstalled();
          toast(t('اكتمل التحميل وحفظ الملف في جهازك'), 'success');
          return;
        }
        const res = await fetch(`/api/apps/${encodeURIComponent(app.slug)}/download?stream=1`, {
          credentials: 'include',
          signal: activeDownloadController.signal,
        });
        if (!res.ok || !res.body) throw new Error('http_' + res.status);
        /* Round 42: the response headers ARE the start of the transfer. Without
           this the creep clock was never armed on the web path, so a response
           with no Content-Length left the bar frozen where it was painted. */
        markTransferStart();
        noteRealProgress(0);

        const total = Number(res.headers.get('Content-Length') || 0);
        const reader = res.body.getReader();
        activeStreamReader = reader;
        S.registerWebDownload(app.slug, controller, reader);
        const chunks = [];
        let received = 0;
        let lastProgressWrite = 0;
        let lastProgressValue = -1;
        const pushProgress = (value, force = false) => {
          const now = Date.now();
          if (!force && now - lastProgressWrite < 200 && Math.abs(value - lastProgressValue) < 0.02) return;
          lastProgressWrite = now;
          lastProgressValue = value;
          S.updateActiveDownloadProgress(app.slug, value);
        };
        if (!total) {
          // Unknown size: keep the CREEP bar (it always moves) instead of a
          // frozen indeterminate sweep, and mark the store entry unknown.
          if (!dlStartedAt) markTransferStart();
          if (!creepTimer) startCreep(0);
          S.updateActiveDownloadProgress(app.slug, -1);
        } else {
          pushProgress(0, true);
        }
        for (;;) {
          const { done: readDone, value } = await reader.read();
          if (readDone) break;
          chunks.push(value);
          received += value.length;
          if (total) {
            noteRealProgress(received / total);
            setProgress(received / total);
            pushProgress(received / total);
          } else {
            /* No Content-Length: the bytes themselves move the bar (counted by
               size instead of a frozen indeterminate sweep). */
            noteRealProgress(Math.min(0.96, received / Math.max(received + 1, 6 * 1024 * 1024)));
          }
        }
        const blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
        setProgress(1);
        saveBlob(blob, filename);
        finished = true;
        cleanupHandoffListeners();
        activeStreamReader = null;
        activeDownloadController = null;
        S.unregisterWebDownload(app.slug);
        cancelRequested = false;
        S.removeActiveDownload(app.slug);
        markInstalledStored(app.slug);
        S.addToDownloadHistory(app);
        showInstalled();
        toast(t('اكتمل التحميل وحفظ الملف في جهازك'), 'success');
      } catch (e) {
        if (finished) return;               // handed off: active entry preserved
        finished = true;
        cleanupHandoffListeners();
        activeStreamReader = null;
        activeDownloadController = null;
        S.unregisterWebDownload(app.slug);
        if (cancelRequested) {
          cancelRequested = false;
          S.removeActiveDownload(app.slug);
          S.removeApkState(app.slug);
          showIdle();
          return;
        }
        // Stream failed: the normal browser download still continues, so keep
        // this slug active (indeterminate) instead of deleting it.
        fallbackDownload(app.slug);
        S.markDownloadHandedOff(app.slug);
        S.addToDownloadHistory(app);
        showIdle();
        toast(t('تعذر عرض شريط التقدم، وبدأ التنزيل بالطريقة العادية'), 'info');
      }
    }

    btn.addEventListener('click', runInstall);

    function resolveInstallState() {
      // A pending update owns the UI: never rebuild the buttons underneath it.
      if (updateFlowActive) return;
      if (S.registerInstallWatch) S.registerInstallWatch(app.slug, app.package_name || '');

      // A download/install is running for THIS slug: keep its progress on
      // screen. The phone still reports the OLD version installed meanwhile.
      if (S.hasInFlightApk && S.hasInFlightApk(app.slug)) {
        const inflight = (S.getActiveDownloads() || []).find((d) => d.slug === app.slug) || {};
        const live = S.getApkState(app.slug) || inflight;
        const p = typeof live.progress === 'number' ? live.progress : -1;
        setCancelVisible(true);
        btn.classList.add('installing');
        btn.disabled = true;
        if (p >= 0) setProgress(p); else setIndeterminate();
        return;
      }
      const st = isNativeApp() && S.checkAppStatus ? S.checkAppStatus(app.slug, app.package_name || '') : null;
      // Use the REAL GSAndroid bridge detector in Store: Capacitor is absent
      // in the Android WebView, so st alone could miss an older installation.
      const installedOnDevice = S.isAppInstalledOnDevice
        ? S.isAppInstalledOnDevice(app) : !!(st && st.installed);
      if (installedOnDevice) {
        S.removeApkState(app.slug);
        S.removeActiveDownload(app.slug);
        markInstalledStored(app.slug);
        if (st && st.package_name) S.rememberResolvedPackage(app.slug, st.package_name);
        const hasUpdate = S.appHasUpdate ? S.appHasUpdate(app) : false;
        showInstalled(hasUpdate ? 'update' : 'open');
        showInstalledActions(app, { withOpen: !hasUpdate });
        return;
      }
      unmarkInstalledStored(app.slug);
      removeInstalledActions();
      const live = (st && st.status && st.status !== 'none')
        ? { status: st.status, progress: st.progress, filename: st.filename }
        : S.getApkState(app.slug);
      if (live && live.status === 'downloading') {
        setCancelVisible(true);
        btn.classList.add('installing');
        btn.disabled = true;
        if (live.progress >= 0) setProgress(live.progress);
        else setIndeterminate();
        return;
      }
      if (live && (live.status === 'installing' || live.status === 'downloaded')) {
        const liveFile = live.filename || '';
        // The device says «downloaded» but that very file was deleted: drop the
        // record instead of rebuilding a button that ends in «ملف التحميل مفقود».
        if (isDeadFilename(liveFile)) {
          purgeNativeApk(liveFile, app.slug);
          S.removeApkState(app.slug);
          S.removeActiveDownload(app.slug);
          removeInstalledActions();
          showIdle();
          return;
        }
        // Returning from the system installer without an «installed» event
        // means the user declined. Restore the final UI IMMEDIATELY (no
        // heartbeat wait, no stuck «جارٍ التثبيت…», no duplicate big button).
        restoreReadyToInstall(liveFile || filename);
        return;
      }
      showIdle();
    }

    window.addEventListener('gs-install-resolved', (e) => {
      const d = e && e.detail || {};
      if (!d.slug || d.slug !== app.slug) return;
      if (typeof onAppRevisit === 'function') onAppRevisit();
    });

    /* focus + visibilitychange + pageshow + resume + gs-app-resume all fired
       together on every return to the WebView, each running a full bridge
       round-trip. One debounced call per 300ms is enough and keeps the UI
       responsive. */
    let resolveTimer = null;
    const onAppRevisit = () => {
      if (document.hidden) return;
      if (!isNativeApp()) return;
      if (resolveTimer) clearTimeout(resolveTimer);
      resolveTimer = setTimeout(() => {
        resolveTimer = null;
        // Never fight a live download/install.
        if (S.hasInFlightApk && S.hasInFlightApk(app.slug)) return;
        resolveInstallState();
      }, 300);
    };
    document.addEventListener('visibilitychange', onAppRevisit);
    document.addEventListener('resume', onAppRevisit);
    window.addEventListener('focus', onAppRevisit);
    window.addEventListener('pageshow', onAppRevisit);
    window.addEventListener('gs-app-resume', onAppRevisit);

    if (isNativeApp()) {
      resolveInstallState();
    } else {
      const activeDls = S.getActiveDownloads();
      const activeDl = activeDls.find((d) => d.slug === app.slug);
      if (activeDl && activeDl.status === 'downloading') {
      btn.classList.add('installing');
      btn.disabled = true;

      const startedAt = activeDl.started_at || Math.floor(Date.now() / 1000);
      const elapsed = Math.floor(Date.now() / 1000) - startedAt;
      const sizeBytes = app.size_bytes || activeDl.size_bytes || 20 * 1024 * 1024;
      const estimatedTotalTime = Math.max(10, sizeBytes / (400 * 1024));
      const lastProgress = (activeDl.progress >= 0) ? activeDl.progress : 0;
      const timeBasedProgress = Math.min(0.95, elapsed / estimatedTotalTime);
      let currentProgress = Math.max(lastProgress, timeBasedProgress);

      if (currentProgress >= 0.95) {
        S.removeActiveDownload(app.slug);
        markInstalledStored(app.slug);
        S.addToDownloadHistory(app);
        showInstalled();
      } else {
        setProgress(currentProgress);
        const remainingTime = (estimatedTotalTime - elapsed) * 1000;
        const stepInterval = 300;
        const steps = Math.max(1, Math.floor(remainingTime / stepInterval));
        const increment = (0.98 - currentProgress) / steps;
        let stepsDone = 0;
        const progressTimer = setInterval(() => {
          stepsDone++;
          currentProgress = Math.min(0.98, currentProgress + increment);
          setProgress(currentProgress);
          S.updateActiveDownloadProgress(app.slug, currentProgress);
          if (stepsDone >= steps) {
            clearInterval(progressTimer);
            setTimeout(() => {
              setProgress(1);
              S.removeActiveDownload(app.slug);
              markInstalledStored(app.slug);
              S.addToDownloadHistory(app);
              showInstalled();
              toast(t('اكتمل التحميل'), 'success');
                  }, 800);
          }
        }, stepInterval);
      }
      } else if (isInstalled(app.slug)) {
        showInstalled('open');
      }
    }

    const menu = el('div', { class: 'install-menu' },
      el('button', { class: 'install-menu-item', type: 'button', onclick: () => { toggleMenu(false); openRequestUpdate(app); } },
        ico('refresh', 'icon'), t('طلب تحديث')),
      el('button', { class: 'install-menu-item', type: 'button', onclick: () => { toggleMenu(false); openReport(app); } },
        ico('flag', 'icon'), t('إبلاغ عن مشكلة')),
    );
    const caret = el('button', { class: 'btn btn-primary btn-lg install-caret', type: 'button', 'aria-label': t('خيارات إضافية') }, ico('chevronDown', 'icon'));

    group.append(caret, menu);

    function toggleMenu(force) {
      const open = typeof force === 'boolean' ? force : !group.classList.contains('menu-open');
      group.classList.toggle('menu-open', open);
    }
    caret.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
    document.addEventListener('click', (e) => { if (!group.contains(e.target)) toggleMenu(false); });

    return actionsWrap;
  }

  function ratingSection(app) {
    let fingerprint = null, voted = false, myRating = 0, selected = 0;
    let reviews = [];
    let reviewsModalBody = null;
    reviewsState = reviews;

    const avg = S.ratingValue(app);
    const initialCount = S.ratingCountOf(app);
    const user = S.getUser ? S.getUser() : null;

    const big = el('div', { class: 'rate-big' }, initialCount > 0 ? avg.toFixed(1) : '—');
    const avgBar = starBar(avg);
    const count = el('div', { class: 'rate-meta' },
      initialCount > 0 ? `${formatNum(initialCount)} ${t('تقييم')}` : t('كن أول من يقيّم هذا التطبيق'));

    const distRows = el('div', { class: 'rate-dist' });
    function renderDist(dist, total) {
      distRows.innerHTML = '';
      for (let s = 5; s >= 1; s--) distRows.append(distRow(s, Number((dist && dist[s]) || 0), total));
    }
    renderDist({}, 0);

    function refreshAverage(ratingAvg, ratingCount) {
      big.textContent = ratingCount > 0 ? Number(ratingAvg).toFixed(1) : '—';
      const fresh = starBar(ratingAvg);
      avgBar.replaceChildren(...fresh.childNodes);
      count.textContent = ratingCount > 0 ? `${formatNum(ratingCount)} ${t('تقييم')}` : t('كن أول من يقيّم هذا التطبيق');
    }

    const icons = [];
    const picker = el('div', { class: 'rate-input' });
    function paint(n) {
      icons.forEach((sp, idx) => {
        const on = idx < n;
        sp.classList.toggle('on', on);
        sp.textContent = on ? '★' : '☆';
      });
    }
    for (let i = 1; i <= 5; i++) {
      const sp = el('span', { class: 'star-pick' }, '☆');
      sp.setAttribute('role', 'button');
      sp.setAttribute('aria-label', `${i} ${t('نجوم')}`);
      sp.addEventListener('mouseenter', () => { if (!voted) paint(i); });
      sp.addEventListener('mouseleave', () => paint(voted ? myRating : selected));
      sp.addEventListener('click', () => {
        if (voted) { toast(t('لقد قيّمت هذا التطبيق مسبقاً'), 'info'); return; }
        selected = i; paint(i);
      });
      icons.push(sp);
      picker.append(sp);
    }
    const pickerHint = el('div', { style: { fontSize: '14px', marginBottom: '8px' } }, t('قيّم واكتب مراجعتك'));

    const accountName = (user && (user.displayName || user.email)) || t('مستخدم');
    const accountPhoto = (user && user.photoURL) || '';
    const accountUid = (user && user.uid) || '';
    const idAvatar = el('div', { class: 'avatar' });
    if (accountPhoto) idAvatar.append(el('img', { src: accountPhoto, alt: '', referrerpolicy: 'no-referrer' }));
    else idAvatar.textContent = (accountName.trim().charAt(0) || 'م').toUpperCase();
    const identity = el('div', { class: 'review-identity' },
      idAvatar,
      el('div', { class: 'who' }, el('div', { class: 'nm' }, accountName), el('div', { class: 'dt' }, t('تنشر باسم حسابك'))),
    );
    const commentInput = el('textarea', { class: 'field', maxlength: '2000', placeholder: t('شارك رأيك في هذا التطبيق…') });
    /* Round 41/42: guests read every review but cannot write one — the box asks
       for an account the moment they try, instead of letting them type and lose
       it. The composer is not even painted for a guest (see paintAuthUi). */
    commentInput.addEventListener('focus', async () => {
      let logged = false;
      try { if (S.isLoggedIn && S.isLoggedIn()) logged = true; } catch (e) {}
      if (logged) return;
      const mine = () => setTimeout(() => {
        try { commentInput.focus(); } catch (e) {}
      }, 120);
      if (!(await requireAccountFor(t('التعليق'), mine))) { try { commentInput.blur(); } catch (e) {} }
    });
    const submitBtn = el('button', { class: 'btn btn-primary' }, t('نشر المراجعة'));
    submitBtn.addEventListener('click', () => submit());
    const form = el('div', { class: 'review-form' }, identity, commentInput, el('div', { class: 'actions' }, submitBtn));
    if (window.GSSettings && window.GSSettings.get('allow_reviews', '1') !== '1') {
      form.style.display = 'none';
    }
    const INITIAL_REVIEWS = 2;
    const reviewsList = el('div', { class: 'reviews' });
    const showMoreBtn = el('button', { class: 'btn btn-secondary btn-sm', style: { marginTop: '12px', display: 'none' } }, t('عرض المزيد'));
    showMoreBtn.addEventListener('click', () => openReviewsModal());
    const restoreHiddenBtn = el('button', {
      class: 'btn btn-text btn-sm restore-hidden-btn', type: 'button',
      style: { marginTop: '8px', display: 'none' },
      onclick: () => restoreHiddenReviews(),
    }, ico('refresh', 'icon icon-sm'), el('span', { class: 'restore-hidden-label' }, ''));

    function visibleReviews() {
      const hidden = hiddenReviewIds();
      return reviews.filter((r) => !r.id || !hidden.has(String(r.id)));
    }
    function syncHiddenControl() {
      const hidden = hiddenReviewIds();
      const hiddenHere = reviews.filter((r) => r.id && hidden.has(String(r.id))).length;
      restoreHiddenBtn.style.display = hiddenHere ? '' : 'none';
      const label = restoreHiddenBtn.querySelector('.restore-hidden-label');
      if (label) label.textContent = `${t('إظهار المراجعات المخفية')} (${hiddenHere})`;
    }
    function renderReviews() {
      const list = visibleReviews();
      reviewsList.innerHTML = '';
      showMoreBtn.style.display = 'none';
      syncHiddenControl();
      if (!list.length) {
        reviewsList.append(el('div', { class: 'reviews-empty' }, t('لا توجد مراجعات بعد. كن أول من يكتب مراجعة!')));
        return;
      }
      list.slice(0, INITIAL_REVIEWS).forEach((r) => reviewsList.append(reviewCard(r)));
      if (list.length > INITIAL_REVIEWS) {
        showMoreBtn.style.display = '';
        showMoreBtn.textContent = `${t('عرض المزيد')} (${list.length})`;
      }
    }
    function fillReviewsModalBody(body) {
      body.innerHTML = '';
      const list = visibleReviews();
      if (!list.length) {
        body.append(el('div', { class: 'reviews-empty' }, t('لا توجد مراجعات بعد. كن أول من يكتب مراجعة!')));
        return;
      }
      list.forEach((r) => body.append(reviewCard(r)));
    }
    function openReviewsModal() {
      const overlay = el('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) close(); } });
      const body = el('div', { class: 'dialog-body reviews-modal-body', style: { maxHeight: '60vh', overflowY: 'auto' } });
      fillReviewsModalBody(body);
      reviewsModalBody = body;
      const card = el('div', { class: 'dialog-card' },
        el('div', { class: 'dialog-head' },
          el('div', { class: 'dialog-title' }, ico('star', 'icon'), t('جميع التقييمات والمراجعات')),
          el('button', { class: 'dialog-close', 'aria-label': t('إغلاق'), onclick: () => close() }, ico('close')),
        ),
        body,
        el('div', { class: 'dialog-actions' },
          el('button', { class: 'btn btn-secondary', onclick: () => close() }, t('عرض أقل')),
        ),
      );
      overlay.append(card);
      function close() {
        reviewsModalBody = null;
        overlay.remove();
        document.removeEventListener('keydown', esc);
      }
      function esc(e) { if (e.key === 'Escape') close(); }
      document.addEventListener('keydown', esc);
      document.body.append(overlay);
    }
    /** Re-render every open view of the review list (page + modal). */
    refreshReviewViews = () => {
      renderReviews();
      if (reviewsModalBody && reviewsModalBody.isConnected) fillReviewsModalBody(reviewsModalBody);
    };

    renderReviews();

    function lockVoted(rating, comment) {
      voted = true; myRating = rating; selected = rating;
      paint(myRating);
      picker.classList.add('voted');
      pickerHint.textContent = myRating ? `${t('تقييمك')}: ${myRating} ${t('من')} 5` : t('لقد قيّمت هذا التطبيق');
      form.style.display = 'none';
    }

    (async () => {
      try {
        fingerprint = await getFingerprint();
        const res = await window.Store.api(`/api/apps/${encodeURIComponent(app.slug)}/star-check`, { method: 'POST', body: { fp: fingerprint, uid: accountUid } });
        if (res.voted) lockVoted(Number(res.my_rating || 0), res.my_comment || '');
        if (typeof res.rating === 'number') refreshAverage(res.rating, Number(res.rating_count || 0));
      } catch {}
    })();

    async function loadReviews() {
      try {
        const viewer = encodeURIComponent(viewerId());
        const res = await window.Store.api(`/api/apps/${encodeURIComponent(app.slug)}/reviews?userId=${viewer}`);
        reviews = reviewsState = (res.reviews || []).map((r) => ({
          ...r,
          liked: !!r.liked,
          likes_count: Number(r.likes_count) || 0,
        }));
        renderReviews();
        renderDist(res.dist || {}, Number(res.rating_count || 0));
        if (typeof res.rating === 'number') refreshAverage(res.rating, Number(res.rating_count || 0));
      } catch {}
    }
    loadReviews();

    async function submit() {
      if (window.GSSettings && window.GSSettings.get('allow_reviews', '1') !== '1') {
        toast(t('التقييمات معطّلة حالياً'), 'info'); return;
      }
      if (voted) { toast(t('لقد قيّمت هذا التطبيق مسبقاً'), 'info'); return; }
      /* Round 42: the account is asked for FIRST — a guest who taps «نشر» without
         picking stars must still get the sign-in invitation, not «اختر النجوم». */
      if (!(S.isLoggedIn && S.isLoggedIn())) {
        if (!(await requireAccountFor(t('التقييم')))) return;
      }
      if (!selected) { toast(t('اختر عدد النجوم أولاً'), 'info'); return; }
      if (!(S.isLoggedIn && S.isLoggedIn())) {
        toast(t('سجّل الدخول أولاً لتستطيع') + ' ' + t('التقييم'), 'info');
        return;
      }
      submitBtn.disabled = true;
      const myComment = commentInput.value.trim();
      const myName = accountName;
      try {
        if (!fingerprint) fingerprint = await getFingerprint();
        const res = await window.Store.api(`/api/apps/${encodeURIComponent(app.slug)}/star`, {
          method: 'POST',
          body: { fp: fingerprint, rating: selected, comment: myComment, name: myName, uid: accountUid, photo_url: accountPhoto },
        });
        const rated = selected;
        lockVoted(rated, myComment);
        refreshAverage(res.rating, Number(res.rating_count || 0));
        if (res.review || myComment) {
          const fresh = res.review || {
            name: myName || t('مستخدم'), rating: rated, comment: myComment,
            photo_url: accountPhoto || null, ts: Math.floor(Date.now() / 1000),
          };
          reviews.unshift({ ...fresh, likes_count: Number(fresh.likes_count) || 0, liked: false });
          renderReviews();
        }
        loadReviews();
        toast(t('شكراً لمراجعتك!'), 'success');
      } catch (e) {
        submitBtn.disabled = false;
        if (e && e.status === 409) {
          lockVoted(selected, myComment);
          toast(t('لقد قيّمت هذا التطبيق مسبقاً'), 'info');
          if (e.data && typeof e.data.rating === 'number') refreshAverage(e.data.rating, Number(e.data.rating_count || 0));
        } else if (e && e.data && e.data.error === 'invalid_rating') {
          toast(t('اختر عدد النجوم أولاً'), 'info');
        } else {
          toast(t('تعذّر إرسال المراجعة'), 'error');
        }
      }
    }

    const rateBody = el('div', { class: 'rate-collapse-body' });
    /* The «you will get like notifications» line is a guest hint: it is hidden as
       soon as the visitor signs in, together with the rest of the gate. */
    const hint = likeHintNode();
    if (hint) rateBody.append(hint);
    /* Round 42 — «المستخدم لم يسجل لا يستطيع التعليق ولا التقييم ولا الإعجاب»:
       a guest sees ONE invitation instead of a composer that could never submit.
       The gate is painted from the CURRENT auth state and is swapped back to the
       real composer the instant a visitor signs in (no reload required). */
    const pickerWrap = el('div', { style: { marginTop: '18px' } }, pickerHint, picker);
    const guestGate = el('div', { class: 'rate-guest-gate' },
      el('p', null, t('سجّل الدخول لتقييم التطبيق وكتابة تعليق')),
      el('button', { class: 'btn btn-primary', type: 'button',
        onclick: async () => { await requireAccountFor(t('التقييم')); } },
        t('تسجيل الدخول')));
    function paintAuthUi() {
      let logged = false;
      try { if (S.isLoggedIn && S.isLoggedIn()) logged = true; } catch (e) {}
      guestGate.style.display = logged ? 'none' : '';
      if (hint) hint.style.display = logged ? 'none' : '';
      pickerWrap.style.display = logged ? '' : 'none';
      form.style.display = logged ? '' : 'none';
    }
    rateBody.append(guestGate);
    paintAuthUi();
    if (S.onAuthChanged) {
      S.onAuthChanged(() => {
        paintAuthUi();
        renderReviews();
        /* A tap that asked for an account is carried out right after the
           sign-in, so nothing has to be repeated by hand. */
        const pending = pendingAccountAction;
        pendingAccountAction = null;
        if (pending && S.isLoggedIn && S.isLoggedIn()) {
          try { pending(); } catch (e) {}
        }
      });
    }
    rateBody.append(
      pickerWrap,
      el('div', { style: { marginTop: '12px' } },
        form,
      ),
      reviewsList,
      showMoreBtn,
      restoreHiddenBtn,
    );
    rateBody.style.maxHeight = '0';
    rateBody.style.overflow = 'hidden';
    rateBody.style.transition = 'max-height .35s ease';

    let rateOpen = false;
    const toggleIcon = ico('chevronDown', 'icon rate-toggle-ico');
    const rateHeader = el('div', { class: 'rate-collapse-header', onclick: () => {
      rateOpen = !rateOpen;
      if (rateOpen) {
        rateBody.style.maxHeight = rateBody.scrollHeight + 2000 + 'px';
        toggleIcon.style.transform = 'rotate(180deg)';
      } else {
        rateBody.style.maxHeight = '0';
        toggleIcon.style.transform = 'rotate(0deg)';
      }
    } },
      el('h3', { style: { margin: '0', flex: '1', cursor: 'pointer' } }, t('التقييمات والمراجعات')),
      toggleIcon,
    );
    toggleIcon.style.transition = 'transform .3s ease';

    const collapseObserver = new MutationObserver(() => {
      if (picker.classList.contains('voted') && rateOpen) {
        setTimeout(() => {
          rateOpen = false;
          rateBody.style.maxHeight = '0';
          toggleIcon.style.transform = 'rotate(0deg)';
        }, 1500);
      }
    });
    collapseObserver.observe(picker, { attributes: true, attributeFilter: ['class'] });

    return el('div', { class: 'd-section' },
      rateHeader,
      el('div', { class: 'rate-summary' },
        el('div', { class: 'rate-side' }, big, avgBar, count),
        distRows,
      ),
      rateBody,
    );
  }
})();
