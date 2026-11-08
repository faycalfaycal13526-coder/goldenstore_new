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
      const res = await api(`/api/apps/${encodeURIComponent(slug)}/reviews/${encodeURIComponent(id)}/like`, {
        method: 'POST', body: { userId: viewerId() },
      });
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
  const storeApkHandler = window.__gsApkDownloadUpdate;
  window.__gsApkDownloadUpdate = function (slug, status, progress, message) {
    if (typeof storeApkHandler === 'function') storeApkHandler(slug, status, progress, message);
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

    function share(a) {
      const origin = (window.Store && window.Store.publicOrigin) ? window.Store.publicOrigin() : null;
      const url = origin
        ? `${origin}/app?slug=${encodeURIComponent(a && a.slug ? a.slug : slug)}`
        : location.href;
      if (navigator.share) navigator.share({ title: (a && a.name) || 'Golden Store', url }).catch(() => {});
      else { navigator.clipboard && navigator.clipboard.writeText(url); toast(t('تم نسخ الرابط'), 'success'); }
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

    document.title = `${app.name} — Golden Store`;
    nav.querySelector('.title') && (nav.querySelector('.title').textContent = '');
    content.innerHTML = '';

    const iconInner = app.icon_url ? el('img', { src: app.icon_url, alt: app.name }) : ico('package', 'icon icon-lg');
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
        el('div', { class: 'd-name' }, app.name),
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
    const canInteract = !!id;
    const initial = ((review.name || 'م').trim().charAt(0) || 'م').toUpperCase();
    const stars = el('div', { class: 'stars' });
    const rt = Math.round(Number(review.rating) || 0);
    for (let i = 1; i <= 5; i++) stars.append(el('span', { class: `star ${i <= rt ? 'on' : ''}` }, i <= rt ? '★' : '☆'));
    const avatar = el('div', { class: 'avatar' });
    if (review.photo_url) avatar.append(el('img', { src: review.photo_url, alt: '', referrerpolicy: 'no-referrer' }));
    else avatar.textContent = initial;

    const liked = !!review.liked;
    const likeLabel = liked ? t('إزالة الإعجاب') : t('أعجبني');
    const likeBtn = el('button', {
      class: `review-like${liked ? ' is-liked' : ''}`,
      type: 'button',
      'aria-pressed': liked ? 'true' : 'false',
      'aria-label': likeLabel,
      title: likeLabel,
      disabled: canInteract ? null : 'disabled',
      onclick: () => toggleReviewLike(review),
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
    const cancelBtn = el('button', {
      class: 'btn btn-secondary btn-lg download-cancel-btn hidden',
      type: 'button',
      'aria-label': t('إلغاء التنزيل'),
      title: t('إلغاء التنزيل'),
      onclick: handleCancelDownload,
    }, ico('close', 'icon icon-sm'));
    group.append(cancelBtn);

    let nativeActiveDownloadRegistered = false;
    let activeDownloadController = null;
    let activeStreamReader = null;
    let cancelRequested = false;

    function setCancelVisible(visible) {
      group.classList.toggle('split-active', visible);
      cancelBtn.classList.toggle('hidden', !visible);
      if (visible) cancelBtn.disabled = false;
    }

    function handleCancelDownload() {
      if (cancelBtn.disabled || cancelBtn.classList.contains('hidden')) return;
      cancelBtn.disabled = true;
      cancelRequested = true;
      cancelBtn.classList.add('hidden');
      if (activeDownloadController) {
        try { activeDownloadController.abort(); } catch (e) {}
      }
      if (activeStreamReader) {
        try { activeStreamReader.cancel().catch(() => {}); } catch (e) {}
      }
      try { S.cancelDownload(app.slug); } catch (e) {}
      S.removeActiveDownload(app.slug);
      S.removeApkState(app.slug);
      removeInstalledActions();
      showIdle();
      toast(t('تم إلغاء التنزيل'), 'info');
    }

    function setProgress(ratio) {
      const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
      btn.classList.remove('indeterminate');
      fill.style.transition = 'width .15s linear';
      fill.style.width = pct + '%';
      label.textContent = `${t('جارٍ التنزيل…')} ${pct}%`;
    }
    function setIndeterminate() {
      btn.classList.add('indeterminate');
      label.textContent = t('جارٍ التنزيل…');
    }
    function resetBar() {
      btn.classList.remove('installing', 'indeterminate');
      fill.style.transition = 'none';
      fill.style.width = '0%';
    }
    function showInstalled(mode) {
      setCancelVisible(false);
      resetBar();
      btn.disabled = false;
      label.innerHTML = '';
      if (mode === 'update') {
        btn.classList.remove('installed');
        btn.classList.add('has-update');
        label.append(ico('refresh', 'icon'), document.createTextNode(t('تحديث')));
      } else {
        btn.classList.add('installed');
        label.append(ico('check', 'icon'), document.createTextNode(t('تم التثبيت')));
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
    function openDownloadedApk(a, filename) {
      if (isNativeApp() && window.GSAndroid && typeof window.GSAndroid.openDownloadedApk === 'function') {
        try {
          window.GSAndroid.openDownloadedApk(filename || '', a.slug || '', a.package_name || '');
          toast(t('جارٍ فتح مثبّت النظام…'), 'info');
        } catch (e) { toast(t('تعذّر فتح الملف'), 'error'); }
        return;
      }
      toast(t('غير متاح في هذا المتصفح'), 'info');
    }
    function deleteDownloadedApk(a, filename) {
      if (isNativeApp() && window.GSAndroid && typeof window.GSAndroid.deleteDownloadedApk === 'function') {
        try { window.GSAndroid.deleteDownloadedApk(filename || '', a.slug || ''); } catch (e) {}
      }
    }
    function showInstalledActions(a, opts = {}) {
      if (!isNativeApp()) return;
      removeInstalledActions();
      const bar = el('div', { class: 'installed-actions', id: 'gs-installed-actions' });
      bar.append(
        el('button', { class: 'btn btn-primary btn-lg gs-action-open', type: 'button', onclick: () => openInstalled(a) },
          ico('play', 'icon'), t('فتح')),
        el('button', { class: 'btn btn-secondary btn-lg gs-action-uninstall', type: 'button', onclick: () => uninstallInstalled(a) },
          ico('trash', 'icon'), t('إلغاء التثبيت')),
      );
      const anchor = document.querySelector('.detail .d-actions');
      if (anchor && anchor.parentNode) {
        anchor.style.display = 'none';
        anchor.parentNode.insertBefore(bar, anchor.nextSibling);
      } else {
        const det = document.querySelector('.detail');
        if (det) det.prepend(bar);
      }
    }
    function showDownloadedActions(a, filename) {
      setCancelVisible(false);
      if (!isNativeApp()) return;
      removeInstalledActions();
      const bar = el('div', { class: 'installed-actions', id: 'gs-installed-actions' },
        el('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => openDownloadedApk(a, filename) },
          ico('download', 'icon'), t('تثبيت')),
        el('button', { class: 'btn btn-secondary btn-lg', type: 'button', onclick: () => { deleteDownloadedApk(a, filename); S.removeApkState(a.slug); S.removeActiveDownload(a.slug); removeInstalledActions(); showIdle(true); toast(t('تم حذف ملف التحميل'), 'info'); } },
          ico('trash', 'icon'), t('حذف الملف')),
      );
      const anchor = document.querySelector('.detail .d-actions');
      if (anchor) {
        anchor.style.display = 'none';
        anchor.parentNode.insertBefore(bar, anchor);
      } else {
        document.querySelector('.detail').prepend(bar);
      }
    }
    function removeInstalledActions() {
      const existing = document.getElementById('gs-installed-actions');
      if (existing) existing.remove();
      setCancelVisible(false);
      const anchor = document.querySelector('.detail .d-actions');
      if (anchor) anchor.style.display = '';
    }
    function showIdle(skipAnchorRestore) {
      setCancelVisible(false);
      resetBar();
      btn.classList.remove('installed');
      btn.disabled = false;
      label.textContent = t('تثبيت');
    }

    apkStateHandlers[app.slug] = function (status, progress, message) {
      const errMap = {
        signature_mismatch: t('تعارض توقيع الحزمة: ألغِ التطبيق المثبت ثم ثبّت النسخة الجديدة.'),
        package_mismatch: t('اسم الحزمة غير متطابق مع التطبيق.'),
        apk_parse_failed: t('تعذّر قراءة ملف APK.'),
        install_error: t('فشل التثبيت.'),
        file_missing: t('ملف التحميل مفقود.'),
      };
      if (status === 'downloading') {
        if (cancelRequested) return;
        setCancelVisible(true);
        btn.classList.add('installing');
        btn.disabled = true;
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
        if (progress >= 0) setProgress(progress);
        else setIndeterminate();
        return;
      }
      if (status === 'downloaded') {
        setCancelVisible(false);
        cancelRequested = false;
        setProgress(1);
        btn.classList.remove('installing');
        btn.disabled = false;
        label.textContent = t('جاهز للتثبيت');
        S.removeActiveDownload(app.slug);
        S.addToDownloadHistory(app);
        showDownloadedActions(app, message || filename);
        return;
      }
      if (status === 'installing') {
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
        markInstalledStored(app.slug);
        S.removeActiveDownload(app.slug);
        S.removeApkState(app.slug);
        if (message && message !== 'installed') S.rememberResolvedPackage(app.slug, message);
        const devVer = S.installedVersionOnDevice(realPackage(app)) || S.isSlugInstalled(app.slug);
        const hasUpdate = S.versionIsNewer(app.version_name || '', devVer);
        showInstalled(hasUpdate ? 'update' : 'open');
        showInstalledActions(app, { withOpen: !hasUpdate });
        toast(t('تم تثبيت التطبيق بنجاح'), 'success');
        return;
      }
      if (status === 'cancelled') {
        const alreadyNotified = cancelRequested;
        cancelRequested = false;
        S.removeActiveDownload(app.slug);
        removeInstalledActions();
        showIdle();
        if (!alreadyNotified) toast(t('تم إلغاء التنزيل'), 'info');
        return;
      }
      if (status === 'uninstalled') {
        unmarkInstalledStored(app.slug);
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

    async function runInstall() {
      if (btn.classList.contains('installing')) return;
      cancelRequested = false;

      try {
        window.open('https://www.profitableratecpmnetwork.com/q3nni29t?key=f23e7306d9c04fd6816a2df86159c110', '_blank');
      } catch (e) {}

      if (btn.classList.contains('installed')) { openInstalled(app); return; }

      const liveState = S.getApkState(app.slug);
      if (isNativeApp() && liveState && liveState.status === 'downloaded' && liveState.filename) {
        openDownloadedApk(app, liveState.filename);
        return;
      }

      if (!isNativeApp() && !S.isLoggedIn()) {
        try { await S.requireAuth(); } catch { return; }
      }

      if (isNativeApp()) {
        const apiBase = (S.apiBaseUrl && S.apiBaseUrl()) || '';
        const dlUrl = `${apiBase}/api/apps/${encodeURIComponent(app.slug)}/download`;
        setCancelVisible(true);
        btn.classList.add('installing');
        btn.disabled = true;
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
        try {
          window.GSAndroid.downloadApk(dlUrl, filename, app.slug || '', app.package_name || '', app.name || '', app.icon_url || '');
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
      activeDownloadController = new AbortController();
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
        try { fallbackDownload(app.slug); } catch {}
      };
      const cleanupHandoffListeners = () => {
        window.removeEventListener('pagehide', onHandoff);
        window.removeEventListener('beforeunload', onHandoff);
      };
      window.addEventListener('pagehide', onHandoff);
      window.addEventListener('beforeunload', onHandoff);

      try {
        const res = await fetch(`/api/apps/${encodeURIComponent(app.slug)}/download?stream=1`, {
          credentials: 'include',
          signal: activeDownloadController.signal,
        });
        if (!res.ok || !res.body) throw new Error('http_' + res.status);

        const total = Number(res.headers.get('Content-Length') || 0);
        const reader = res.body.getReader();
        activeStreamReader = reader;
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
          setIndeterminate();
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
            setProgress(received / total);
            pushProgress(received / total);
          }
        }
        const blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
        if (total) setProgress(1);
        saveBlob(blob, filename);
        finished = true;
        cleanupHandoffListeners();
        activeStreamReader = null;
        activeDownloadController = null;
        cancelRequested = false;
        S.removeActiveDownload(app.slug);
        markInstalledStored(app.slug);
        S.addToDownloadHistory(app);
        showInstalled();
        toast(t('اكتمل التحميل وحفظ الملف في جهازك'), 'success');
      } catch (e) {
        finished = true;
        cleanupHandoffListeners();
        activeStreamReader = null;
        activeDownloadController = null;
        if (cancelRequested) {
          cancelRequested = false;
          S.removeActiveDownload(app.slug);
          S.removeApkState(app.slug);
          showIdle();
          return;
        }
        fallbackDownload(app.slug);
        S.removeActiveDownload(app.slug);
        S.addToDownloadHistory(app);
        showIdle();
        toast(t('تعذر عرض شريط التقدم، وبدأ التنزيل بالطريقة العادية'), 'info');
      }
    }

    btn.addEventListener('click', runInstall);

    function resolveInstallState() {
      if (S.registerInstallWatch) S.registerInstallWatch(app.slug, app.package_name || '');

      const st = isNativeApp() && S.checkAppStatus ? S.checkAppStatus(app.slug, app.package_name || '') : null;
      if (st && st.installed) {
        markInstalledStored(app.slug);
        if (st.package_name) S.rememberResolvedPackage(app.slug, st.package_name);
        const hasUpdate = S.versionIsNewer(app.version_name || '', st.version || '');
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
      if (live && live.status === 'installing') {
        btn.classList.add('installing');
        btn.disabled = true;
        setProgress(1);
        label.textContent = t('جارٍ التثبيت…');
        return;
      }
      if (live && live.status === 'downloaded') {
        setProgress(1);
        btn.classList.remove('installing');
        btn.disabled = false;
        label.textContent = t('جاهز للتثبيت');
        showDownloadedActions(app, live.filename || filename);
        return;
      }
      showIdle();
    }

    window.addEventListener('gs-install-resolved', (e) => {
      const d = e && e.detail || {};
      if (!d.slug || d.slug !== app.slug) return;
      resolveInstallState();
    });

    const onAppRevisit = () => {
      if (document.hidden) return;
      if (isNativeApp()) resolveInstallState();
    };
    document.addEventListener('visibilitychange', onAppRevisit);
    window.addEventListener('focus', onAppRevisit);
    window.addEventListener('pageshow', onAppRevisit);

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
        showInstalled();
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

    return el('div', { class: 'd-actions' }, group);
  }

  function ratingSection(app) {
    let fingerprint = null, voted = false, myRating = 0, selected = 0;
    let reviews = [];
    let reviewsModalBody = null;
    // Explicit breakdown so a star-only rating is never mistaken for the
    // ghost of a deleted comment. Counting semantics stay unchanged.
    let ratingStats = { comments: 0, silent: 0 };
    reviewsState = reviews;

    const avg = S.ratingValue(app);
    const initialCount = S.ratingCountOf(app);
    const user = S.getUser ? S.getUser() : null;

    const big = el('div', { class: 'rate-big' }, initialCount > 0 ? avg.toFixed(1) : '—');
    const avgBar = starBar(avg);
    const count = el('div', { class: 'rate-meta' },
      initialCount > 0 ? `${formatNum(initialCount)} ${t('تقييم')}` : t('كن أول من يقيّم هذا التطبيق'));
    const breakdown = el('div', { class: 'rate-breakdown' });
    function renderBreakdown(total) {
      if (!total) { breakdown.textContent = ''; return; }
      breakdown.textContent = `${formatNum(ratingStats.comments)} ${t('تعليق مكتوب')} • ${formatNum(ratingStats.silent)} ${t('تقييم بالنجوم فقط')}`;
    }

    const distRows = el('div', { class: 'rate-dist' });
    function renderDist(dist, total) {
      distRows.innerHTML = '';
      for (let s = 5; s >= 1; s--) distRows.append(distRow(s, Number((dist && dist[s]) || 0), total));
    }
    renderDist({}, 0);

    function refreshAverage(ratingAvg, ratingCount, stats) {
      if (stats) ratingStats = stats;
      big.textContent = ratingCount > 0 ? Number(ratingAvg).toFixed(1) : '—';
      const fresh = starBar(ratingAvg);
      avgBar.replaceChildren(...fresh.childNodes);
      count.textContent = ratingCount > 0 ? `${formatNum(ratingCount)} ${t('تقييم')}` : t('كن أول من يقيّم هذا التطبيق');
      renderBreakdown(ratingCount);
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
    function emptyReviewsNote() {
      if (ratingStats.silent > 0) {
        return el('div', { class: 'reviews-empty reviews-empty-silent' },
          el('strong', null, t('لا توجد تعليقات مكتوبة.')),
          el('span', null, `${t('يوجد')} ${formatNum(ratingStats.silent)} ${t('تقييم بالنجوم فقط مُحتسب ضمن المتوسط')}.`),
          el('small', null, t('هذه تقييمات أعطيت بدون كتابة مراجعة، وليست أثراً لتعليق محذوف.')));
      }
      return el('div', { class: 'reviews-empty' }, t('لا توجد مراجعات بعد. كن أول من يكتب مراجعة!'));
    }
    function renderReviews() {
      const list = visibleReviews();
      reviewsList.innerHTML = '';
      showMoreBtn.style.display = 'none';
      syncHiddenControl();
      if (!list.length) {
        reviewsList.append(emptyReviewsNote());
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
        body.append(emptyReviewsNote());
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
        if (typeof res.rating === 'number') refreshAverage(res.rating, Number(res.rating_count || 0),
          { comments: Number(res.reviews_count ?? 0), silent: Number(res.silent_votes ?? 0) });
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
        ratingStats = {
          comments: Number(res.reviews_count ?? res.total ?? 0),
          silent: Number(res.silent_votes ?? 0),
        };
        renderReviews();
        renderDist(res.dist || {}, Number(res.rating_count || 0));
        if (typeof res.rating === 'number') refreshAverage(res.rating, Number(res.rating_count || 0), ratingStats);
      } catch {}
    }
    loadReviews();

    async function submit() {
      if (window.GSSettings && window.GSSettings.get('allow_reviews', '1') !== '1') {
        toast(t('التقييمات معطّلة حالياً'), 'info'); return;
      }
      if (voted) { toast(t('لقد قيّمت هذا التطبيق مسبقاً'), 'info'); return; }
      if (!selected) { toast(t('اختر عدد النجوم أولاً'), 'info'); return; }
      if (!isNativeApp() && !S.isLoggedIn()) {
        try { await S.requireAuth(); } catch { return; }
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
        refreshAverage(res.rating, Number(res.rating_count || 0), ratingStats);
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
    rateBody.append(
      el('div', { style: { marginTop: '18px' } },
        pickerHint,
        picker,
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
        el('div', { class: 'rate-side' }, big, avgBar, count, breakdown),
        distRows,
      ),
      rateBody,
    );
  }
})();
