// Golden Store — shared frontend helpers, auth gate, and UI chrome.
// Exposed as window.Store. Public store pages use this (admin keeps common.js).

const STORE = { name: 'Golden Store', domain: 'goldenstore.me' };

/* ----------------------------- Theme (light/dark) ----------------------------- */
const THEME_KEY = 'gs_theme';
function currentTheme() {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}
function applyTheme(theme) {
  const th = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', th);
  try { localStorage.setItem(THEME_KEY, th); } catch {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', th === 'light' ? '#ffffff' : '#0d0d0f');
  document.querySelectorAll('.theme-toggle').forEach((b) => syncThemeBtn(b, th));
}
function toggleTheme() { applyTheme(currentTheme() === 'light' ? 'dark' : 'light'); }
function syncThemeBtn(btn, th) {
  btn.innerHTML = '';
  btn.append(ico(th === 'light' ? 'moon' : 'sun', 'icon'));
  btn.setAttribute('aria-label', th === 'light' ? t('الوضع الغامق') : t('الوضع الفاتح'));
  btn.setAttribute('title', th === 'light' ? t('الوضع الغامق') : t('الوضع الفاتح'));
}
function themeToggleBtn() {
  const btn = el('button', { class: 'icon-btn theme-toggle', type: 'button', onclick: toggleTheme });
  syncThemeBtn(btn, currentTheme());
  return btn;
}
function langSwitcherEl() {
  try { if (window.GSI18N && window.GSI18N.switcherEl) return window.GSI18N.switcherEl(); } catch (e) {}
  return document.createComment('lang');
}
// Apply persisted theme as early as possible.
applyTheme(currentTheme());

/* ----------------------------- API ----------------------------- */
function isNativeApp() {
  return typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
}
function apiBaseUrl() {
  if (!isNativeApp()) return '';
  const cfg = window.Capacitor.getConfig && window.Capacitor.getConfig();
  return (cfg && cfg.apiBase) || 'https://goldenstore.vercel.app';
}
function fullApiUrl(path) {
  const base = apiBaseUrl();
  return base && path.startsWith('/') ? base + path : path;
}
async function apiNativeCap(path, opts, timeoutMs) {
  const capHttp = window.Capacitor.Plugins.CapacitorHttp;
  const isJsonBody = opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData);
  const body = isJsonBody ? JSON.stringify(opts.body) : opts.body;
  let headers = opts.headers || {};
  if (isJsonBody && !headers['Content-Type'] && !headers['content-type']) {
    headers = { 'Content-Type': 'application/json', ...headers };
  }
  const options = {
    url: fullApiUrl(path),
    method: opts.method || 'GET',
    headers,
    data: body,
    responseType: 'json',
  };
  if (timeoutMs > 0) {
    options.connectTimeout = timeoutMs;
    options.readTimeout = timeoutMs;
  }
  let response;
  try {
    response = await capHttp.request(options);
  } catch (e) {
    const err = new Error((e && e.message) || 'network_error');
    err.status = 0;
    throw err;
  }
  const data = response.data || null;
  if (response.status < 200 || response.status >= 300) {
    const err = new Error((data && data.error) || 'error');
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}
async function api(path, opts = {}) {
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 15000;
  if (isNativeApp() && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) {
    return apiNativeCap(path, opts, timeoutMs);
  }
  const ctrl = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetch(fullApiUrl(path), {
      credentials: 'include',
      headers: opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string'
        ? { 'Content-Type': 'application/json', ...(opts.headers || {}) }
        : opts.headers || {},
      ...opts,
      signal: opts.signal || ctrl.signal,
      body: opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)
        ? JSON.stringify(opts.body)
        : opts.body,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    const err = new Error(e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'network_error');
    err.status = 0;
    throw err;
  }
  if (timer) clearTimeout(timer);
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error((data && data.error) || res.statusText || 'error');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* --------------------------- DOM helper --------------------------- */
function el(tag, attrs = null, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') node.innerHTML = v;
      else node.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) c.forEach((x) => x && node.append(x.nodeType ? x : document.createTextNode(String(x))));
    else if (c.nodeType) node.append(c);
    else node.append(document.createTextNode(String(c)));
  }
  return node;
}

function ico(name, extra = 'icon') { return window.GSIcons.iconEl(name, extra); }
function t(s) { try { return window.GSI18N.t(s); } catch { return s; } }

/* --------------------------- Formatters --------------------------- */
function i18nUnits(kind) {
  try { const u = window.GSI18N && window.GSI18N.units(kind); if (u && u.length) return u; } catch (e) {}
  return kind === 'count' ? ['', 'ألف', 'مليون', 'مليار'] : ['ب', 'ك.ب', 'م.ب', 'ج.ب'];
}
function formatBytes(bytes) {
  const units = i18nUnits('bytes');
  if (!bytes) return `0 ${units[0]}`;
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
function formatCount(n) {
  n = Number(n || 0);
  const u = i18nUnits('count');
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + ' ' + u[3];
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' ' + u[2];
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + ' ' + u[1];
  return String(n);
}
function formatNum(n) { return Number(n || 0).toLocaleString('en-US'); }
function formatDate(ts) {
  if (!ts) return '—';
  const lang = (window.GSI18N && window.GSI18N.lang) || 'ar';
  return new Date(ts * 1000).toLocaleDateString(lang, { year: 'numeric', month: 'short', day: 'numeric', numberingSystem: 'latn' });
}

// Real rating helpers — based on actual user votes from the backend.
// rating = average (0–5), rating_count/stars = number of ratings.
function ratingCountOf(app) {
  return Number((app && (app.rating_count != null ? app.rating_count : app.stars)) || 0);
}
function ratingValue(app) {
  return Number((app && app.rating) || 0);
}
// Formatted average for display, or null when the app has no ratings yet.
function ratingOf(app) {
  if (ratingCountOf(app) <= 0) return null;
  return ratingValue(app).toFixed(1);
}

function getQuery(name) { return new URLSearchParams(location.search).get(name) || ''; }

const REF_PENDING_KEY = 'gs_ref_pending';
function getPendingReferral() {
  try { return localStorage.getItem(REF_PENDING_KEY) || ''; } catch { return ''; }
}
function clearPendingReferral() {
  try { localStorage.removeItem(REF_PENDING_KEY); } catch {}
}
function setPendingReferral(code) {
  const value = sanitizeText(code, 32);
  if (!value) return;
  try { localStorage.setItem(REF_PENDING_KEY, value); } catch {}
}

function toast(msg, type = 'info', ms = 3000) {
  let stack = document.querySelector('.toast-stack');
  if (!stack) { stack = el('div', { class: 'toast-stack' }); document.body.append(stack); }
  const t = el('div', { class: `toast ${type}` }, msg);
  stack.append(t);
  setTimeout(() => {
    t.style.transition = 'opacity .2s, transform .2s';
    t.style.opacity = '0'; t.style.transform = 'translateY(8px)';
    setTimeout(() => t.remove(), 200);
  }, ms);
}

/* ----------------------------- Cards ----------------------------- */
// Square poster card (horizontal rows)
function posterCard(a) {
  const rt = ratingOf(a);
  return el('a', { href: `/app?slug=${encodeURIComponent(a.slug)}`, class: 'poster' },
    el('div', { class: 'art' }, a.icon_url ? el('img', { src: a.icon_url, alt: a.name, loading: 'lazy' }) : ico('package', 'icon icon-lg')),
    el('div', { class: 'nm' }, a.name),
    rt
      ? el('div', { class: 'rt' }, el('span', null, rt), ico('star', 'icon fill'))
      : el('div', { class: 'rt' }, el('span', null, t('جديد'))),
  );
}

// Full-width list row (recommended / search results)
function listRow(a, opts = {}) {
  const cat = categoryName(a.category);
  const rt = ratingOf(a);
  return el('a', { href: `/app?slug=${encodeURIComponent(a.slug)}`, class: 'approw' },
    el('div', { class: 'art' }, a.icon_url ? el('img', { src: a.icon_url, alt: a.name, loading: 'lazy' }) : ico('package', 'icon icon-lg')),
    el('div', { class: 'info' },
      el('div', { class: 'nm' }, a.name),
      el('div', { class: 'sub' }, a.developer || cat || STORE.name),
      el('div', { class: 'meta-line' },
        rt ? el('span', null, rt) : el('span', null, t('جديد')),
        rt ? ico('star', 'icon fill') : null,
        el('span', null, '•'),
        el('span', null, formatBytes(a.size_bytes || 0)),
      ),
    ),
    opts.installed
      ? el('span', { class: 'badge' }, ico('check', 'icon icon-sm'), t('مثبّت'))
      : el('span', { class: 'row-dl-btn' }, ico('download', 'icon')),
  );
}

// Square grid card used in the home-page grid view.
function gridCard(a) {
  const rt = ratingOf(a);
  return el('a', { href: `/app?slug=${encodeURIComponent(a.slug)}`, class: 'grid-card' },
    el('div', { class: 'grid-art' }, a.icon_url ? el('img', { src: a.icon_url, alt: a.name, loading: 'lazy' }) : ico('package', 'icon icon-lg')),
    el('div', { class: 'grid-info' },
      el('div', { class: 'grid-name' }, a.name),
      el('div', { class: 'grid-meta' }, `${a.version_name ? 'v' + a.version_name : ''}${a.version_name ? ' • ' : ''}${formatBytes(a.size_bytes || 0)}`),
      el('div', { class: 'grid-rating' },
        rt ? el('span', null, rt) : el('span', null, t('جديد')),
        rt ? ico('star', 'icon fill') : null,
      ),
    ),
  );
}

// Google Play-style featured card: image with gradient + description overlay, compact info bar below.
function featureSlide(a) {
  const slide = el('a', { href: `/app?slug=${encodeURIComponent(a.slug)}`, class: 'fc-slide' });
  const media = el('div', { class: 'fc-media' });
  if (a.feature_url) {
    media.append(el('img', { src: a.feature_url, alt: a.name, loading: 'lazy', class: 'fc-media-img' }));
  } else {
    media.classList.add('fc-media-fallback');
    media.append(a.icon_url
      ? el('img', { class: 'fc-fallback-ico', src: a.icon_url, alt: '', loading: 'lazy' })
      : ico('package', 'icon icon-lg'));
  }
  // Description overlay on gradient at bottom of image
  const desc = a.short_description || a.description || '';
  if (desc) {
    media.append(el('div', { class: 'fc-desc' }, desc));
  }
  const rt = ratingOf(a);
  slide.append(
    media,
    el('div', { class: 'fc-bar' },
      el('div', { class: 'fc-bar-ico' }, a.icon_url ? el('img', { src: a.icon_url, alt: '' }) : ico('package', 'icon')),
      el('div', { class: 'fc-bar-text' },
        el('div', { class: 'fc-bar-name' }, a.name),
        el('div', { class: 'fc-bar-sub' },
          el('span', null, a.developer || ''),
          rt ? el('span', { class: 'fc-bar-rate' }, rt, ico('star', 'icon fill')) : null,
        ),
      ),
      el('span', { class: 'fc-bar-btn' }, t('عرض')),
    ),
  );
  return slide;
}

function featureCarousel(apps, opts = {}) {
  const list = (apps || []).filter(Boolean).slice(0, opts.max || 8);
  if (!list.length) return el('span');

  const track = el('div', { class: 'fc-track' });
  list.forEach((a) => track.append(featureSlide(a)));

  const dots = el('div', { class: 'fc-dots' });
  list.forEach((_, i) => dots.append(el('button', {
    class: `fc-dot ${i === 0 ? 'on' : ''}`, type: 'button',
    'aria-label': `${t('شريحة')} ${i + 1}`, onclick: (e) => { e.preventDefault(); go(i, true); },
  })));

  const wrap = el('div', { class: 'feature-carousel' }, track, list.length > 1 ? dots : null);

  let idx = 0;
  let timer = null;
  function paint() {
    track.style.transform = `translateX(${-idx * 100}%)`;
    Array.from(dots.children).forEach((d, i) => d.classList.toggle('on', i === idx));
  }
  function go(i, manual) { idx = (i + list.length) % list.length; paint(); if (manual) restart(); }
  function restart() {
    if (timer) clearInterval(timer);
    if (list.length > 1) timer = setInterval(() => go(idx + 1), opts.interval || 4500);
  }
  wrap.addEventListener('mouseenter', () => { if (timer) clearInterval(timer); });
  wrap.addEventListener('mouseleave', restart);
  paint();
  restart();
  return wrap;
}

const CAT_NAMES = {
  // App categories
  social: 'تواصل اجتماعي', communication: 'اتصالات', tools: 'أدوات', productivity: 'إنتاجية',
  entertainment: 'ترفيه', education: 'تعليم', photography: 'تصوير', music: 'موسيقى وصوتيات',
  video_players: 'مشغّلات فيديو', finance: 'مالية', shopping: 'تسوق', news: 'أخبار ومجلات',
  health: 'صحة ولياقة', travel: 'سفر ومحلّي', food: 'طعام وشراب', lifestyle: 'أسلوب حياة',
  books: 'كتب ومراجع', business: 'أعمال', dating: 'تعارف', maps: 'خرائط وملاحة',
  medical: 'طبّي', personalization: 'تخصيص', sports: 'رياضة', weather: 'طقس',
  auto: 'سيارات ومركبات', beauty: 'جمال وتجميل', art_design: 'فنّ وتصميم',
  house_home: 'منزل', parenting: 'أبوّة وأمومة', events: 'فعاليات', comics: 'قصص مصوّرة',
  other: 'أخرى',
  // Game categories
  game_action: 'أكشن', game_adventure: 'مغامرات', game_arcade: 'أركيد', game_board: 'ألعاب لوحية',
  game_card: 'ورق (كوتشينة)', game_casino: 'كازينو', game_casual: 'عادية', game_educational: 'تعليمية',
  game_music: 'موسيقى', game_puzzle: 'ألغاز', game_racing: 'سباقات', game_rpg: 'تقمّص أدوار',
  game_simulation: 'محاكاة', game_sports: 'رياضية', game_strategy: 'استراتيجية',
  game_trivia: 'معلومات عامة', game_word: 'كلمات', game_other: 'ألعاب أخرى',
  // Legacy
  games: 'ألعاب',
};
function categoryName(slug) { return t(CAT_NAMES[slug] || ''); }

/* -------------------------- States UI -------------------------- */
function spinner() { return el('div', { class: 'center' }, el('div', { class: 'spinner' })); }

// --- Skeleton loaders ---
function skEl(w, h, cls = '') {
  return el('div', { class: `sk ${cls}`, style: { width: w, height: h, flexShrink: '0' } });
}
function skeletonHome() {
  const wrap = el('div', { class: 'sk-section' });
  // Hero skeleton
  wrap.append(el('div', { class: 'sk-card', style: { width: '100%', height: '180px', marginBottom: '20px' } }));
  // Section title
  wrap.append(skEl('35%', '18px'));
  // Poster row
  const row = el('div', { class: 'sk-hrow', style: { marginTop: '12px' } });
  for (let i = 0; i < 4; i++) {
    const p = el('div', { class: 'sk-poster' });
    p.append(el('div', { class: 'sk-card', style: { width: '100px', height: '100px', borderRadius: '20px' } }));
    p.append(skEl('80px', '10px'));
    p.append(skEl('50px', '8px'));
    row.append(p);
  }
  wrap.append(row);
  // List section
  wrap.append(skEl('30%', '18px', ''), el('div', { style: { height: '16px' } }));
  for (let i = 0; i < 4; i++) {
    const r = el('div', { class: 'sk-row' });
    r.append(skEl('48px', '48px', 'sk-circle'));
    const info = el('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', gap: '6px' } });
    info.append(skEl('60%', '12px'));
    info.append(skEl('40%', '10px'));
    r.append(info);
    wrap.append(r);
  }
  return wrap;
}
function skeletonDetail() {
  const wrap = el('div');
  const hdr = el('div', { class: 'sk-detail-header' });
  hdr.append(skEl('80px', '80px', '', ''));
  const hInfo = el('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' } });
  hInfo.append(skEl('70%', '18px'));
  hInfo.append(skEl('40%', '14px'));
  hInfo.append(skEl('30%', '12px'));
  hdr.append(hInfo);
  wrap.append(hdr);
  // Button skeleton
  const body = el('div', { class: 'sk-detail-body' });
  body.append(skEl('100%', '44px', ''));
  // Stats row
  const stats = el('div', { style: { display: 'flex', gap: '24px', justifyContent: 'center', marginTop: '8px' } });
  for (let i = 0; i < 3; i++) {
    const s = el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' } });
    s.append(skEl('40px', '16px'));
    s.append(skEl('50px', '10px'));
    stats.append(s);
  }
  body.append(stats);
  // Screenshots
  const scrRow = el('div', { style: { display: 'flex', gap: '10px', overflow: 'hidden', marginTop: '12px' } });
  for (let i = 0; i < 3; i++) scrRow.append(el('div', { class: 'sk-card', style: { width: '140px', height: '250px', flexShrink: '0', borderRadius: '12px' } }));
  body.append(scrRow);
  // Description
  body.append(skEl('50%', '16px'));
  body.append(skEl('100%', '12px'));
  body.append(skEl('90%', '12px'));
  body.append(skEl('75%', '12px'));
  wrap.append(body);
  return wrap;
}
function skeletonList() {
  const wrap = el('div', { class: 'sk-list-section' });
  for (let i = 0; i < 6; i++) {
    const r = el('div', { class: 'sk-row' });
    r.append(skEl('48px', '48px', 'sk-circle'));
    const info = el('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', gap: '6px' } });
    info.append(skEl('65%', '13px'));
    info.append(skEl('35%', '10px'));
    r.append(info);
    wrap.append(r);
  }
  return wrap;
}
function emptyState(title, hint, icon = 'package') {
  return el('div', { class: 'empty' }, ico(icon, 'icon'), el('h3', null, title), hint ? el('p', null, hint) : null);
}
function errorState(err) {
  if (err && (err.status === 0 || err.message === 'timeout'))
    return emptyState(t('تعذّر الاتصال بالخادم'), t('تحقّق من اتصالك بالإنترنت ثمّ حدّث الصفحة.'), 'globe');
  if (err && err.status >= 500)
    return emptyState(t('الخدمة غير متاحة مؤقتاً'), t('حاول لاحقاً بعد دقائق قليلة.'), 'info');
  return emptyState(t('تعذّر تحميل البيانات'), t('حدّث الصفحة وحاول مجدداً.'), 'info');
}

/* ----------------------------- Chrome ----------------------------- */
function avatarEl(user) {
  if (!user) {
    const btn = el('a', { href: '/login', class: 'avatar login-avatar', 'aria-label': t('تسجيل الدخول') });
    btn.append(ico('user', 'icon'));
    return btn;
  }
  const a = el('a', { href: '/account', class: 'avatar', 'aria-label': t('حسابك') });
  if (user.photoURL) a.append(el('img', { src: user.photoURL, alt: '', referrerpolicy: 'no-referrer' }));
  else a.append(document.createTextNode(initials(user)));
  return a;
}
function initials(user) {
  const n = (user && (user.displayName || user.email)) || '?';
  return n.trim().charAt(0).toUpperCase();
}

const NOTIF_SEEN_KEY = 'gs_notif_seen';

function notifSeenAt() {
  try { return Number(localStorage.getItem(NOTIF_SEEN_KEY) || 0) || 0; } catch { return 0; }
}
function setNotifSeenAt(ts) {
  try { localStorage.setItem(NOTIF_SEEN_KEY, String(Math.max(0, Number(ts || 0) || 0))); } catch {}
}
function maxNotifCreated(list) {
  return (list || []).reduce((max, n) => Math.max(max, Number(n && n.created_at || 0) || 0), 0);
}
function notifUnreadCount(list) {
  const seen = notifSeenAt();
  return (list || []).reduce((count, n) => count + (Number(n && n.created_at || 0) > seen ? 1 : 0), 0);
}
async function fetchNotifications() {
  try {
    const res = await api('/api/notifications?limit=30');
    return Array.isArray(res.notifications) ? res.notifications : [];
  } catch {
    return [];
  }
}
async function refreshBellBadge() {
  const badge = document.querySelector('.bell-btn .bell-badge');
  if (!badge) return;
  try {
    const list = await fetchNotifications();
    const count = notifUnreadCount(list);
    badge.textContent = count ? String(count) : '';
    badge.classList.toggle('hidden', !count);
  } catch {
    badge.textContent = '';
    badge.classList.add('hidden');
  }
}
async function openNotifications() {
  const overlay = el('div', { class: 'dialog-overlay' });
  const card = el('div', { class: 'dialog-card' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  card.append(
    el('div', { class: 'dialog-head' },
      el('div', { class: 'dialog-title' }, ico('bell'), t('الإشعارات')),
      el('button', { class: 'dialog-close', type: 'button', onclick: () => overlay.remove(), 'aria-label': t('إغلاق') }, ico('close')),
    ),
    el('div', { class: 'dialog-body' },
      el('div', { class: 'notifications-loading' }, el('div', { class: 'spinner' })),
    ),
  );
  overlay.append(card);
  document.body.append(overlay);

  let list = [];
  try {
    list = await fetchNotifications();
  } catch {}
  const seen = maxNotifCreated(list);
  if (seen) setNotifSeenAt(Math.max(notifSeenAt(), seen));
  await refreshBellBadge();

  const body = card.querySelector('.dialog-body');
  body.innerHTML = '';
  if (!list.length) {
    body.append(emptyState(t('لا توجد إشعارات بعد'), '', 'bell'));
    return;
  }

  list.forEach((n) => {
    const type = n.type === 'new_app' || n.type === 'update' || n.type === 'announcement' ? n.type : 'announcement';
    const row = n.app_slug
      ? el('a', { class: 'notif-row', href: `/app?slug=${encodeURIComponent(n.app_slug)}` })
      : el('div', { class: 'notif-row' });
    row.append(
      el('div', { class: 'notif-ico' }, ico(type === 'new_app' ? 'package' : type === 'update' ? 'download' : 'bell')),
      el('div', { class: 'notif-info' },
        el('div', { class: 'notif-top' },
          el('strong', null, n.title || ''),
          el('span', { class: `notif-type notif-type-${type}` }, type === 'new_app' ? t('تطبيق جديد') : type === 'update' ? t('تحديث') : t('إعلان')),
        ),
        n.body ? el('div', { class: 'notif-body' }, n.body) : null,
        el('div', { class: 'notif-meta' }, formatDate(n.created_at)),
      ),
    );
    body.append(row);
  });
}

// Google Play–style home header: brand logo (start), search + bell + avatar (end).
function topbarSearch(user) {
  const bellBadge = el('span', { class: 'bell-badge hidden' });
  const searchBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-label': t('بحث'),
    title: t('بحث'),
    onclick: () => { location.href = '/search'; },
  }, ico('search'));
  const bellBtn = el('button', {
    class: 'bell-btn icon-btn',
    type: 'button',
    'aria-label': t('الإشعارات'),
    title: t('الإشعارات'),
    onclick: openNotifications,
  }, ico('bell'), bellBadge);
  Promise.resolve().then(() => refreshBellBadge());
  // Profile avatar moved to the bottom nav ("أنت"); the search button now sits
  // where the avatar used to be (top end).
  return el('div', { class: 'topbar' },
    el('div', { class: 'topbar-home' },
      el('a', { href: '/', class: 'brand', 'aria-label': 'Golden Store' }, el('img', { src: '/images/logo.png', alt: 'Golden Store' })),
      el('div', { class: 'tb-spacer' }),
      bellBtn,
      searchBtn,
    ),
  );
}

// Back/title top bar (detail)
function topbarNav(title = '', actions = []) {
  return el('div', { class: 'topbar-nav' },
    el('button', { class: 'icon-btn', 'aria-label': t('رجوع'), onclick: () => history.length > 1 ? history.back() : (location.href = '/') }, ico('chevronEnd')),
    title ? el('div', { class: 'title' }, title) : el('div', { class: 'spacer' }),
    ...actions,
  );
}

const NAV_ITEMS_RAW = [
  { key: 'apps', label: 'التطبيقات', icon: 'apps', href: '/' },
  { key: 'games', label: 'الألعاب', icon: 'gamepad', href: '/games' },
  { key: 'library', label: 'مكتبتي', icon: 'download', href: '/account?tab=library' },
  { key: 'points', label: 'نقاطي', icon: 'coin', href: '/points' },
  { key: 'account', label: 'أنت', icon: 'user', href: '/account' },
];
function bottomNav(active) {
  const brand = el('a', { href: '/', class: 'sidebar-brand', 'aria-label': 'Golden Store' },
    el('img', { src: '/images/logo.png', alt: 'Golden Store' }),
    el('span', { class: 'sidebar-brand-text' },
      el('span', null, 'Golden'),
      el('b', null, 'Store'),
    ),
  );
  const nav = el('nav', { class: 'bottomnav' },
    el('div', { class: 'bottomnav-inner' },
      brand,
      ...NAV_ITEMS_RAW.map((it) => {
        // The account tab ("أنت") shows the signed-in user's profile picture
        // instead of a generic icon.
        const isAccount = it.key === 'account';
        let iconNode;
        if (isAccount && _user) {
          const av = el('span', { class: 'pill-ico nav-avatar' });
          if (_user.photoURL) av.append(el('img', { src: _user.photoURL, alt: '', referrerpolicy: 'no-referrer' }));
          else av.append(el('span', { class: 'nav-avatar-txt' }, initials(_user)));
          iconNode = av;
        } else {
          iconNode = el('span', { class: 'pill-ico' }, ico(it.icon, 'icon'));
        }
        return el('a', { href: it.href, class: `navitem ${it.key === active ? 'active' : ''}` },
          iconNode,
          el('span', { class: 'nav-label' }, t(it.label)),
        );
      }),
    ),
  );
  document.body.append(nav);
}

/* --------------------------- Auth gate --------------------------- */
// Sign-in UI lives on the dedicated /login page (see login.html / login.js).
// Other pages render optimistically from cache and redirect to /login when
// there is no valid session.

let _user = null;
let _authed = false;
let _ready = [];
let _gateEl = null;
let _chromeDone = false;

function devUser() {
  return { displayName: 'مستخدم تجريبي', email: 'demo@goldenstore.me', photoURL: null, uid: 'dev' };
}
function isLocalhost() {
  return ['localhost', '127.0.0.1', '0.0.0.0'].includes(location.hostname);
}

// Cache the last signed-in user so navigation between pages renders instantly
// (no login-screen flash) while Firebase re-validates the session in the background.
const CACHE_KEY = 'gs_user';
function cacheUser(user) {
  try {
    if (user) localStorage.setItem(CACHE_KEY, JSON.stringify({
      displayName: user.displayName || '', email: user.email || '', photoURL: user.photoURL || '', uid: user.uid || '',
    }));
    else localStorage.removeItem(CACHE_KEY);
  } catch {}
}
function cachedUser() {
  try { const v = localStorage.getItem(CACHE_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}

function hideGate() { if (_gateEl) { _gateEl.remove(); _gateEl = null; } }

function onAuthed(user) {
  const firstRender = !_authed;
  _user = user;
  _authed = true;
  hideGate();
  document.body.style.overflow = '';
  if (firstRender) {
    _ready.forEach((fn) => { try { fn(user); } catch (e) { console.error(e); } });
    _ready = [];
  }
}

function ready(fn) {
  if (_authed) { try { fn(_user); } catch (e) { console.error(e); } }
  else _ready.push(fn);
}

function isLoggedIn() { return !!_user; }

/* --------------------------- Points (نقاط التشغيل) --------------------------- */
const POINTS_CONFIG = {
  points_per_download: 10,
  points_per_dollar: 1000,
  min_withdraw_usd: 5,
  min_withdraw_points: 5000,
  referral_inviter: 10,
  referral_invitee: 5,
};

const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function pointsDb() {
  if (typeof firebase === 'undefined' || !firebase.database) {
    throw new Error('firebase_database_unavailable');
  }
  return firebase.database();
}

async function currentPointsUser() {
  if (!window.GAuth) return null;
  let user = typeof window.GAuth.getUser === 'function' ? window.GAuth.getUser() : null;
  if (!user && typeof window.GAuth.ready === 'function') {
    user = await window.GAuth.ready();
  }
  if (!user && typeof window.GAuth.getUser === 'function') {
    user = window.GAuth.getUser();
  }
  return user && user.uid ? user : null;
}

function unauthorizedError() {
  const e = new Error('unauthorized');
  e.status = 401;
  return e;
}

function sanitizeText(value, maxLen) {
  return String(value == null ? '' : value).trim().slice(0, maxLen);
}

function normalizeReferralCode(code) {
  return sanitizeText(code, 32).toUpperCase();
}

function randomReferralCode() {
  const bytes = new Uint8Array(6);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += REFERRAL_CODE_ALPHABET[bytes[i] % REFERRAL_CODE_ALPHABET.length];
  }
  return out;
}

function referralError(code) {
  const e = new Error(code);
  e.data = { error: code };
  return e;
}

// Rejects if the wrapped promise doesn't settle in time. Firebase RTDB
// operations hang indefinitely (no rejection) when the database instance is
// unreachable/not provisioned, which would otherwise leave the page spinning
// forever — this converts that into a normal error the UI can surface.
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const e = new Error(label || 'timeout');
      e.code = 'timeout';
      reject(e);
    }, ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function transactionPromise(ref, updateFn) {
  return new Promise((resolve, reject) => {
    ref.transaction(updateFn, (error, committed, snapshot) => {
      if (error) reject(error);
      else resolve({ committed, snapshot });
    }, false);
  });
}

async function readOnce(ref, ms = 12000, label = 'timeout') {
  return withTimeout(ref.once('value'), ms, label);
}

async function processReferralClaims(uid) {
  if (!uid) return;
  try {
    const db = pointsDb();
    const claimsRef = db.ref(`referral_claims/${uid}`);
    const userRef = db.ref(`user_points/${uid}`);
    const [claimsSnap, userSnap] = await withTimeout(Promise.all([
      claimsRef.once('value'),
      userRef.once('value'),
    ]), 6000, 'referrals_timeout');

    const state = userSnap && userSnap.val ? (userSnap.val() || {}) : {};
    const referredInvitees = state.referred_invitees && typeof state.referred_invitees === 'object'
      ? state.referred_invitees
      : {};
    const claims = [];
    if (claimsSnap && claimsSnap.forEach) {
      claimsSnap.forEach((child) => {
        const val = child.val() || {};
        const inviteeUid = sanitizeText(val.invitee_uid, 128);
        if (!inviteeUid) return;
        claims.push({ id: child.key, invitee_uid: inviteeUid, points: Number(val.points || 0), processed: !!val.processed });
      });
    }
    if (!claims.length) return;

    const byInvitee = new Map();
    claims.forEach((claim) => {
      if (!byInvitee.has(claim.invitee_uid)) byInvitee.set(claim.invitee_uid, []);
      byInvitee.get(claim.invitee_uid).push(claim.id);
    });
    const newInvitees = Array.from(byInvitee.keys()).filter((inviteeUid) => !referredInvitees[inviteeUid]);
    if (newInvitees.length) {
      await withTimeout(transactionPromise(userRef, (current) => {
        const currentState = current && typeof current === 'object' ? current : {};
        const currentInvitees = currentState.referred_invitees && typeof currentState.referred_invitees === 'object'
          ? currentState.referred_invitees
          : {};
        const stillNew = newInvitees.filter((inviteeUid) => !currentInvitees[inviteeUid]);
        if (!stillNew.length) return currentState;
        const next = Object.assign({}, currentState);
        next.balance = Number(next.balance || 0) + (POINTS_CONFIG.referral_inviter * stillNew.length);
        next.total_earned = Number(next.total_earned || 0) + (POINTS_CONFIG.referral_inviter * stillNew.length);
        next.referral_points = Number(next.referral_points || 0) + (POINTS_CONFIG.referral_inviter * stillNew.length);
        next.referral_count = Number(next.referral_count || 0) + stillNew.length;
        next.referred_invitees = Object.assign({}, currentInvitees);
        stillNew.forEach((inviteeUid) => { next.referred_invitees[inviteeUid] = true; });
        next.updated_at = Date.now();
        return next;
      }), 6000, 'referrals_timeout');
    }
    await withTimeout(
      Promise.all(claims.map((claim) => claimsRef.child(claim.id).update({ processed: true }).catch(() => {}))),
      6000,
      'referrals_timeout',
    ).catch(() => {});
  } catch (e) {}
}

async function ensureReferralCode(user) {
  if (!user || !user.uid) throw unauthorizedError();
  const db = pointsDb();
  const uid = user.uid;
  const userRef = db.ref(`user_points/${uid}`);
  const userSnap = await withTimeout(userRef.once('value'), 6000, 'referral_timeout');
  const current = userSnap && userSnap.val ? (userSnap.val() || {}) : {};
  if (current.referral_code) {
    await withTimeout(transactionPromise(db.ref(`referral_codes/${current.referral_code}`), (value) => value || uid), 6000, 'referral_timeout').catch(() => {});
    return current.referral_code;
  }

  for (let i = 0; i < 8; i += 1) {
    const code = randomReferralCode();
    const codeRef = db.ref(`referral_codes/${code}`);
    const codeSnap = await withTimeout(codeRef.once('value'), 6000, 'referral_timeout');
    if (codeSnap && codeSnap.exists && codeSnap.exists()) continue;
    const codeTxn = await transactionPromise(codeRef, (value) => {
      if (value && value !== uid) return value;
      return uid;
    });
    if (!codeTxn.committed) continue;
    const userTxn = await transactionPromise(userRef, (value) => {
      const state = value && typeof value === 'object' ? value : {};
      if (state.referral_code) return state;
      const next = Object.assign({}, state, {
        referral_code: code,
        updated_at: Date.now(),
      });
      return next;
    });
    if (userTxn.committed) return code;
    const latestSnap = await withTimeout(userRef.once('value'), 6000, 'referral_timeout');
    const latest = latestSnap && latestSnap.val ? (latestSnap.val() || {}) : {};
    if (latest.referral_code) {
      if (latest.referral_code !== code) {
        await withTimeout(codeRef.remove(), 6000, 'referral_timeout').catch(() => {});
      }
      return latest.referral_code;
    }
    await withTimeout(codeRef.remove(), 6000, 'referral_timeout').catch(() => {});
  }

  throw new Error('referral_code_unavailable');
}

async function getReferral() {
  const user = await currentPointsUser();
  if (!user || !user.uid) throw unauthorizedError();
  const uid = user.uid;
  processReferralClaims(uid).catch(() => {});
  const code = await ensureReferralCode(user);
  const db = pointsDb();
  const snap = await withTimeout(db.ref(`user_points/${uid}`).once('value'), 8000, 'referral_timeout');
  const state = snap && snap.val ? (snap.val() || {}) : {};
  return {
    code,
    referred_by: state.referred_by || '',
    referral_count: Number(state.referral_count || 0),
    referral_points: Number(state.referral_points || 0),
    invite_url: `${location.origin}/points?ref=${code}`,
  };
}

async function applyReferral(rawCode) {
  const code = normalizeReferralCode(rawCode);
  if (!code || code.length !== 6 || !new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{6}$`).test(code)) {
    const e = referralError('invalid_code');
    e.status = 400;
    throw e;
  }

  const user = await currentPointsUser();
  if (!user || !user.uid) throw unauthorizedError();
  const db = pointsDb();
  const uid = user.uid;
  const codeSnap = await withTimeout(db.ref(`referral_codes/${code}`).once('value'), 12000, 'referral_timeout').catch(() => null);
  if (!codeSnap || !codeSnap.exists || !codeSnap.exists()) {
    const e = referralError('invalid_code');
    e.status = 400;
    throw e;
  }
  const inviterUid = codeSnap.val();
  if (!inviterUid || typeof inviterUid !== 'string') {
    const e = referralError('invalid_code');
    e.status = 400;
    throw e;
  }
  if (inviterUid === uid) {
    const e = referralError('self_referral');
    e.status = 400;
    throw e;
  }

  const userRef = db.ref(`user_points/${uid}`);
  let lastError = null;
  const txn = await transactionPromise(userRef, (current) => {
    lastError = null;
    const state = current && typeof current === 'object' ? current : {};
    if (state.referred_by) {
      lastError = 'already_referred';
      return;
    }
    const next = Object.assign({}, state);
    next.balance = Number(next.balance || 0) + POINTS_CONFIG.referral_invitee;
    next.total_earned = Number(next.total_earned || 0) + POINTS_CONFIG.referral_invitee;
    next.referred_by = code;
    next.updated_at = Date.now();
    return next;
  });
  if (!txn.committed) {
    const e = referralError(lastError || 'already_referred');
    e.status = 400;
    throw e;
  }

  try {
    const claimRef = db.ref(`referral_claims/${inviterUid}`).push();
    await withTimeout(claimRef.set({
      invitee_uid: uid,
      points: POINTS_CONFIG.referral_inviter,
      ts: Date.now(),
    }), 12000, 'referral_timeout');
  } catch (e) {}

  return { ok: true, invitee_reward: POINTS_CONFIG.referral_invitee };
}

async function authedApi(path, opts = {}) {
  if (!window.GAuth || !window.GAuth.getIdToken) { const e = new Error('unauthorized'); e.status = 401; throw e; }
  // Pages render optimistically from the cached user, so Firebase may not have
  // resolved _currentUser yet. Wait for it before requesting an ID token.
  let token = await window.GAuth.getIdToken();
  if (!token && window.GAuth.ready) { await window.GAuth.ready(); token = await window.GAuth.getIdToken(true); }
  if (!token) { const e = new Error('unauthorized'); e.status = 401; throw e; }
  const headers = Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, opts.headers || {});
  return api(path, { ...opts, headers });
}

// REST read fallback: the realtime SDK connection (websocket/long-polling) is
// blocked on some networks/browsers, which made the points page fail even
// though the database itself is reachable over plain HTTPS.
async function rtdbRestGet(path) {
  const base = (typeof firebase !== 'undefined' && firebase.app && firebase.app().options.databaseURL) || '';
  if (!base) throw new Error('rtdb_unavailable');
  const url = `${base.replace(/\/+$/, '')}/${path}.json`;
  let token = null;
  try {
    token = window.GAuth && window.GAuth.getIdToken ? await window.GAuth.getIdToken() : null;
  } catch {}
  let res = await withTimeout(fetch(token ? `${url}?auth=${encodeURIComponent(token)}` : url), 10000, 'points_timeout');
  if (!res.ok && token && (res.status === 401 || res.status === 403)) {
    res = await withTimeout(fetch(url), 10000, 'points_timeout');
  }
  if (!res.ok) { const e = new Error('rtdb_rest_failed'); e.status = res.status; throw e; }
  return res.json();
}

async function pointsBalance() {
  const user = await currentPointsUser();
  if (!user || !user.uid) throw unauthorizedError();
  const uid = user.uid;
  // Process referral claims in the background — don't block balance display
  withTimeout(processReferralClaims(uid), 8000, 'referrals_timeout').catch(() => {});

  let state = {};
  let rawWithdrawals = {};
  try {
    const db = pointsDb();
    const [pointsSnap, withdrawalsSnap] = await withTimeout(Promise.all([
      db.ref(`user_points/${uid}`).once('value'),
      db.ref(`withdrawals/${uid}`).once('value').catch(() => null),
    ]), 7000, 'points_timeout');
    state = pointsSnap && pointsSnap.val && pointsSnap.val() ? pointsSnap.val() : {};
    rawWithdrawals = withdrawalsSnap && withdrawalsSnap.val ? (withdrawalsSnap.val() || {}) : {};
  } catch (sdkErr) {
    const [restState, restWithdrawals] = await Promise.all([
      rtdbRestGet(`user_points/${uid}`),
      rtdbRestGet(`withdrawals/${uid}`).catch(() => null),
    ]);
    state = restState && typeof restState === 'object' ? restState : {};
    rawWithdrawals = restWithdrawals && typeof restWithdrawals === 'object' ? restWithdrawals : {};
  }

  const balance = Number(state.balance || 0);
  const dollars = Number((balance / POINTS_CONFIG.points_per_dollar).toFixed(2));

  let withdrawals = [];
  try {
    withdrawals = Object.entries(rawWithdrawals)
      .map(([id, record]) => ({ id, ...(record && typeof record === 'object' ? record : {}) }))
      .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
      .slice(0, 50);
  } catch {}

  return {
    balance,
    dollars,
    total_earned: Number(state.total_earned || 0),
    total_withdrawn_usd: Number(state.withdrawn_amount || 0),
    can_withdraw: balance >= POINTS_CONFIG.min_withdraw_points,
    withdrawals,
    config: POINTS_CONFIG,
  };
}

async function pointsWithdraw(payload = {}) {
  const user = await currentPointsUser();
  if (!user || !user.uid) throw unauthorizedError();
  const db = pointsDb();
  const uid = user.uid;
  const method = sanitizeText(payload.method, 40);
  const account = sanitizeText(payload.account, 200);
  const requestedAmount = payload.amount_usd == null || payload.amount_usd === ''
    ? null
    : Math.floor(Number(payload.amount_usd));
  const pointsRef = db.ref(`user_points/${uid}`);
  const withdrawalsRef = db.ref(`withdrawals/${uid}`);

  let lastError = null;
  let appliedAmount = null;
  let withdrawalData = null;

  const { committed, snapshot } = await withTimeout(transactionPromise(pointsRef, (current) => {
    lastError = null;
    const state = current && typeof current === 'object' ? current : {};
    const balance = Number(state.balance || 0);
    const totalEarned = Number(state.total_earned || 0);
    const withdrawnAmount = Number(state.withdrawn_amount || 0);
    const totalWithdrawals = Number(state.total_withdrawals || 0);
    const earnedApps = state.earned_apps && typeof state.earned_apps === 'object' ? state.earned_apps : {};
    const maxUsd = Math.floor(balance / POINTS_CONFIG.points_per_dollar);
    const amountUsd = requestedAmount == null ? maxUsd : requestedAmount;

    if (maxUsd < POINTS_CONFIG.min_withdraw_usd) {
      lastError = 'insufficient_points';
      return;
    }
    if (!Number.isFinite(amountUsd) || amountUsd < POINTS_CONFIG.min_withdraw_usd) {
      lastError = 'below_minimum';
      return;
    }
    if (amountUsd > maxUsd) {
      lastError = 'insufficient_points';
      return;
    }

    appliedAmount = amountUsd;
    withdrawalData = {
      uid,
      email: user.email || '',
      name: user.displayName || '',
      points_spent: amountUsd * POINTS_CONFIG.points_per_dollar,
      amount_usd: amountUsd,
      method,
      account,
      status: 'pending',
      ts: Date.now(),
    };

    return {
      balance: balance - withdrawalData.points_spent,
      total_earned: totalEarned,
      withdrawn_amount: withdrawnAmount + amountUsd,
      total_withdrawals: totalWithdrawals + 1,
      earned_apps: earnedApps,
      updated_at: Date.now(),
    };
  }), 12000, 'withdraw_timeout');

  if (!committed) {
    const e = new Error(lastError || 'withdraw_failed');
    e.status = 400;
    if (lastError) e.data = { error: lastError };
    throw e;
  }

  const pushRef = withdrawalsRef.push();
  await pushRef.set(withdrawalData);
  const finalState = snapshot && snapshot.val ? (snapshot.val() || {}) : {};
  return {
    ok: true,
    balance: Number(finalState.balance || 0),
    amount_usd: appliedAmount,
    withdrawal_id: pushRef.key,
  };
}

// Grant points for installing an app. Safe to call multiple times — the
// database only awards once per app per user. Silently no-ops for signed-out users.
async function earnPoints(slug) {
  if (!slug) return null;
  const user = await currentPointsUser();
  if (!user || !user.uid) return null;
  try {
    const db = pointsDb();
    const uid = user.uid;
    const ref = db.ref(`user_points/${uid}`);
    let earned = 0;
    await transactionPromise(ref, (current) => {
      const state = current && typeof current === 'object' ? current : {};
      const earnedApps = state.earned_apps && typeof state.earned_apps === 'object' ? state.earned_apps : {};
      if (earnedApps[slug]) return state;
      earned = POINTS_CONFIG.points_per_download;
      return {
        balance: Number(state.balance || 0) + earned,
        total_earned: Number(state.total_earned || 0) + earned,
        withdrawn_amount: Number(state.withdrawn_amount || 0),
        total_withdrawals: Number(state.total_withdrawals || 0),
        earned_apps: Object.assign({}, earnedApps, { [slug]: true }),
        updated_at: Date.now(),
      };
    });
    if (earned) {
      toast('+' + earned + ' ' + t('نقطة في حسابك'), 'success');
      return { ok: true, earned };
    }
    return null;
  } catch (e) { return null; }
}
// Shows a login-required modal; returns a Promise that resolves to the user
// (after successful sign-in) or rejects if cancelled.
function requireAuth() {
  if (_user) return Promise.resolve(_user);
  return new Promise((resolve, reject) => {
    const overlay = el('div', { class: 'dialog-overlay auth-required-overlay' });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); reject(new Error('cancelled')); } });
    const card = el('div', { class: 'dialog-card auth-required-card' },
      el('div', { class: 'auth-required-header' },
        el('img', { src: '/images/logo.png', alt: 'Golden Store', class: 'auth-logo' }),
        el('h2', { class: 'auth-title' }, t('تسجيل الدخول مطلوب')),
        el('p', { class: 'auth-desc' }, t('سجّل الدخول بحساب Google لتتمكن من تنزيل التطبيقات والتقييم والمزيد.')),
      ),
      el('button', { class: 'gbtn auth-google-btn', type: 'button', html: '<svg class="gico" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span class="gbtn-label">' + t('متابعة باستخدام Google') + '</span>', onclick: async () => {
        try {
          const user = await window.GAuth.signInWithGoogle();
          if (user) {
            cacheUser(user);
            onAuthed(user);
            overlay.remove();
            resolve(user);
          }
        } catch (e) {
          if (e && e.code === 'auth/in-app-browser') {
            toast(t('افتح الرابط في المتصفح الخارجي لتسجيل الدخول'), 'error');
          } else {
            toast(t('تعذّر تسجيل الدخول، حاول مجدداً'), 'error');
          }
        }
      } }),
      el('button', { class: 'btn btn-secondary auth-cancel-btn', type: 'button', onclick: () => { overlay.remove(); reject(new Error('cancelled')); } }, t('إلغاء')),
    );
    overlay.append(card);
    document.body.append(overlay);
  });
}

let _redirectingToLogin = false;
function goToLogin() {
  if (_redirectingToLogin) return;
  _redirectingToLogin = true;
  const next = location.pathname + location.search;
  location.replace('/login?next=' + encodeURIComponent(next));
}

function initAuth() {
  const refCode = sanitizeText(getQuery('ref'), 32);
  if (refCode) setPendingReferral(refCode);

  // Localhost-only preview bypass (never active in production).
  if (isLocalhost() && getQuery('devskip') === '1') { onAuthed(devUser()); return; }

  // Optimistic render: if the user signed in before, show the store immediately
  // and let Firebase confirm the session in the background (avoids login flash).
  const cached = cachedUser();
  if (cached) onAuthed(cached);

  // If GAuth isn't available (SDK failed to load), allow browsing as guest.
  if (!window.GAuth || typeof window.GAuth.onAuthChange !== 'function') {
    console.error('GAuth not available — Firebase SDK may have failed to load');
    if (!cached) onAuthed(null);
    return;
  }

  try { window.GAuth.init(); } catch (e) { console.error('GAuth.init failed', e); }
  window.GAuth.onAuthChange((user) => {
    if (user) {
      cacheUser(user);
      onAuthed(user);
    } else {
      // No valid session: allow browsing as guest.
      cacheUser(null);
      _user = null;
      if (!_authed) onAuthed(null);
    }
  });
}

async function signOut() {
  cacheUser(null);
  try { await window.GAuth.signOut(); } catch {}
  location.href = '/';
}

/* ----------------------------- Boot ----------------------------- */
function boot() { initAuth(); }

/* ----------------------------- Download History ----------------------------- */
const DL_HISTORY_KEY = 'gs_downloads';
function getDownloadHistory() {
  try { return JSON.parse(localStorage.getItem(DL_HISTORY_KEY) || '[]'); } catch { return []; }
}
function addToDownloadHistory(app) {
  try {
    const list = getDownloadHistory();
    // Remove existing entry for same slug to avoid duplicates
    const filtered = list.filter((e) => e.slug !== app.slug);
    filtered.unshift({
      slug: app.slug,
      name: app.name,
      icon_url: app.icon_url || null,
      developer: app.developer || '',
      size_bytes: app.size_bytes || 0,
      downloaded_at: Math.floor(Date.now() / 1000),
    });
    // Keep max 200 entries
    localStorage.setItem(DL_HISTORY_KEY, JSON.stringify(filtered.slice(0, 200)));
  } catch {}
}
function clearDownloadHistory() {
  try { localStorage.removeItem(DL_HISTORY_KEY); } catch {}
}

const ACTIVE_DL_KEY = 'gs_active_dl';
function getActiveDownloadMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(ACTIVE_DL_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}
function notifyActiveDownloads() {
  try { window.dispatchEvent(new CustomEvent('gs-active-dl')); } catch {}
}
function writeActiveDownloadMap(map) {
  try { localStorage.setItem(ACTIVE_DL_KEY, JSON.stringify(map)); } catch {}
  notifyActiveDownloads();
}
function getActiveDownloads() {
  return Object.values(getActiveDownloadMap()).sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
}
function setActiveDownload(entry) {
  if (!entry || !entry.slug) return null;
  const map = getActiveDownloadMap();
  map[entry.slug] = { ...(map[entry.slug] || {}), ...entry };
  writeActiveDownloadMap(map);
  return map[entry.slug];
}
function updateActiveDownloadProgress(slug, progress) {
  if (!slug) return;
  const map = getActiveDownloadMap();
  const entry = map[slug];
  if (!entry) return;
  entry.progress = progress;
  map[slug] = entry;
  writeActiveDownloadMap(map);
}
function removeActiveDownload(slug) {
  if (!slug) return;
  const map = getActiveDownloadMap();
  if (!map[slug]) return;
  delete map[slug];
  writeActiveDownloadMap(map);
}
function onActiveDownloadsChange(fn) {
  const handler = () => fn(getActiveDownloads());
  const onStorage = (e) => {
    if (!e || e.key === ACTIVE_DL_KEY || e.key === null) handler();
  };
  window.addEventListener('gs-active-dl', handler);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('gs-active-dl', handler);
    window.removeEventListener('storage', onStorage);
  };
}


/* --------------- Native app integration (Capacitor/WebView) --------------- */
// Disable pinch/double-tap zoom, long-press text selection and the callout
// menu so the store feels like a native app. Inputs stay selectable so search
// and forms keep working.
(function injectNativeUx() {
  try {
    var style = document.createElement('style');
    style.textContent =
      'html,body{-webkit-text-size-adjust:100%;touch-action:manipulation;}' +
      '*{-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;}' +
      'body{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;}' +
      'input,textarea,[contenteditable="true"]{-webkit-user-select:text;user-select:text;}' +
      '.bottomnav .nav-avatar{display:flex;align-items:center;justify-content:center;}' +
      '.bottomnav .nav-avatar img{width:24px;height:24px;border-radius:50%;object-fit:cover;display:block;}' +
      '.bottomnav .nav-avatar-txt{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#0d0d0f;background:#e0b64c;}';
    (document.head || document.documentElement).appendChild(style);
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
    // Block pinch-zoom via multi-touch.
    document.addEventListener('touchmove', function (e) {
      if (e.touches && e.touches.length > 1) e.preventDefault();
    }, { passive: false });
  } catch (e) {}
})();

// FCM push token bridge. The native app fetches its FCM token and calls
// window.__gsRegisterPushToken(token). We forward it to the backend only for
// logged-in users, so pushes reach registered users only.
(function pushBridge() {
  var currentToken = null;
  var registeredToken = null;

  async function registerIfPossible() {
    if (!currentToken) return;
    if (registeredToken === currentToken) return;
    try {
      if (!window.Store || !window.Store.isLoggedIn || !window.Store.isLoggedIn()) return;
      await authedApi('/api/notifications/register-token', {
        method: 'POST',
        body: JSON.stringify({ token: currentToken, platform: 'android' }),
      });
      registeredToken = currentToken;
    } catch (e) { /* retry on next auth/token event */ }
  }

  window.__gsRegisterPushToken = function (token) {
    if (!token || typeof token !== 'string') return;
    currentToken = token;
    registerIfPossible();
  };

  window.__gsUnregisterPushToken = function (token) {
    var tok = token || currentToken;
    if (!tok) return;
    registeredToken = null;
    try {
      api('/api/notifications/unregister-token', {
        method: 'POST',
        body: JSON.stringify({ token: tok }),
      });
    } catch (e) {}
  };

  // Re-register whenever auth state settles (login) and drop on logout.
  try {
    if (window.GAuth && window.GAuth.onAuthChange) {
      window.GAuth.onAuthChange(function (user) {
        if (user) registerIfPossible();
        else if (currentToken) window.__gsUnregisterPushToken(currentToken);
      });
    }
  } catch (e) {}
})();

window.Store = {
  STORE, api, el, ico, t,
  formatBytes, formatCount, formatNum, formatDate, ratingOf, ratingValue, ratingCountOf, getQuery, toast,
  posterCard, listRow, gridCard, featureCarousel, categoryName,
  spinner, skeletonHome, skeletonDetail, skeletonList, emptyState, errorState,
  topbarSearch, topbarNav, bottomNav, avatarEl, themeToggleBtn, langSwitcherEl, toggleTheme, currentTheme,
  fetchNotifications, notifUnreadCount, openNotifications,
  ready, signOut, getUser: () => _user, isLoggedIn, requireAuth, goToLogin,
  pointsConfig: POINTS_CONFIG, getReferral, applyReferral, getPendingReferral, clearPendingReferral,
  earnPoints, pointsBalance, pointsWithdraw,
  getDownloadHistory, addToDownloadHistory, clearDownloadHistory,
  getActiveDownloads, setActiveDownload, updateActiveDownloadProgress, removeActiveDownload, onActiveDownloadsChange,
};

document.addEventListener('DOMContentLoaded', boot);
