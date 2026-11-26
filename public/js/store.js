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
applyTheme(currentTheme());

/* ----------------------------- API ----------------------------- */
function isNativeApp() {
  return typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
}

/* Is this the INSTALLED APP rather than the website?
 *
 * isNativeApp() alone is not enough: the Android WebView exposes the GSAndroid
 * bridge and does NOT always inject Capacitor's JS runtime, so isNativeApp()
 * returns false inside the APK. Every API call then stayed relative and resolved
 * against the WebView's own origin — https://localhost/api/… — which has no
 * server behind it. The result was exactly the owner's report: «في الموقع تظهر
 * ولكن في التطبيق لا». Nothing could load inside the APK, not just the store
 * list but settings and notifications too.
 *
 * A plain remote WebView (no bridge at all) is NOT native by this test: those
 * load pages straight from goldenstore.online, where same-origin works.
 */
function isNativeShell() {
  if (isNativeApp()) return true;                     // Capacitor runtime injected
  try {
    if (hasDeviceBridge()) return true;               // GSAndroid bridge present
    const proto = String(location.protocol || '');
    if (proto === 'capacitor:' || proto === 'file:') return true;
    const host = String(location.hostname || '');
    // A Capacitor WebView serves the bundle from a local host with no API.
    if ((host === 'localhost' || host === '127.0.0.1') && window.GSAndroid) return true;
  } catch (e) {}
  return false;
}
/* The Android WebView exposes GSAndroid, NOT Capacitor. Device/install helpers
   must use this bridge detector; isNativeApp() stays for API-base routing. */
function hasDeviceBridge() {
  try {
    const b = window.GSAndroid;
    return !!(b && (
      typeof b.downloadApk === 'function' ||
      typeof b.checkAppStatus === 'function' ||
      typeof b.isPackageInstalled === 'function' ||
      typeof b.isSlugInstalled === 'function' ||
      typeof b.cancelDownload === 'function' ||
      typeof b.getDownloadStates === 'function'
    ));
  } catch (e) { return false; }
}
/* The installed app cannot use same-origin requests: its WebView runs on
 * https://localhost (Android) or capacitor://localhost (iOS), so every API call
 * is cross-origin and needs an absolute URL.
 *
 * This constant used to be 'https://api.goldenstore.online'. That hostname is
 * still stuck on Cloudflare's 100:: placeholder — the Worker custom domain
 * cannot be bound because the zone is in a different account (deploy error
 * 10084). The website was moved off it when the 522 was fixed, but the app was
 * not, so the installed app kept calling a dead host: nothing on the store
 * loaded inside the APK while the website looked fine (owner: «في الموقع تظهر
 * ولكن في التطبيق لا»).
 *
 * The Worker's own workers.dev hostname answers 200 with no zone permissions at
 * all, so that is the app's base now. A Capacitor config `apiBase` still wins,
 * so a future custom domain can be introduced without touching this file —
 * but note it must be an ABSOLUTE url: falling back to the page's own origin
 * (as the old code did when apiBase was unset) means calling localhost.
 */
const STORE_API_ORIGIN = 'https://goldenstore-api.faycalfaycal13526.workers.dev';

// The origins a Capacitor WebView reports. They must be allowed by the Worker's
// CORS middleware, otherwise the app is rejected before any JSON is read.
const NATIVE_ORIGINS = ['https://localhost', 'capacitor://localhost', 'http://localhost'];

function isNativeOrigin(origin) {
  if (!origin) return false;
  return NATIVE_ORIGINS.includes(origin);
}

function apiBaseUrl() {
  if (!isNativeShell()) return '';
  try {
    const cfg = window.Capacitor && window.Capacitor.getConfig && window.Capacitor.getConfig();
    if (cfg && cfg.apiBase) return cfg.apiBase;
  } catch (e) {}
  return STORE_API_ORIGIN;
}

// Exposed for the test suite: it asserts both the host and that no caller can
// silently fall back to same-origin inside the app.
try { window.__gsApiOrigin = STORE_API_ORIGIN; window.__gsIsNativeOrigin = isNativeOrigin; } catch (e) {}

function fullApiUrl(path) {
  const base = apiBaseUrl();
  return base && path.startsWith('/') ? base + path : path;
}

/* ── Last known good catalogue ───────────────────────────────────────────────
 * Owner: «التطبيقات والألعاب تنزل بشكل ثقيل والصور فيها تقليتش» on a 4G phone.
 * Every list was re-fetched and re-drawn from nothing on each visit: if the
 * network was slow, the store looked empty or half-drawn for seconds, and every
 * icon started again from zero bytes.
 *
 * The answer to slow is not only a smaller payload — it is showing the screen
 * IMMEDIATELY and refreshing behind it. The last successful list is kept in
 * localStorage (a few KB), painted straight away, then replaced by fresh data
 * when it arrives; if the request fails, the cached list simply stays. Images
 * never start from zero twice because they are cached by the browser now.
 */
const LIST_CACHE_PREFIX = 'gs_list_v1:';
function readListCache(key) {
  try {
    const raw = localStorage.getItem(LIST_CACHE_PREFIX + key);
    if (!raw) return null;
    const box = JSON.parse(raw);
    if (!box || !Array.isArray(box.apps) || !box.apps.length) return null;
    return box;
  } catch (e) { return null; }
}
function writeListCache(key, data) {
  try {
    const apps = Array.isArray(data) ? data : (data && data.apps);
    if (!Array.isArray(apps) || !apps.length) return;
    const slim = apps.slice(0, 60).map((a) => ({
      id: a.id, slug: a.slug, name: a.name, developer: a.developer, category: a.category,
      type: a.type, name_lower: a.name_lower, version_name: a.version_name,
      size_bytes: a.size_bytes, rating: a.rating, rating_count: a.rating_count,
      stars: a.stars, downloads: a.downloads, icon_url: a.icon_url, feature_url: a.feature_url,
    }));
    localStorage.setItem(LIST_CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), apps: slim }));
  } catch (e) { /* quota or private mode */ }
}
// Keeps a list usable while the fresh copy loads, and survives a dead link.
async function apiList(path, opts = {}) {
  const cacheKey = opts.cacheKey || path;
  try {
    const data = await api(path, opts);
    writeListCache(cacheKey, data);
    return data;
  } catch (err) {
    const cached = readListCache(cacheKey);
    if (!cached) throw err;
    console.warn('[store] الشبكة تعثّرت — نعرض القائمة المحفوظة:', (err && err.message) || err);
    return { ...cached, stale: true };
  }
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
  try {
    if (isNativeShell() && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) {
      return apiNativeCap(path, opts, timeoutMs);
    }
  } catch (e) { /* fall through to fetch */ }
  /* Not every build ships CapacitorHttp. Without this the absolute base was
     computed and then thrown away, so the APK kept calling its own origin. */
  const requestPath = fullApiUrl(path);
  const ctrl = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetch(requestPath, {
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
function t(s) {
  try {
    const g = window.GSI18N;
    if (g && typeof g.t === 'function') return g.t(s);
  } catch (e) {}
  return s;
}

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

function ratingCountOf(app) {
  return Number((app && (app.rating_count != null ? app.rating_count : app.stars)) || 0);
}
function ratingValue(app) {
  return Number((app && app.rating) || 0);
}
function ratingOf(app) {
  if (ratingCountOf(app) <= 0) return null;
  return ratingValue(app).toFixed(1);
}

function getQuery(name) { return new URLSearchParams(location.search).get(name) || ''; }

/* Round 42f (owner screenshot): inside the Android app `publicOrigin()` returned
   the API host — a shared link read https://api.goldenstore.online/app?slug=… and
   opened nothing. Every shared link must point at the PUBLIC site. */
const PUBLIC_HOST = 'goldenstore.online';
function publicSiteOrigin() {
  const origin = (typeof location !== 'undefined' && location.origin) ? location.origin : '';
  let host = '';
  try { host = (location.hostname || '').toLowerCase(); } catch (e) { host = ''; }
  /* A real browser on the store domain, a preview host, or localhost: the page's
     own origin is already the public site. */
  if (host === PUBLIC_HOST || host === 'www.' + PUBLIC_HOST) return `https://${PUBLIC_HOST}`;
  /* Capacitor/APK: its WebView origin is https://localhost or capacitor://localhost,
     which is useless for a shared link — always the public store. */
  try { if (isNativeApp()) return `https://${PUBLIC_HOST}`; } catch (e) {}
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return origin;
  /* Capacitor / a wrapped WebView on file://, localhost or the API host: the
     public store is the only link that opens for a normal person. */
  if (!host || host === 'api.' + PUBLIC_HOST) return `https://${PUBLIC_HOST}`;
  return origin || `https://${PUBLIC_HOST}`;
}

function publicOrigin() {
  try {
    if (isNativeApp()) {
      const cfg = window.Capacitor && window.Capacitor.getConfig && window.Capacitor.getConfig();
      const base = (cfg && (cfg.apiBase || cfg.server && cfg.server.url)) || '';
      if (base) return base.replace(/\/+$/, '');
      return STORE_API_ORIGIN;
    }
  } catch (e) {}
  return location.origin;
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
function posterCard(a) {
  const rt = ratingOf(a);
  return el('a', { href: `/app?slug=${encodeURIComponent(a.slug)}`, class: 'poster' },
    el('div', { class: 'art' }, a.icon_url ? el('img', { src: a.icon_url, alt: appName(a), loading: 'lazy', decoding: 'async', width: '96', height: '96' }) : ico('package', 'icon icon-lg')),
    el('div', { class: 'nm' }, el('bdi', appNameAttrs(a), appName(a))),
    rt
      ? el('div', { class: 'rt' }, el('span', null, rt), ico('star', 'icon fill'))
      : el('div', { class: 'rt' }, el('span', null, t('جديد'))),
  );
}

function listRow(a, opts = {}) {
  const cat = categoryName(a.category);
  const rt = ratingOf(a);
  return el('a', { href: `/app?slug=${encodeURIComponent(a.slug)}`, class: 'approw' },
    el('div', { class: 'art' }, a.icon_url ? el('img', { src: a.icon_url, alt: appName(a), loading: 'lazy', decoding: 'async', width: '96', height: '96' }) : ico('package', 'icon icon-lg')),
    el('div', { class: 'info' },
      el('div', { class: 'nm' }, el('bdi', appNameAttrs(a), appName(a))),
      el('div', { class: 'sub' }, el('bdi', devAttrs(a.developer), a.developer || cat || STORE.name)),
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

function gridCard(a) {
  const rt = ratingOf(a);
  return el('a', { href: `/app?slug=${encodeURIComponent(a.slug)}`, class: 'grid-card' },
    el('div', { class: 'grid-art' }, a.icon_url ? el('img', { src: a.icon_url, alt: appName(a), loading: 'lazy', decoding: 'async', width: '96', height: '96' }) : ico('package', 'icon icon-lg')),
    el('div', { class: 'grid-info' },
      el('div', { class: 'grid-name' }, el('bdi', appNameAttrs(a), appName(a))),
      el('div', { class: 'grid-meta' }, `${a.version_name ? 'v' + a.version_name : ''}${a.version_name ? ' • ' : ''}${formatBytes(a.size_bytes || 0)}`),
      el('div', { class: 'grid-rating' },
        rt ? el('span', null, rt) : el('span', null, t('جديد')),
        rt ? ico('star', 'icon fill') : null,
      ),
    ),
  );
}

function featureSlide(a) {
  const slide = el('a', { href: `/app?slug=${encodeURIComponent(a.slug)}`, class: 'fc-slide' });
  const media = el('div', { class: 'fc-media' });
  if (a.feature_url) {
    media.append(el('img', { src: a.feature_url, alt: appName(a), loading: 'lazy', decoding: 'async', class: 'fc-media-img' }));
  } else {
    media.classList.add('fc-media-fallback');
    media.append(a.icon_url
      ? el('img', { class: 'fc-fallback-ico', src: a.icon_url, alt: '', loading: 'lazy' })
      : ico('package', 'icon icon-lg'));
  }
  // Owner request: the hero (featured) image stays clean — the full description
  // is NOT overlaid on it. It still appears on the app page and on the list cards.
  const rt = ratingOf(a);
  slide.append(
    media,
    el('div', { class: 'fc-bar' },
      el('div', { class: 'fc-bar-ico' }, a.icon_url ? el('img', { src: a.icon_url, alt: '' }) : ico('package', 'icon')),
      el('div', { class: 'fc-bar-text' },
        el('div', { class: 'fc-bar-name' }, appName(a)),
        el('div', { class: 'fc-bar-sub' },
          el('span', devAttrs(a.developer), a.developer || ''),
          rt ? el('span', { class: 'fc-bar-rate' }, rt, ico('star', 'icon fill')) : null,
        ),
      ),
      el('span', { class: 'fc-bar-btn' }, t('تثبيت')),
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
  /* Owner request: the hero images move BY THEMSELVES as well — they rotate
     through the featured apps/games of the page they belong to, exactly like
     the manual swipe does, and any manual swipe restarts the rotation. */
  const AUTO_ADVANCE = true;
  const AUTO_MS = opts.interval || 5000;

  function slideWidth() {
    return track.clientWidth || wrap.clientWidth || 1;
  }
  function maxIndex() { return Math.max(0, list.length - 1); }
  function setIdx(i) {
    const clamped = Math.max(0, Math.min(maxIndex(), i));
    if (clamped === idx) return;
    idx = clamped;
    Array.from(dots.children).forEach((d, k) => d.classList.toggle('on', k === idx));
  }
  function goTo(i, smooth) {
    const clamped = Math.max(0, Math.min(maxIndex(), i));
    try { track.scrollTo({ left: clamped * slideWidth(), behavior: smooth ? 'smooth' : 'auto' }); }
    catch (e) { track.scrollLeft = clamped * slideWidth(); }
    setIdx(clamped);
  }
  function go(i, manual) { goTo(i, true); if (manual && AUTO_ADVANCE) restart(); }
  function restart() {
    if (timer) { clearInterval(timer); timer = null; }
    if (!AUTO_ADVANCE || list.length <= 1) return;
    if (typeof document !== 'undefined' && document.hidden) return;  // paused tab
    timer = setInterval(() => {
      // Never advance a carousel that left the page, or inside a hidden tab.
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!wrap.isConnected) { if (timer) { clearInterval(timer); timer = null; } return; }
      go(idx >= maxIndex() ? 0 : idx + 1);
    }, AUTO_MS);
  }
  function paint() { goTo(idx, false); }

  let rafPending = false;
  track.addEventListener('scroll', () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const w = slideWidth();
      if (w > 0) setIdx(Math.round(track.scrollLeft / w));
    });
  }, { passive: true });

  let touchResumeTimer = null;
  track.addEventListener('touchstart', () => {
    if (timer) clearInterval(timer);
    if (touchResumeTimer) clearTimeout(touchResumeTimer);
  }, { passive: true });
  track.addEventListener('touchend', () => {
    if (!AUTO_ADVANCE) return;
    if (touchResumeTimer) clearTimeout(touchResumeTimer);
    touchResumeTimer = setTimeout(restart, 4000);
  }, { passive: true });
  wrap.addEventListener('mouseenter', () => { if (timer) { clearInterval(timer); timer = null; } });
  wrap.addEventListener('mouseleave', restart);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) restart(); });
  paint();
  restart();
  return wrap;
}

const CAT_NAMES = {
  social: 'تواصل اجتماعي', communication: 'اتصالات', tools: 'أدوات', productivity: 'إنتاجية',
  entertainment: 'ترفيه', education: 'تعليم', photography: 'تصوير', music: 'موسيقى وصوتيات',
  video_players: 'مشغّلات فيديو', finance: 'مالية', shopping: 'تسوق', news: 'أخبار ومجلات',
  health: 'صحة ولياقة', travel: 'سفر ومحلّي', food: 'طعام وشراب', lifestyle: 'أسلوب حياة',
  books: 'كتب ومراجع', business: 'أعمال', dating: 'تعارف', maps: 'خرائط وملاحة',
  medical: 'طبّي', personalization: 'تخصيص', sports: 'رياضة', weather: 'طقس',
  auto: 'سيارات ومركبات', beauty: 'جمال وتجميل', art_design: 'فنّ وتصميم',
  house_home: 'منزل', parenting: 'أبوّة وأمومة', events: 'فعاليات', comics: 'قصص مصوّرة',
  vpn: 'VPN وخصوصية', system: 'أدوات النظام', wallpapers: 'خلفيات', files: 'إدارة الملفات',
  connectivity: 'اتصال وشبكات', other: 'أخرى',
  game_action: 'أكشن', game_adventure: 'مغامرات', game_arcade: 'أركيد', game_board: 'ألعاب لوحية',
  game_card: 'ورق (كوتشينة)', game_casino: 'كازينو', game_casual: 'عادية', game_educational: 'تعليمية',
  game_music: 'موسيقى', game_puzzle: 'ألغاز', game_racing: 'سباقات', game_rpg: 'تقمّص أدوار',
  game_simulation: 'محاكاة', game_sports: 'رياضية', game_strategy: 'استراتيجية',
  game_trivia: 'معلومات عامة', game_word: 'كلمات', game_other: 'ألعاب أخرى',
  game_family: 'عائلية', game_shooter: 'إطلاق نار', game_action_adventure: 'حركة ومغامرة',
  game_role_playing: 'ألعاب جماعية',
  games: 'ألعاب',
};
// App/game name in the visitor's language. The canonical (often English) name
// stays in `name`; the translated one is added by /api/i18n-names under `name_t`.
const NAME_ATTR = 'data-i18n-app';
function appName(a) {
  if (!a) return '';
  const raw = (a.name_t && String(a.name_t)) || a.name || '';
  const g = window.GSI18N;
  return (g && typeof g.appName === 'function') ? g.appName(raw) : raw;
}
function appNameAttrs(a) {
  // Lets the translation layer fill the name in when the language changes.
  const nm = a && a.name ? String(a.name) : '';
  return nm ? { 'data-i18n-app': nm } : {};
}
// Descriptions and developer lines are translated too: the attribute keeps the
// original text so a language switch can repaint it without a reload.
function descText(a) {
  if (!a) return '';
  return String(a.description || a.short_description || '');
}
function descAttrs(a) {
  const d = descText(a);
  return d ? { 'data-i18n-desc': d } : {};
}
function devText(a) {
  if (!a || !a.developer) return '';
  return String(a.developer);
}
function devAttrs(v) {
  // Publishers paste an RTL mark into the developer line; the attribute keeps
  // the readable text so the same phrase can be translated consistently.
  const d = String(v || '').replace(/[\u200e\u200f\u061c]/g, '').trim();
  return d ? { 'data-i18n-dev': d } : {};
}
function categoryName(slug) {
  if (!slug) return '';
  const known = CAT_NAMES[slug];
  if (known) return t(known);
  const lookup = window.GSI18N && window.GSI18N.lookup;
  const arKey = typeof lookup === 'function' ? lookup(slug) : null;
  if (arKey) return t(arKey);
  return t(slug);
}

/* -------------------------- States UI -------------------------- */
function spinner() { return el('div', { class: 'center' }, el('div', { class: 'spinner' })); }

function skEl(w, h, cls = '') {
  return el('div', { class: `sk ${cls}`, style: { width: w, height: h, flexShrink: '0' } });
}
function skeletonHome() {
  const wrap = el('div', { class: 'sk-section' });
  wrap.append(el('div', { class: 'sk-card', style: { width: '100%', height: '180px', marginBottom: '20px' } }));
  wrap.append(skEl('35%', '18px'));
  const row = el('div', { class: 'sk-hrow', style: { marginTop: '12px' } });
  for (let i = 0; i < 4; i++) {
    const p = el('div', { class: 'sk-poster' });
    p.append(el('div', { class: 'sk-card', style: { width: '100px', height: '100px', borderRadius: '20px' } }));
    p.append(skEl('80px', '10px'));
    p.append(skEl('50px', '8px'));
    row.append(p);
  }
  wrap.append(row);
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
  const body = el('div', { class: 'sk-detail-body' });
  body.append(skEl('100%', '44px', ''));
  const stats = el('div', { style: { display: 'flex', gap: '24px', justifyContent: 'center', marginTop: '8px' } });
  for (let i = 0; i < 3; i++) {
    const s = el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' } });
    s.append(skEl('40px', '16px'));
    s.append(skEl('50px', '10px'));
    stats.append(s);
  }
  body.append(stats);
  const scrRow = el('div', { style: { display: 'flex', gap: '10px', overflow: 'hidden', marginTop: '12px' } });
  for (let i = 0; i < 3; i++) scrRow.append(el('div', { class: 'sk-card', style: { width: '140px', height: '250px', flexShrink: '0', borderRadius: '12px' } }));
  body.append(scrRow);
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
function skeletonSimilar() {
  const row = el('div', { class: 'sk-similar' });
  for (let i = 0; i < 4; i++) {
    const c = el('div', { class: 'sk-sim-card' });
    c.append(el('div', { class: 'sk-card', style: { width: '104px', height: '104px', borderRadius: '20px' } }));
    c.append(skEl('84px', '10px'));
    row.append(c);
  }
  const wrap = el('div', { class: 'd-section' }, skEl('35%', '16px'), row);
  wrap.style.padding = '16px';
  return wrap;
}
function emptyState(title, hint, icon = 'package') {
  return el('div', { class: 'empty' }, ico(icon, 'icon'), el('h3', null, title), hint ? el('p', null, hint) : null);
}
function offlineScreen() {
  const online = typeof navigator !== 'undefined' && navigator.onLine !== false;
  const steps = [
    t('تأكّد من تشغيل الواي فاي أو بيانات الهاتف.'),
    t('جرّب فتح صفحة أخرى للتأكد من عمل الإنترنت.'),
    t('أوقف VPN أو البروكسي مؤقتاً ثم أعد المحاولة.'),
  ];
  // A genuine full-screen page: brand header, illustration, three step cards,
  // primary retry + home link, and an auto-reload hint. No small dialog card.
  return el('div', { class: 'gs-offline-wrap', 'data-noi18n': '' },
    el('header', { class: 'gs-offline-top' },
      el('a', { class: 'gs-offline-brand', href: '/' },
        el('img', { src: '/images/logo.png', alt: 'Golden Store', draggable: 'false' }),
        el('span', null, 'Golden', el('b', null, 'Store')),
      ),
    ),
    el('main', { class: 'gs-offline-card', role: 'alert', 'aria-live': 'assertive', 'data-noi18n': '' },
      el('div', { class: 'gs-offline-art' },
        el('span', { class: 'gs-offline-art-ring' }),
        el('div', { class: 'gs-offline-logo' },
          el('img', { src: '/images/logo.png', alt: 'Golden Store', draggable: 'false' })),
        el('span', { class: 'gs-offline-art-glyph' },
          ico('globe', 'icon'), el('span', { class: 'gs-offline-art-slash' })),
      ),
      el('span', { class: 'gs-offline-badge' }, t('لا يوجد اتصال بالإنترنت')),
      el('h1', { class: 'gs-offline-title' }, t('تعذّر الاتصال بالخادم')),
      el('p', { class: 'gs-offline-hint' }, t('تحقّق من اتصالك بالإنترنت ثم أعد المحاولة.')),
      el('div', { class: `gs-offline-status${online ? ' is-online' : ''}` },
        el('span', { class: 'dot' }), t(online ? 'الاتصال غير مستقر' : 'أنت غير متصل')),
      el('ol', { class: 'gs-offline-steps' },
        ...steps.map((step, i) => el('li', null,
          el('span', { class: 'n' }, String(i + 1)), el('span', null, step)))),
      el('div', { class: 'gs-offline-actions' },
        el('button', {
          class: 'gs-offline-retry', type: 'button',
          onclick: () => { try { location.reload(); } catch (e) {} },
        }, ico('refresh', 'icon'), t('إعادة المحاولة')),
        el('a', { class: 'gs-offline-home', href: '/' },
          ico('home', 'icon'), t('العودة إلى الرئيسية')),
      ),
      el('p', { class: 'gs-offline-foot' },
        ico('refresh', 'icon'), t('سيُعاد تحميل الصفحة تلقائياً عند عودة الاتصال.')),
    ),
    el('footer', { class: 'gs-offline-bottom' }, 'Golden Store · ', t('متجر التطبيقات والألعاب')),
  );
}

function errorState(err) {
  const offline = err && (err.status === 0 || err.message === 'timeout'
    || (typeof navigator !== 'undefined' && navigator.onLine === false));
  if (offline) return offlineScreen();
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
function notifBaseline(uid) {
  try {
    if (!uid) return 0;
    const k = 'gs_notif_base_' + uid;
    let b = Number(localStorage.getItem(k) || 0) || 0;
    if (!b) { b = Math.floor(Date.now() / 1000); localStorage.setItem(k, String(b)); }
    return b;
  } catch { return 0; }
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
/* The feed carries the signed-in user's PRIVATE rows too (support replies,
   likes received). They are only returned when the Authorization header is
   present, so the request is authenticated whenever a session exists and falls
   back to the plain public feed otherwise. */
async function fetchNotifications() {
  try {
    let res;
    try {
      if (window.GAuth && window.GAuth.getIdToken) res = await authedApi('/api/notifications?limit=30');
    } catch (e) { res = null; }
    if (!res) res = await api('/api/notifications?limit=30');
    return Array.isArray(res.notifications) ? res.notifications : [];
  } catch {
    return [];
  }
}
async function refreshBellBadge() {
  const badge = document.querySelector('.bell-btn .bell-badge');
  if (!badge) return;
  try {
    let list = await fetchNotifications();
    const base = notifBaseline(_user && _user.uid);
    if (base) list = list.filter((n) => Number(n.created_at || 0) > base);
    const count = notifUnreadCount(list);
    badge.textContent = count ? String(count) : '';
    badge.classList.toggle('hidden', !count);
  } catch {
    badge.textContent = '';
    badge.classList.add('hidden');
  }
}
function openNotifications() {
  // Notifications are now a standalone full page, not a small dialog.
  try { location.href = '/notifications'; } catch (e) {}
}

// Shared loader for the standalone notifications page: applies the same
// per-user baseline as the bell badge, marks everything as seen, refreshes
// the badge, and returns the curated list.
async function loadNotificationsForPage() {
  let list = await fetchNotifications();
  const base = notifBaseline(_user && _user.uid);
  if (base) list = list.filter((n) => Number(n.created_at || 0) > base);
  // NOTE: the page no longer marks everything read on load — it keeps the red
  // «unread» dots visible (owner request) and marks read on tap instead.
  await refreshBellBadge();
  return list;
}


/* «ادعم قولدن ستور» — the hand-with-heart panel from the owner's reference.
   It is opened from the round heart button that now sits in the store top bar
   (next to «مكتبتي» / «الإشعارات» / «بحث»), so the markup lives here where every
   page can reach it. Only a tap opens it — never automatically. */
const SUPPORT_HIDE_KEY = 'gs_support_sheet_hidden';
const CANONICAL_HOST = 'goldenstore.online';
const TELEGRAM_URL = 'https://t.me/goldenstore_10';

function supportSheetHidden() {
  try { return localStorage.getItem(SUPPORT_HIDE_KEY) === '1'; } catch (e) { return false; }
}
function hideSupportSheet(on) {
  try { if (on) localStorage.setItem(SUPPORT_HIDE_KEY, '1'); else localStorage.removeItem(SUPPORT_HIDE_KEY); } catch (e) {}
}
/* ---------------------------------------------------------------------------
   DURABLE DOWNLOAD — the only way a transfer really survives leaving the page
   ---------------------------------------------------------------------------
   The APK itself is downloaded by code inside the installed app, which this
   repository does not contain. Every web-side fix so far (permanent URL, pause
   record, hand-off bookkeeping) can only make the transfer *resumable* or
   *visible*; it cannot keep a WebView-owned connection alive after the WebView
   goes away. A downloader that must survive app switches has to be owned by the
   operating system.

   `downloadApkDurable` asks the app's bridge for exactly that. The app should
   implement it with `DownloadManager` (which android owns, survives the page and
   even a process kill, retries on its own and shows a system notification):

     @JavascriptInterface
     fun downloadApkDurable(url: String, filename: String, slug: String,
                            pkg: String, name: String, icon: String) {
         val req = DownloadManager.Request(Uri.parse(url))
             .setTitle(name)
             .setDescription(name)
             .setNotificationVisibility(
                 DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
             .setDestinationInExternalFilesDir(
                 ctx, Environment.DIRECTORY_DOWNLOADS, filename)
             .setAllowedOverMetered(true)
             .setAllowedOverRoaming(true)
         val id = mgr.enqueue(req)          // OS owns it from here on
         rememberDownloadId(slug, id)       // for progress polling
     }

   Until that method exists, this returns false and the caller keeps the current
   behaviour, so nothing breaks on an older build. */
/* ---------------------------------------------------------------------------
   CAPACITOR: WHO OWNS THE TRANSFER
   ---------------------------------------------------------------------------
   The app is a Capacitor shell. That matters, because a `fetch` started in the
   WebView is killed the moment the page is hidden — no web code can keep it
   alive. Capacitor, however, offers downloads that run in the NATIVE layer, and
   a native transfer is owned by Android, not by the page, so it keeps going when
   the user opens another app.

   Order of preference (each one is checked before use):
     1. GSAndroid.downloadApkDurable  → Android DownloadManager (survives even a
        process kill, shows a system notification).
     2. Filesystem.downloadFile       → @capacitor/filesystem native download.
        Runs outside the WebView, so navigating away no longer stops it. Needs
        only `npm i @capacitor/filesystem` + `npx cap sync android`.
     3. GSAndroid.downloadApk         → a custom bridge, if the build has one.
     4. Browser.open / window.open    → the system browser owns the download.
     5. the old in-page stream        → last resort only.
   ------------------------------------------------------------------------- */
function capPlugin(name) {
  try {
    const C = window.Capacitor;
    if (!C) return null;
    if (C.Plugins && C.Plugins[name]) return C.Plugins[name];
    if (C.registerPlugin) {
      try { const p = C.registerPlugin(name); if (p) return p; } catch (e) {}
    }
  } catch (e) {}
  return null;
}

function hasCapacitorFilesystem() {
  const fs = capPlugin('Filesystem');
  return !!(fs && typeof fs.downloadFile === 'function');
}

function hasCapacitorBrowser() {
  const b = capPlugin('Browser');
  return !!(b && typeof b.open === 'function');
}

/* Which durable routes exist right now — used by the UI to say something true. */
function durableRoutes() {
  return {
    downloadManager: !!(window.GSAndroid && typeof window.GSAndroid.downloadApkDurable === 'function'),
    filesystem: hasCapacitorFilesystem(),
    bridge: !!(window.GSAndroid && typeof window.GSAndroid.downloadApk === 'function'),
    browser: hasCapacitorBrowser() || !!(window.GSAndroid && typeof window.GSAndroid.openExternal === 'function'),
  };
}

/* Start a NATIVE (page-independent) download. Resolves to the route used, or ''
   when nothing durable is available so the caller can fall back. */
async function startNativeDownload(app, filename, onProgress) {
  if (!app || !app.slug) return '';
  const url = downloadableUrl(app);
  if (!url) return '';
  const name = filename || `${app.slug}.apk`;

  // 1) Android DownloadManager — survives app switches and process death.
  if (window.GSAndroid && typeof window.GSAndroid.downloadApkDurable === 'function') {
    try {
      window.GSAndroid.downloadApkDurable(url, name, app.slug, app.package_name || '', app.name || '', app.icon_url || '');
      return 'downloadManager';
    } catch (e) {}
  }

  // 2) Capacitor Filesystem — a native download that the page does not own.
  const fs = capPlugin('Filesystem');
  if (fs && typeof fs.downloadFile === 'function') {
    try {
      const target = `downloads/${name}`;
      const done = fs.downloadFile({ url, path: target, progress: true });
      if (onProgress && typeof fs.addListener === 'function') {
        try {
          fs.addListener('progress', (ev) => {
            const total = Number(ev && ev.contentLength) || 0;
            const moved = Number(ev && ev.bytes) || 0;
            if (total > 0) onProgress(Math.min(1, moved / total));
          });
        } catch (e) {}
      }
      // Fire and forget: the native task continues even if this page is gone.
      Promise.resolve(done).then((res) => {
        try {
          window.dispatchEvent(new CustomEvent('gs-native-download-done', {
            detail: { slug: app.slug, path: (res && res.path) || target, filename: name },
          }));
        } catch (e) {}
      }).catch(() => {
        try { window.dispatchEvent(new CustomEvent('gs-native-download-failed', { detail: { slug: app.slug } })); } catch (e) {}
      });
      return 'filesystem';
    } catch (e) {}
  }

  // 3) A custom Capacitor/Android bridge, if the build exposes one.
  if (window.GSAndroid && typeof window.GSAndroid.downloadApk === 'function') {
    try {
      window.GSAndroid.downloadApk(url, name, app.slug, app.package_name || '', app.name || '', app.icon_url || '');
      return 'bridge';
    } catch (e) {}
  }

  // 4) Hand it to the system browser: Chrome uses DownloadManager itself.
  try {
    const b = capPlugin('Browser');
    if (b && typeof b.open === 'function') { await b.open({ url }); return 'browser'; }
  } catch (e) {}
  try {
    if (window.GSAndroid && typeof window.GSAndroid.openExternal === 'function') {
      window.GSAndroid.openExternal(url);
      return 'browser';
    }
  } catch (e) {}
  return '';
}

function downloadableUrl(app) {
  const url = app && typeof app.apk_url === 'string' ? app.apk_url : '';
  return /^https:\/\//.test(url) ? url : '';
}

function hasDurableDownloader() {
  try {
    return !!(window.GSAndroid && typeof window.GSAndroid.downloadApkDurable === 'function');
  } catch (e) { return false; }
}

/* Kept for older callers: true only when the OS-owned DownloadManager route is
   actually available. The full multi-route chain is startNativeDownload(). */
function startDurableDownload(app, filename) {
  if (!app || !app.slug) return false;
  const url = downloadableUrl(app);
  if (!url) return false;
  if (!hasDurableDownloader()) return false;
  try {
    window.GSAndroid.downloadApkDurable(
      url,
      filename || `${app.slug}.apk`,
      app.slug,
      app.package_name || '',
      app.name || '',
      app.icon_url || '',
    );
    return true;
  } catch (e) { return false; }
}

function openCanonicalSite() {
  const url = `https://${CANONICAL_HOST}/`;
  const bridge = window.GSAndroid;
  if (bridge && typeof bridge.openExternal === 'function') {
    try { bridge.openExternal(url); return; } catch (e) {}
  }
  window.location.href = url;
}
/* Round 42d: `document.execCommand('copy')` is the last resort that still works
   in an Android WebView and in insecure contexts. */
function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) { return false; }
}

/* Round 42e: inside the APK the store can also receive a shared link back
   ("share to Golden Store"), which is what makes the published links useful. */
const GS_TWA_ORIGIN = 'https://goldenstore.online';
function bindAndroidShareTarget() {
  try {
    if (typeof navigator.shareTarget === 'undefined') return;
    // Launch Queue (Chrome/Android TWA) — the APK forwards the shared text here.
    if (window.launchQueue && typeof window.launchQueue.setConsumer === 'function') {
      window.launchQueue.setConsumer((params) => {
        try {
          const files = (params && params.files) || [];
          if (!files.length) return;
          toast(t('تم استلام الملف المشترك'), 'success');
        } catch (e) {}
      });
    }
    const payload = (() => { try { return sessionStorage.getItem('gs_shared_payload') || ''; } catch (e) { return ''; } })();
    if (payload) {
      try { sessionStorage.removeItem('gs_shared_payload'); } catch (e) {}
      toast(t('تم استلام الرابط المشترك'), 'success');
    }
  } catch (e) {}
}

function shareStore(onDone) {
  const url = `https://${CANONICAL_HOST}/`;
  const data = { title: 'Golden Store', text: t('متجر قولدن ستور — تطبيقات وألعاب بأمان وبدون إعلانات مزعجة.'), url };
  /* Round 42d — «روابط النشر لا تعمل»: inside the Android app `navigator.share`
     does not exist, so «شارك الموقع» used to do nothing until the clipboard
     fallback. The app bridge is asked first, then the browser sheet. */
  const bridge = (window.GSAndroid && typeof window.GSAndroid === 'object') ? window.GSAndroid : null;
  if (bridge) {
    const fns = ['shareText', 'share', 'shareUrl', 'shareLink'];
    for (let i = 0; i < fns.length; i++) {
      try {
        if (typeof bridge[fns[i]] === 'function') {
          bridge[fns[i]](data.text + '\n' + url, data.title);
          if (onDone) onDone();
          return;
        }
      } catch (e) {}
    }
  }
  if (navigator.share) {
    navigator.share(data).then(() => onDone && onDone()).catch(() => {
      /* The user dismissing the sheet is not a failure, but a real error must
         still end in a copy — never in silence («لا تعمل»). */
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          toast(t('تم نسخ رابط الموقع'), 'success');
          if (onDone) onDone();
        }).catch(() => {
          if (legacyCopy(url)) { toast(t('تم نسخ رابط الموقع'), 'success'); if (onDone) onDone(); }
        });
      } else if (legacyCopy(url)) {
        toast(t('تم نسخ رابط الموقع'), 'success');
        if (onDone) onDone();
      }
    });
    return;
  }
  const done = (copied) => {
    toast(copied ? t('تم نسخ رابط الموقع') : t('انسخ الرابط من شريط العنوان'), copied ? 'success' : 'info');
    if (onDone) onDone();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => done(true)).catch(() => done(legacyCopy(url)));
  } else done(legacyCopy(url));
}

function openSupportSheet() {
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  function onKey(e) { if (e.key === 'Escape') close(); }
  const secondary = el('button', { class: 'support-sheet-btn secondary', type: 'button',
    onclick: () => shareStore(() => { secondary.lastChild.textContent = t('تمت المشاركة، شكراً لك'); }) },
    ico('share', 'icon'), el('span', null, t('شارك الموقع')));
  const card = el('div', { class: 'support-sheet-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-support-title' },
    el('button', { class: 'support-sheet-close', type: 'button', 'aria-label': t('إغلاق'), onclick: close }, ico('close', 'icon')),
    el('div', { class: 'support-sheet-glyph', 'aria-hidden': 'true' },
      el('img', { src: '/images/support-heart-hand.png', alt: '', width: '86', height: '80', decoding: 'async' })),
    el('h2', { class: 'support-sheet-title', id: 'gs-support-title' }, t('حافظ على قولدن ستور آمناً ومجانياً')),
    el('p', { class: 'support-sheet-text' }, t('نعمل كل يوم على تحديث التطبيقات ومراجعة الملفات قبل نشرها. طلبك للتحديث ومساهمتك في نشر الموقع هما ما يُبقيه مجانياً:')),
    el('ul', { class: 'support-sheet-list' },
      el('li', null, t('تغطية تكاليف السيرفر والنطاق')),
      el('li', null, t('تحديث أسرع للإصدارات الجديدة')),
      el('li', null, t('حجب المواقع المزيفة والملفات الخطرة')),
    ),
    el('p', { class: 'support-sheet-text' }, t('الموقع الرسمي الوحيد هو') + ' ' + CANONICAL_HOST + ' — ' + t('أي رابط آخر ليس تابعاً لنا، ومشاركتك للرابط الرسمي هي أهم دعم.')),
    el('div', { class: 'support-sheet-actions' },
      el('button', { class: 'support-sheet-btn primary', type: 'button', onclick: openCanonicalSite }, t('زيارة الموقع الرسمي')),
      secondary,
    ),
    el('a', { class: 'support-sheet-link', href: TELEGRAM_URL, target: '_blank', rel: 'noopener' }, ico('send', 'icon'), t('انضم الى المجموعة')),
    el('label', { class: 'support-sheet-never' },
      el('input', { type: 'checkbox', onchange: (e) => hideSupportSheet(e.target.checked) }),
      el('span', null, t('لا تُظهر هذه الرسالة مرة أخرى')),
    ),
  );
  const overlay = el('div', { class: 'dialog-overlay support-sheet-overlay', onclick: (e) => { if (e.target === overlay) close(); } }, card);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  const first = card.querySelector('.support-sheet-close');
  if (first) first.focus();
}

/* Round «heart in hand» button for the store top bar — same .icon-btn circle
   as «مكتبتي» and «الإشعارات». The artwork is the owner's own picture
   (public/images/support-heart-hand.png), keyed to transparent and shipped at
   3x so it stays sharp on every phone. */
function supportTopButton() {
  const muted = supportSheetHidden();
  return el('button', {
    class: 'icon-btn support-top-btn' + (muted ? ' is-muted' : ''),
    type: 'button',
    'aria-label': t('ادعم قولدن ستور'),
    title: t('ادعم قولدن ستور'),
    onclick: () => { openSupportSheet(); },
  }, el('img', { class: 'support-top-img', src: '/images/support-heart-hand.png', alt: '', width: '102', height: '95', decoding: 'async' }));
}

function topbarSearch(user) {
  const bellBadge = el('span', { class: 'bell-badge hidden' });
  const searchBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-label': t('بحث'),
    title: t('بحث'),
    onclick: () => { location.href = '/search'; },
  }, ico('search'));
  /* My Library: exact same .icon-btn circle/size as the notifications button,
     placed immediately BEFORE it on every page that uses topbarSearch(). */
  const libraryBtn = el('button', {
    class: 'icon-btn library-btn',
    type: 'button',
    'aria-label': t('مكتبتي'),
    title: t('مكتبتي'),
    onclick: () => { try { location.href = '/account?tab=library'; } catch (e) {} },
  }, ico('download'));
  const bellBtn = el('button', {
    class: 'bell-btn icon-btn',
    type: 'button',
    'aria-label': t('الإشعارات'),
    title: t('الإشعارات'),
    onclick: () => { try { location.href = '/notifications'; } catch (e) {} },
  }, ico('bell'), bellBadge);
  Promise.resolve().then(() => refreshBellBadge());
  return el('div', { class: 'topbar' },
    el('div', { class: 'topbar-home' },
      el('a', { href: '/', class: 'brand', 'aria-label': 'Golden Store' }, el('img', { src: '/images/logo.png', alt: 'Golden Store' })),
      el('div', { class: 'tb-spacer' }),
      supportTopButton(),
      libraryBtn,
      bellBtn,
      searchBtn,
    ),
  );
}

function topbarNav(title = '', actions = []) {
  return el('div', { class: 'topbar-nav' },
    el('button', { class: 'icon-btn', 'aria-label': t('رجوع'), onclick: () => {
      if (document.referrer && history.length > 1) history.back();
      else location.href = '/';
    } }, ico('chevronEnd')),
    title ? el('div', { class: 'title' }, title) : el('div', { class: 'spacer' }),
    ...actions,
  );
}

/* Owner request: the two first tabs are swapped — «الألعاب» then «التطبيقات». */
const NAV_ITEMS_RAW = [
  { key: 'games', label: 'الألعاب', icon: 'gamepad', href: '/' },
  { key: 'apps', label: 'التطبيقات', icon: 'apps', href: '/apps' },
  // Owner request: this button opens the blog, INSIDE the app, with a normal
  // newspaper icon.
  { key: 'library', label: 'مكتبتي', icon: 'newsList', href: '/articles' },
  { key: 'account', label: 'أنت', icon: 'user', href: '/account' },
];
/* ---------------- Legal pages, footer & sign-in consent ------------------ */
const LEGAL_LINKS = [
  { href: '/about',   label: 'من نحن' },
  { href: '/privacy', label: 'سياسة الخصوصية' },
  { href: '/terms',   label: 'شروط الخدمة' },
];
const CONSENT_MSG = 'يجب الموافقة على شروط الخدمة وسياسة الخصوصية قبل المتابعة.';

function consentRow(id) {
  // Links are siblings of <label>, never inside it: clicking a policy link
  // must navigate, not toggle the checkbox.
  const row = el('div', { class: 'legal-consent', 'data-noi18n': '' },
    el('input', { type: 'checkbox', id: id, class: 'legal-consent-box',
                  required: 'required', 'aria-required': 'true' }),
    el('label', { for: id, class: 'legal-consent-label' }, t('أوافق على')),
    el('a', { class: 'legal-link', href: '/terms', target: '_blank', rel: 'noopener noreferrer' }, t('شروط الخدمة')),
    el('span', { class: 'legal-consent-and' }, t('و')),
    el('a', { class: 'legal-link', href: '/privacy', target: '_blank', rel: 'noopener noreferrer' }, t('سياسة الخصوصية')),
  );
  row.addEventListener('change', () => {
    if (!consentAccepted(row)) return;
    try {
      if (window.GSLegal && window.GSLegal.recordConsent) window.GSLegal.recordConsent();
      else fetch('/api/legal/consent', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true, version: '2026-11-05' }) }).catch(() => {});
    } catch (e) {}
  });
  return row;
}

function consentAccepted(row) {
  const box = row && row.querySelector('input[type="checkbox"]');
  return !!(box && box.checked);
}

function renderSiteFooter() {
  if (document.querySelector('.site-footer')) return;
  // Per-page opt-out. Owner request: the notification centre ends with its
  // feed — no «© Golden Store» line and no legal-links footer underneath it.
  if (document.body && document.body.dataset && document.body.dataset.noFooter === '1') {
    // Belt and braces: drop anything a previous (cached) bundle already put there.
    document.querySelectorAll('.site-footer, #siteFooter').forEach((n) => n.remove());
    return;
  }
  const shell = document.querySelector('.shell') || document.body;
  const nav = el('nav', { class: 'legal-links', 'aria-label': t('روابط قانونية'), 'data-noi18n': '' },
    ...LEGAL_LINKS.map((l) => el('a', { class: 'legal-link', href: l.href }, t(l.label))));
  const cfg = window.GSSettings;
  const storeName = (cfg && cfg.get('store_name', 'Golden Store')) || 'Golden Store';
  const official = (cfg && /^https?:\/\//i.test(cfg.get('official_url', '')) && cfg.get('official_url'))
    || 'https://goldenstore.online';
  const supportEmail = (cfg && cfg.get('support_email', '')) || '';
  const telegram = (cfg && cfg.get('telegram_url', '')) || '';
  const f = el('footer', { class: 'site-footer', 'data-noi18n': '' },
    el('div', { class: 'site-footer-inner' },
      el('div', { class: 'site-footer-brand' }, '© ' + storeName + ' — ' + t('جميع الحقوق محفوظة')),
      nav,
      el('div', { class: 'site-footer-site' },
        t('الموقع الرسمي') + ': ',
        el('a', { class: 'legal-link', href: official, target: '_blank',
                  rel: 'noopener noreferrer', dir: 'ltr', 'data-setting': 'official_url' },
          official.replace(/^https?:\/\//, '').replace(/\/$/, '')),
      ),
      supportEmail ? el('a', { class: 'legal-link', href: 'mailto:' + supportEmail,
        'data-setting': 'support_email' }, supportEmail) : null,
      telegram ? el('a', { class: 'legal-link', href: telegram, target: '_blank',
        rel: 'noopener noreferrer', 'data-setting': 'telegram_url' }, 'Telegram') : null,
    ),
  );
  shell.append(f);
}

function bottomNav(active) {
  const brandName = (window.GSSettings && window.GSSettings.get('store_name', 'Golden Store')) || 'Golden Store';
  const brand = el('a', { href: '/', class: 'sidebar-brand', 'aria-label': brandName },
    el('img', { src: '/images/logo.png', alt: brandName }),
    el('span', { class: 'sidebar-brand-text' },
      el('span', null, brandName),
    ),
  );
  const nav = el('nav', { class: 'bottomnav' },
    el('div', { class: 'bottomnav-inner' },
      brand,
      ...NAV_ITEMS_RAW.map((it) => {
        let iconNode;
        /* Owner request: the «أنت» tab keeps ONE icon everywhere. It used to
           swap to the Google account photo (which on some accounts is just the
           e-mail avatar image), so it is always the plain user glyph now. */
        iconNode = el('span', { class: 'pill-ico' }, ico(it.icon, 'icon'));
        return el('a', {
          href: it.href,
          class: `navitem ${it.key === active ? 'active' : ''}`,
          rel: it.external ? 'noopener noreferrer' : null,
          'data-external': it.external ? '1' : null,
        },
          iconNode,
          el('span', { class: 'nav-label' }, t(it.label)),
        );
      }),
    ),
  );
  document.body.append(nav);
  wireNavAutoHide(nav);
  renderSiteFooter();
}

/* ---------- Bottom bar auto-hide, exactly like X / Twitter ----------
   Scrolling DOWN hides the bar under the screen edge; scrolling UP brings it
   back. Tapping/scrolling to the very top always shows it again. It listens in
   the capture phase so it also works when the page scrolls inside an inner
   container instead of <body>. Desktop (where this nav is a sidebar) ignores it
   through CSS. */
function wireNavAutoHide(nav) {
  if (!nav || nav.dataset.autohide === '1') return;
  nav.dataset.autohide = '1';
  const last = new WeakMap();
  let hidden = false;
  const setHidden = (v) => {
    if (hidden === v) return;
    hidden = v;
    nav.classList.toggle('nav-hidden', v);
  };
  const onScroll = (e) => {
    const t = (e && e.target) || null;
    let pos = null, key = null;
    if (!t || t === document || t === document.documentElement || t === document.body) {
      pos = (window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0);
      key = document.documentElement;
    } else if (typeof t.scrollTop === 'number') {
      pos = t.scrollTop;
      key = t;
    }
    if (pos === null || !key) return;
    const prev = last.has(key) ? last.get(key) : pos;
    last.set(key, pos);
    const dy = pos - prev;
    if (pos <= 8) { setHidden(false); return; }
    if (Math.abs(dy) < 6) return;           // ignore jitter / rubber banding
    if (dy > 0 && pos > 72) setHidden(true);
    else if (dy < 0) setHidden(false);
  };
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* --------------------------- Auth gate --------------------------- */

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

const CACHE_KEY = 'gs_user';

function cacheUser(user) {
  try {
    if (user) {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        displayName: user.displayName || '', email: user.email || '', photoURL: user.photoURL || '', uid: user.uid || '',
      }));
    } else localStorage.removeItem(CACHE_KEY);
  } catch {}
}
function cachedUser() {
  try { const v = localStorage.getItem(CACHE_KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}

function hideGate() { if (_gateEl) { _gateEl.remove(); _gateEl = null; } }

function onAuthed(user) {
  const firstRender = !_authed;
  const changed = _authed && (_user ? _user.uid : null) !== (user ? user.uid : null);
  _user = user;
  _authed = true;
  if (changed) emitAuthChanged(user);
  if (user && user.uid && !String(user.uid).startsWith('gs_')) notifBaseline(user.uid);
  hideGate();
  document.body.style.overflow = '';
  if (firstRender) {
    _ready.forEach((fn) => { try { fn(user); } catch (e) { console.error(e); } });
    _ready = [];
  }
}

/* Round 42 (owner: «المستخدم لم يسجل لا يستطيع التعليق ولا التقييم ولا الإعجاب»).
   After an in-page sign-in the review block used to keep its GUEST rendering
   until a reload — the invitation stayed and the stars/composer never appeared,
   so a freshly signed-in visitor still could not rate or comment. Every auth
   change now notifies the page. */
const _authListeners = [];
function onAuthChanged(fn) {
  if (typeof fn !== 'function') return () => {};
  _authListeners.push(fn);
  return () => {
    const i = _authListeners.indexOf(fn);
    if (i >= 0) _authListeners.splice(i, 1);
  };
}
function emitAuthChanged(user) {
  _authListeners.slice().forEach((fn) => { try { fn(user); } catch (e) { console.error(e); } });
}

function ready(fn) {
  if (_authed) { try { fn(_user); } catch (e) { console.error(e); } }
  else _ready.push(fn);
}

function isLoggedIn() { return !!_user; }

async function authedApi(path, opts = {}) {
  if (!window.GAuth || !window.GAuth.getIdToken) { const e = new Error('unauthorized'); e.status = 401; throw e; }
  let token = await window.GAuth.getIdToken();
  if (!token && window.GAuth.ready) { await window.GAuth.ready(); token = await window.GAuth.getIdToken(true); }
  if (!token) { const e = new Error('unauthorized'); e.status = 401; throw e; }
  const headers = Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, opts.headers || {});
  return api(path, { ...opts, headers });
}

/* Facebook-splash style "from" brand lockup. The /login page ships it as
   static markup; every in-app Google sign-in gate built below gets the same
   component so the attribution is visible wherever the Google button is.
   Decorative only: no link, no action, no pointer events. */
/* The Google «G» mark, shared by the rebuilt sign-in screens. */
const GOOGLE_G_HTML = '<svg class="gico" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

function fromBrandLockup() {
  return el('div', { class: 'gs-from', role: 'img', 'aria-label': 'from The Pirate Bay' },
    el('span', { class: 'gs-from-label', 'data-i18n-content': 'from' }, 'from'),
    el('img', {
      class: 'gs-from-mark', src: '/images/from-brand-blue.png',
      alt: 'The Pirate Bay', width: '612', height: '96',
    }));
}
function addFromBrand(host) {
  if (!host || host.querySelector('.gs-from')) return;
  host.append(fromBrandLockup());
}

/* ---------------------------------------------------------------------------
   Round 37 (owner request): the in-store sign-in screen — the one that appears
   ON TOP of a store page (a download, a rating, a review…) — now uses the SAME
   design as the rebuilt /login page: back arrow + title, logo, name, tagline,
   e-mail + password with a show/hide eye, forgot-password, create-account,
   submit, then the third-party (Google) block at the bottom.

   Behaviour is unchanged where it matters: nothing is requested before the
   Terms/Privacy box is ticked, and the promise still resolves with the user
   (or rejects on cancel) so every existing caller keeps working.
   --------------------------------------------------------------------------- */
function authGateForm(opts) {
  opts = opts || {};
  var onSuccess = typeof opts.onSuccess === 'function' ? opts.onSuccess : function () {};
  var onCancel = typeof opts.onCancel === 'function' ? opts.onCancel : function () {};
  var compact = !!opts.compact;

  var title = el('h1', { class: 'auth-sr', 'data-auth-title': '' }, t('تسجيل الدخول'));
  var note = el('p', { class: 'auth-note' }, t('قم بتسجيل حسابك بالبريد الإلكتروني الخاص بك'));

  /* Round 39: create-account extras, collected ONLY for the dashboard's
     «جمع المعلومات» page — never rendered anywhere in the storefront. */
  function regField(id, label, input) {
    return el('label', { class: 'auth-field auth-box', for: id, style: 'display:none' },
      el('span', { class: 'auth-field-label' }, label), input);
  }
  var nameInput = el('input', { id: 'gs-reg-name', type: 'text', maxlength: '50',
    autocomplete: 'username', placeholder: t('اسم المستخدم (4-50 حرف)'), 'aria-label': t('اسم المستخدم') });
  var countryInput = el('input', { id: 'gs-reg-country', type: 'text', maxlength: '60',
    autocomplete: 'country-name', placeholder: t('الدولة (اختياري)'), 'aria-label': t('الدولة') });
  var genderSelect = el('select', { id: 'gs-reg-gender', 'aria-label': t('الجنس') },
    el('option', { value: '' }, t('اختر الجنس')),
    el('option', { value: 'male' }, t('ذكر')), el('option', { value: 'female' }, t('أنثى')),
    el('option', { value: 'other' }, t('آخر')), el('option', { value: 'prefer_not' }, t('أفضّل عدم التحديد')));
  var ageInput = el('input', { id: 'gs-reg-age', type: 'number', min: '10', max: '110',
    inputmode: 'numeric', placeholder: t('العمر (اختياري)'), 'aria-label': t('العمر') });
  var phoneInput = el('input', { id: 'gs-reg-phone', type: 'tel', maxlength: '24',
    inputmode: 'tel', dir: 'ltr', placeholder: t('رقم الهاتف (اختياري)'), 'aria-label': t('رقم هاتف') });
  var nameRow = regField('gs-reg-name', t('اسم المستخدم*'), nameInput);
  var countryRow = regField('gs-reg-country', t('الدولة'), countryInput);
  var genderRow = regField('gs-reg-gender', t('الجنس'), genderSelect);
  var ageRow = regField('gs-reg-age', t('العمر'), ageInput);
  var phoneRow = regField('gs-reg-phone', t('رقم هاتف'), phoneInput);
  var errBox = el('div', { class: 'gate-error hidden' });

  var emailInput = el('input', { id: 'gs-auth-email', name: 'email', type: 'email',
    inputmode: 'email', autocomplete: 'email', dir: 'ltr',
    placeholder: t('البريد الإلكتروني (اختياري)'), 'aria-label': t('البريد الإلكتروني'), required: 'required' });
  var passInput = el('input', { id: 'gs-auth-pass', name: 'password', type: 'password',
    autocomplete: 'current-password', dir: 'ltr',
    placeholder: t('كلمة المرور (6-8 أحرف)'), 'aria-label': t('كلمة المرور'), required: 'required' });
  var eye = el('button', { class: 'auth-eye', type: 'button',
    'aria-label': t('إظهار كلمة المرور'), title: t('إظهار كلمة المرور') }, ico('eye', 'icon'));
  eye.addEventListener('click', function () {
    var shown = passInput.type === 'text';
    passInput.type = shown ? 'password' : 'text';
    eye.classList.toggle('is-on', !shown);
    eye.setAttribute('aria-label', t(shown ? 'إظهار كلمة المرور' : 'إخفاء كلمة المرور'));
  });

  var forgot = el('button', { class: 'auth-textbtn', type: 'button' }, t('نسيت كلمة المرور؟'));
  var toRegister = el('button', { class: 'auth-textbtn', type: 'button' }, t('إنشاء حساب جديد'));
  var submit = el('button', { class: 'auth-submit', type: 'submit', disabled: 'disabled' }, t('تسجيل الدخول'));
  var consent = consentRow(opts.consentId || 'gs-auth-consent');
  var mode = 'login';

  function showErr(msg) { errBox.textContent = msg; errBox.classList.remove('hidden'); }
  function clearErr() { errBox.textContent = ''; errBox.classList.add('hidden'); }
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim()); }
  function consentOkNow() {
    var box = consent.querySelector('input[type="checkbox"]');
    return !!(box && box.checked);
  }
  function nameOk() { var n = String(nameInput.value || '').trim(); return n.length >= 4 && n.length <= 50; }
  function fieldsOk() {
    var len = String(passInput.value).length;
    if (mode === 'register') return nameOk() && len >= 6 && len <= 8 && validEmail(emailInput.value);
    return len >= 6 && validEmail(emailInput.value);
  }
  function sync() { submit.disabled = !(fieldsOk() && consentOkNow()); }
  [emailInput, passInput, nameInput, countryInput, ageInput, phoneInput].forEach(function (elx) {
    elx.addEventListener('input', function () { clearErr(); sync(); });
  });
  genderSelect.addEventListener('change', function () { clearErr(); sync(); });
  consent.addEventListener('change', function () { clearErr(); sync(); });

  function authError(e) {
    var code = e && e.code;
    if (code === 'auth/user-not-found') return t('لا يوجد حساب بهذا البريد. أنشئ حساباً جديداً.');
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential'
        || code === 'auth/invalid-login-credentials') return t('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    if (code === 'auth/email-already-in-use') return t('هذا البريد مستخدم بالفعل. سجّل الدخول بدلاً من إنشاء حساب.');
    if (code === 'auth/weak-password') return t('كلمة المرور ضعيفة: استخدم ٦ أحرف على الأقل.');
    if (code === 'auth/too-many-requests') return t('محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.');
    if (code === 'auth/operation-not-allowed') return t('تسجيل الدخول بالبريد غير مُفعَّل حالياً. استخدم زر Google في الأسفل.');
    if (code === 'auth/invalid-email') return t('البريد الإلكتروني غير صالح.');
    if (code === 'auth/network-request-failed') return t('تعذّر الاتصال بالشبكة. تحقّق من الإنترنت وحاول مجدداً.');
    if (code === 'auth/sdk-not-ready') return t('تعذّر تحميل خدمة المصادقة. تحقّق من اتصال الإنترنت وأعد المحاولة.');
    if (code === 'auth/in-app-browser') return t('افتح الصفحة في متصفّح مثل Chrome أو Safari لإتمام تسجيل الدخول بحساب Google.');
    return t('تعذّر تسجيل الدخول') + (code ? ' (' + code + ')' : '') + '. ' + t('حاول مجدداً.');
  }
  function busy(on) {
    submit.disabled = on || !(validEmail(emailInput.value) && String(passInput.value).length >= 6 && consentOkNow());
    submit.textContent = on ? t('جار تسجيل الدخول…')
      : (mode === 'register' ? t('إنشاء حساب') : t('تسجيل الدخول'));
  }

  function setMode(next) {
    mode = next === 'register' ? 'register' : 'login';
    var isReg = mode === 'register';
    title.textContent = isReg ? t('إنشاء حساب') : t('تسجيل الدخول');
    submit.textContent = isReg ? t('إنشاء حساب') : t('تسجيل الدخول');
    passInput.setAttribute('autocomplete', isReg ? 'new-password' : 'current-password');
    forgot.textContent = isReg ? t('لدي حساب بالفعل') : t('نسيت كلمة المرور؟');
    toRegister.style.display = isReg ? 'none' : '';
    [nameRow, countryRow, genderRow, ageRow, phoneRow].forEach(function (row) {
      row.style.display = isReg ? '' : 'none';
    });
    // Round 40: one GoldenStore logo everywhere — no green mascot.
    try {
      var hero = document.getElementById('gs-auth-hero') || (form && form.querySelector('.auth-hero'));
      if (hero) hero.style.display = '';
    } catch (e) {}
    passInput.setAttribute('maxlength', isReg ? '8' : '128');
    submit.textContent = isReg ? t('انشاء الحساب') : t('تسجيل الدخول');
    note.textContent = isReg
      ? t('أنشئ حسابك بالبريد الإلكتروني وكلمة مرور من ٦ أحرف على الأقل')
      : t('قم بتسجيل حسابك بالبريد الإلكتروني الخاص بك');
    clearErr(); sync();
  }
  toRegister.addEventListener('click', function () { setMode('register'); try { passInput.focus(); } catch (e) {} });
  forgot.addEventListener('click', function () {
    if (mode === 'register') { setMode('login'); return; }
    var mail = emailInput.value.trim();
    if (!validEmail(mail)) { showErr(t('أدخل بريدك الإلكتروني أولاً لإرسال رابط إعادة التعيين.')); try { emailInput.focus(); } catch (e) {} return; }
    clearErr(); forgot.disabled = true;
    Promise.resolve()
      .then(function () { return window.GAuth.sendPasswordReset(mail); })
      .then(function () { showErr(t('تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك. راجع صندوق الوارد.')); })
      .catch(function (e) { showErr(authError(e)); })
      .then(function () { forgot.disabled = false; });
  });

  var form = el('form', { class: 'auth-form', novalidate: 'novalidate' },
    nameRow,
    el('label', { class: 'auth-field auth-box', for: 'gs-auth-email' },
      el('span', { class: 'auth-field-label' }, t('عنوان بريد إلكتروني')),
      emailInput),
    el('label', { class: 'auth-field auth-box', for: 'gs-auth-pass' },
      el('span', { class: 'auth-field-label' }, t('كلمه السر*')),
      passInput, eye),
    countryRow, genderRow, ageRow, phoneRow,
    el('div', { class: 'auth-links' }, forgot, toRegister),
    consent,
    submit,
    errBox,
    note);
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    clearErr();
    if (!validEmail(emailInput.value)) { showErr(t('البريد الإلكتروني غير صالح.')); return; }
    if (mode === 'register') {
      if (!nameOk()) { showErr(t('اسم المستخدم يجب أن يكون بين ٤ و٥٠ حرفاً.')); return; }
      if (String(passInput.value).length < 6 || String(passInput.value).length > 8) {
        showErr(t('كلمة المرور يجب أن تكون بين ٦ و٨ أحرف.')); return;
      }
    } else if (String(passInput.value).length < 6) {
      showErr(t('كلمة المرور يجب أن تكون ٦ أحرف على الأقل.')); return;
    }
    var box = consent.querySelector('input[type="checkbox"]');
    if (!box || !box.checked) {
      consent.classList.add('consent-error');
      showErr(t(CONSENT_MSG));
      return;                                   // no request without consent
    }
    busy(true);
    var mail = emailInput.value.trim(), pass = passInput.value;
    var isReg = mode === 'register';
    var task = isReg
      ? window.GAuth.signUpWithEmail(mail, pass, String(nameInput.value || '').trim())
      : window.GAuth.signInWithEmail(mail, pass);
    Promise.resolve(task)
      .then(function (user) {
        if (!user) { busy(false); return; }
        if (isReg) {
          try {
            fetch('/api/profile/demographics', {
              method: 'POST', credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username: String(nameInput.value || '').trim(), email: mail,
                phone: String(phoneInput.value || '').trim(),
                country: String(countryInput.value || '').trim(),
                gender: genderSelect.value || '',
                age: ageInput.value ? Number(ageInput.value) : null,
                opted_in: true,
              }),
            }).catch(function () {});
          } catch (e) {}
        }
        onSuccess(user);
      })
      .catch(function (e) { showErr(authError(e)); busy(false); });
  });

  var googleBtn = el('button', { class: 'auth-google-big', type: 'button',
    'aria-label': t('متابعة باستخدام Google'), title: t('متابعة باستخدام Google'),
    html: GOOGLE_G_HTML + '<span class="gbtn-label">' + t('متابعة باستخدام Google') + '</span>',
    onclick: function () {
      var box = consent.querySelector('input[type="checkbox"]');
      if (!box || !box.checked) {
        consent.classList.add('consent-error');
        showErr(t(CONSENT_MSG));
        return;                                 // same consent rule as before
      }
      clearErr();
      googleBtn.disabled = true;
      Promise.resolve()
        .then(function () { return window.GAuth.signInWithGoogle(); })
        .then(function (user) { googleBtn.disabled = false; if (user) onSuccess(user); })
        .catch(function (e) { googleBtn.disabled = false; showErr(authError(e)); });
    } });
  var googleFoot = el('div', { class: 'auth-third-foot' },
    el('span', { class: 'auth-third-brand' }, t('متصفح')),
    el('span', { class: 'auth-third-sub' }, t('الجوجل')));

  var wrap = el('div', { class: 'auth-page is-gate' + (compact ? ' is-compact' : '') },
    title,
    el('div', { class: 'auth-hero', id: 'gs-auth-hero' },
      el('img', { class: 'auth-hero-logo', src: '/images/logo.png', alt: 'Golden Store', width: '96', height: '96' }),
      el('div', { class: 'auth-hero-name' }, 'Golden', el('b', null, 'Store')),
      el('p', { class: 'auth-hero-tag' }, 'Golden Store, Play More Fun!')),
    form,
    el('div', { class: 'auth-third' },
      el('div', { class: 'auth-third-title' }, t('تسجيل الدخول السريع لحساب الطرف الثالث')),
      googleBtn,
      googleFoot));
  addFromBrand(wrap);
  setTimeout(function () { try { emailInput.focus(); } catch (e) {} }, 0);
  return wrap;
}

function requireAuth() {
  if (_user) return Promise.resolve(_user);
  return new Promise((resolve, reject) => {
    const overlay = el('div', { class: 'dialog-overlay auth-required-overlay' });
    const finish = (user) => { overlay.remove(); document.body.style.overflow = ''; resolve(user); };
    const cancel = () => { overlay.remove(); document.body.style.overflow = ''; reject(new Error('cancelled')); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cancel(); });
    /* The overlay finishes on its own, AND when the store's auth state arrives
       from Firebase (a Google popup or a slow sign-in) — otherwise the caller
       was left waiting in a guest state after a successful sign-in. */
    let done = false;
    const once = (user) => { if (done) return; done = true; off(); finish(user); };
    const off = onAuthChanged((u) => { if (u) once(u); });
    overlay.append(renderAuthGate({
      compact: true,
      consentId: 'gs-auth-consent',
      onSuccess: once,
      onCancel: () => { if (done) return; done = true; off(); cancel(); },
    }));
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';
  });
}

let _redirectingToLogin = false;
function goToLogin() {
  if (_redirectingToLogin) return;
  _redirectingToLogin = true;
  const next = location.pathname + location.search;
  location.replace('/login?next=' + encodeURIComponent(next));
}

/* Both in-app gates (the overlay and the full-screen one) render the very same
   builder, so the lockup and the consent rule can only ever live in one place. */
function renderAuthGate(opts) { return authGateForm(opts || {}); }

/* Full-screen sign-in gate (require_login = 1). Round 37: same rebuilt design
   as /login and as the in-page overlay — one look everywhere. */
function showAuthGate() {
  if (document.getElementById('gs-auth-gate')) return;
  const gate = el('div', { id: 'gs-auth-gate', class: 'gate is-auth-page' });
  const spinner = el('div', { class: 'gate-spinner hidden' }, el('div', { class: 'spinner' }));
  const errBox = el('div', { class: 'gate-error hidden' });
  const form = renderAuthGate({
    consentId: 'gs-gate-consent',
    onSuccess: () => { hideAuthGate(); },
    onCancel: () => { try { location.href = '/'; } catch (e) {} },
  });
  gate.append(form, spinner, errBox);
  document.body.append(gate);
  document.body.style.overflow = 'hidden';
}

function hideAuthGate() {
  const gate = document.getElementById('gs-auth-gate');
  if (gate) gate.remove();
  document.body.style.overflow = '';
}

/* Round 75 (owner: «نشرت لعبة … ولم تظهر في المتجر»).
 *
 * THE WHOLE STORE USED TO WAIT FOR FIREBASE, FOREVER.
 * Every page registers its renderer through ready(), and ready() callbacks only
 * run from onAuthed() — which only runs from GAuth.onAuthChange. If that
 * callback never arrived, nothing rendered at all: the page sat on its skeleton
 * permanently, with the footer as its only content. The store looked empty even
 * though /api/apps returned the game and its images were live 200s.
 *
 * That callback does not always arrive. Firebase's SDK is loaded from
 * gstatic.com; when that host is slow, blocked by a DNS filter or by an
 * ad-blocker — common on mobile networks here — onAuthStateChanged may never
 * fire, and even calling onAuthChange can throw. Nothing in the old code had a
 * timeout or a fallback, so the failure was silent and total.
 *
 * What we do now:
 *   1. the auth SDK gets AUTH_GRACE_MS to answer;
 *   2. if it does not, the page renders as a GUEST (browsing never needed an
 *      account) instead of staying blank;
 *   3. subscribing is wrapped, so a throwing SDK also degrades to guest;
 *   4. if the real answer arrives later, onAuthed() still upgrades the session
 *      and emitAuthChanged() refreshes gated blocks — no reload needed.
 * Browsing, opening and downloading never required an account; rating,
 * commenting and liking still do, exactly as before.
 */
const AUTH_GRACE_MS = 2000;

async function initAuth() {
  if (isLocalhost() && getQuery('devskip') === '1') { onAuthed(devUser()); return; }
  // Settings are loaded once for every page; wait so require_login is honoured.
  try { if (window.GSSettings && typeof window.GSSettings.ready === 'function') await window.GSSettings.ready(); } catch (e) {}
  const allowGuest = !!(window.GSSettings && window.GSSettings.get('require_login', '1') === '0');

  if (!window.GAuth || typeof window.GAuth.onAuthChange !== 'function') {
    if (allowGuest) { onAuthed(null); return; }
    console.error('GAuth not available — Firebase SDK may have failed to load');
    showAuthGate();
    return;
  }

  let answered = false;
  let timer = null;
  const answeredNow = () => {
    answered = true;
    if (timer) { clearTimeout(timer); timer = null; }
  };

  try { window.GAuth.init(); } catch (e) { console.error('GAuth.init failed', e); }

  try {
    window.GAuth.onAuthChange((user) => {
      answeredNow();
      if (user) {
        cacheUser(user);
        onAuthed(user);
        hideAuthGate();
      } else {
        cacheUser(null);
        _user = null;
        hideGate();
        if (allowGuest) onAuthed(null);     // settings: browse without signing in
        else showAuthGate();
      }
    });
  } catch (e) {
    console.error('GAuth.onAuthChange failed — continuing as guest', e);
    answeredNow();
    if (allowGuest) { onAuthed(null); hideAuthGate(); return; }
    showAuthGate();
    return;
  }

  // Do not let a silent auth SDK hold the store hostage.
  timer = setTimeout(() => {
    if (answered) return;
    timer = null;
    console.warn('[store] auth did not answer within ' + AUTH_GRACE_MS + 'ms — rendering as guest');
    if (allowGuest) { onAuthed(null); hideAuthGate(); }
    else showAuthGate();
  }, AUTH_GRACE_MS);
}

async function signOut() {
  cacheUser(null);
  try { await window.GAuth.signOut(); } catch {}
  location.href = '/';
}

/* ----------------------------- App update popup ----------------------------- */
const APP_UPDATE_DISMISS_KEY = 'gs_app_update_dismissed';
const APP_UPDATE_SEEN_KEY = 'gs_app_update_seen';
const APP_UPDATE_SNOOZE_KEY = 'gs_app_update_snooze';
const APP_UPDATE_BANNER_KEY = 'gs_app_update_banner_dismissed';

// Some Android WebViews (and in-app browsers) wipe localStorage on reload.
// Mirroring the "already shown" state into sessionStorage, a cookie and memory
// is what actually makes the popup appear ONCE instead of on every page load.
const UPDATE_MEMORY = Object.create(null);
function durableGet(key) {
  try { const v = localStorage.getItem(key); if (v) return v; } catch (e) {}
  try { const v = sessionStorage.getItem(key); if (v) return v; } catch (e) {}
  try {
    const hit = document.cookie.match(new RegExp('(?:^|; )' + key + '=([^;]*)'));
    if (hit) return decodeURIComponent(hit[1]);
  } catch (e) {}
  return UPDATE_MEMORY[key] || '';
}
function durableSet(key, value) {
  const v = String(value);
  UPDATE_MEMORY[key] = v;
  try { localStorage.setItem(key, v); } catch (e) {}
  try { sessionStorage.setItem(key, v); } catch (e) {}
  try { document.cookie = key + '=' + encodeURIComponent(v) + '; path=/; max-age=2592000; SameSite=Lax'; } catch (e) {}
}
function readUpdateMap(key) {
  try { const v = JSON.parse(durableGet(key) || '{}'); return v && typeof v === 'object' ? v : {}; }
  catch (e) { return {}; }
}
let autoUpdateChecked = false;
let dialogShownThisLoad = false;

function getCurrentAppVersion() {
  try {
    if (window.GSAndroid && typeof window.GSAndroid.getVersionName === 'function') {
      const v = window.GSAndroid.getVersionName();
      if (v) return String(v);
    }
  } catch (e) {}
  try {
    const cfg = window.Capacitor && window.Capacitor.getConfig && window.Capacitor.getConfig();
    if (cfg && cfg.appVersion) return String(cfg.appVersion);
  } catch (e) {}
  return '1.0';
}

function getCurrentVersionCode() {
  try {
    if (window.GSAndroid && typeof window.GSAndroid.getVersionCode === 'function') {
      const c = parseInt(window.GSAndroid.getVersionCode(), 10);
      if (c > 0) return c;
    }
  } catch (e) {}
  return 0;
}

function shouldShowUpdate(update, opts = {}) {
  if (!update || !update.version_name || !updateApkUrl(update)) return false;
  const manual = !!(opts && opts.manual);
  const nextName = String(update.version_name).trim();
  const currentName = String(getCurrentAppVersion() || '').trim();
  // The device already runs this exact build.
  if (nextName && nextName === currentName) return false;
  // Automatic checks honour ALL suppression layers. A manual check (Account
  // page / notification link) deliberately bypasses them, because the user
  // asked to see the release again.
  if (!manual) {
    const snoozeUntil = Number(durableGet(APP_UPDATE_SNOOZE_KEY) || 0);
    if (Number.isFinite(snoozeUntil) && snoozeUntil > Date.now()) return false;
    const seen = readUpdateMap(APP_UPDATE_SEEN_KEY);
    if (seen[nextName]) return false;
    const dismissed = readUpdateMap(APP_UPDATE_DISMISS_KEY);
    if (dismissed[nextName]) return false;
  }
  // Publishing stores a Unix timestamp in version_code, while a native wrapper
  // may report 1 (or 0). The old `vc > 100000 -> return false` guard therefore
  // suppressed EVERY dialog published from the admin console. Only compare
  // version codes when the native app reports a build number on the same scale.
  const vc = Number(update.version_code || 0);
  const nativeVc = getCurrentVersionCode();
  if (vc && nativeVc >= 100000 && vc <= nativeVc) return false;
  return true;
}

function updateSeen(version) { return !!readUpdateMap(APP_UPDATE_SEEN_KEY)[String(version)]; }
function markUpdateSeen(version) {
  const seen = readUpdateMap(APP_UPDATE_SEEN_KEY);
  seen[String(version)] = Date.now();
  durableSet(APP_UPDATE_SEEN_KEY, JSON.stringify(seen));
}
function dismissUpdateVersion(version) {
  const d = readUpdateMap(APP_UPDATE_DISMISS_KEY);
  d[String(version)] = Date.now();
  durableSet(APP_UPDATE_DISMISS_KEY, JSON.stringify(d));
  const banner = document.getElementById('gs-update-banner');
  if (banner) banner.remove();
  document.body.classList.remove('has-update-banner');
}
function laterMinutes() {
  try {
    const cfg = window.GSSettings;
    if (cfg && typeof cfg.get === 'function') {
      const n = Number(cfg.get('update_later_minutes', '60'));
      if (Number.isFinite(n) && n > 0) return Math.min(10080, Math.max(1, Math.round(n)));
    }
  } catch (e) {}
  return 60;
}
// "Update later": the admin sets the delay manually in Settings Center; the
// reminder is deferred until now + N minutes and the version is marked seen.
function snoozeUpdate(version, minutes) {
  const mins = Math.min(10080, Math.max(1, Number(minutes) || 60));
  const until = Date.now() + mins * 60000;
  durableSet(APP_UPDATE_SNOOZE_KEY, String(until));
  markUpdateSeen(version);
  return until;
}

// Sticky announcement bar: after the cinematic dialog is postponed, the bar
// stays at the top of the store and re-opens it with one tap.
function showUpdateBanner(update) {
  if (!update || !update.version_name || document.getElementById('gs-update-banner')) return;
  const version = String(update.version_name);
  if (!update.force) {
    try {
      const hidden = JSON.parse(localStorage.getItem(APP_UPDATE_BANNER_KEY) || '{}');
      if (hidden[version]) return;
    } catch (e) {}
  }
  const closeFn = () => {
    try {
      const d = JSON.parse(localStorage.getItem(APP_UPDATE_BANNER_KEY) || '{}');
      d[version] = Date.now();
      localStorage.setItem(APP_UPDATE_BANNER_KEY, JSON.stringify(d));
    } catch (e) {}
    banner.remove();
    document.body.classList.remove('has-update-banner');
  };
  const banner = el('div', {
    id: 'gs-update-banner', class: 'gs-update-banner', role: 'status', 'data-noi18n': '',
  },
    el('span', { class: 'gs-update-banner-glow', 'aria-hidden': 'true' }),
    el('span', { class: 'gs-update-banner-icon', 'aria-hidden': 'true' }, ico('spark', 'icon')),
    el('span', { class: 'gs-update-banner-copy' },
      el('strong', null, t('إصدار جديد من Golden Store متاح')),
      el('span', { class: 'gs-update-banner-sub' },
        t('الإصدار') + ' ' + version + ' — ' + t('اضغط لمشاهدة التفاصيل'))),
    el('button', { class: 'gs-update-banner-cta', type: 'button',
      onclick: () => showUpdateDialog(update, { manual: true }) }, t('عرض ما الجديد')),
    update.force ? null : el('button', {
      class: 'gs-update-banner-close', type: 'button',
      'aria-label': t('إغلاق'), title: t('إغلاق'), onclick: closeFn,
    }, ico('close', 'icon')),
  );
  banner.addEventListener('click', (e) => { if (e.target === banner) showUpdateDialog(update, { manual: true }); });
  document.body.append(banner);
  document.body.classList.add('has-update-banner');
}

function updateApkUrl(update) {
  return (update && (update.apk_url || update.url)) || '';
}

function showUpdateCheckCard(kind, update) {
  const existing = document.getElementById('gs-check-dialog');
  if (existing) existing.remove();
  const version = (update && (update.version_name || update.version || '')) || '—';
  const title = kind === 'up-to-date' ? t('أنت على أحدث إصدار')
    : kind === 'error' ? t('تعذّر التحقق من التحديثات')
    : t('أحدث إصدار متاح');
  const text = kind === 'up-to-date'
    ? t('نسختك الحالية هي الأحدث. لا يوجد تحديث جديد الآن.')
    : kind === 'error'
      ? t('تحقّق من اتصالك بالإنترنت ثم أعد المحاولة.')
      : t('رابط التحميل الرسمي جاهز في صفحة تحميل Golden Store.');

  const overlay = el('div', { id: 'gs-check-dialog', class: 'gs-check-overlay', role: 'dialog',
    'aria-modal': 'true', 'data-noi18n': '' });
  const card = el('div', { class: 'gs-check-card', 'data-noi18n': '' },
    el('div', { class: 'gs-check-logo' },
      el('img', { src: '/images/logo.png', alt: 'Golden Store', draggable: 'false' })),
    el('h2', { class: 'gs-check-title' }, title),
    el('p', { class: 'gs-check-text' }, text),
    kind !== 'error' ? el('span', { class: 'gs-check-version' }, t('الإصدار') + ' ' + version) : null,
    el('div', { class: 'gs-check-actions' },
      kind === 'web' ? el('a', { class: 'btn btn-primary btn-lg gs-update-primary', href: '/download' },
        ico('download'), t('انتقل إلى صفحة التحميل'))
        : kind === 'error' ? el('button', { class: 'btn btn-primary btn-lg gs-update-primary', type: 'button',
            onclick: () => { overlay.remove(); checkForUpdates({}); } },
          ico('refresh'), t('إعادة المحاولة'))
        : el('button', { class: 'btn btn-primary btn-lg gs-update-primary', type: 'button',
            onclick: () => overlay.remove() }, ico('check'), t('حسناً')),
      el('button', { class: 'btn btn-secondary gs-update-later', type: 'button',
        onclick: () => overlay.remove() }, t('إغلاق')),
    ),
  );
  overlay.append(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}

// Manual "check for updates". Works in the browser AND the native app:
//  - native + newer version  -> the full update dialog
//  - native + same version   -> "you are up to date"
//  - browser                 -> latest release info + link to /download
//  - network failure         -> retryable error card
async function checkForUpdates(opts = {}) {
  const btn = opts.button || null;
  if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
  let update = null;
  try {
    update = await api('/api/app-update?_=' + Date.now(), { timeoutMs: 8000 });
  } catch (e) {
    if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
    showUpdateCheckCard('error', null);
    return { status: 'error', error: e };
  }
  if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
  if (!update || !update.version_name || !updateApkUrl(update)) {
    showUpdateCheckCard('error', null);
    return { status: 'error', error: new Error('invalid_update') };
  }
  if (hasDeviceBridge()) {
    if (shouldShowUpdate(update, { manual: true })) {
      showUpdateDialog(update, { manual: true });
      return { status: 'available', update };
    }
    showUpdateCheckCard('up-to-date', update);
    return { status: 'up-to-date', update };
  }
  showUpdateCheckCard('web', update);
  return { status: 'latest', update };
}


function formatReleaseDate(ts) {
  const n = Number(ts || 0);
  if (!n || !Number.isFinite(n)) return '—';
  // The date must follow the UI language: it used to be pinned to ar-EG, so a
  // Chinese or Russian dialog showed an Arabic month name like «نوفمبر».
  const lg = (window.GSI18N && window.GSI18N.lang) || 'ar';
  const locale = lg === 'ar' ? 'ar-EG-u-nu-latn' : lg;
  try { return new Date(n > 1e12 ? n : n * 1000).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', numberingSystem: 'latn' }); }
  catch (e) {
    try { return new Date(n > 1e12 ? n : n * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e2) { return '—'; }
  }
}

// Shared by both popups: language switcher + Telegram news. Falls back to a
// self-contained version when the shared applier is not loaded (isolated pages).
function modalExtras() {
  try {
    const tools = window.GSModalTools;
    if (tools && typeof tools.extras === 'function') {
      const built = tools.extras();
      if (built) return built;
    }
  } catch (e) {}
  const row = el('div', { class: 'gs-modal-extras', 'data-noi18n': '' });
  const sel = el('select', { class: 'gs-modal-lang-select', 'aria-label': t('اللغة') },
    el('option', { value: 'ar' }, 'العربية'), el('option', { value: 'en' }, 'English'),
    el('option', { value: 'fr' }, 'Français'), el('option', { value: 'es' }, 'Español'),
    el('option', { value: 'tr' }, 'Türkçe'), el('option', { value: 'de' }, 'Deutsch'),
    el('option', { value: 'pt' }, 'Português'), el('option', { value: 'ru' }, 'Русский'),
    el('option', { value: 'hi' }, 'हिन्दी'), el('option', { value: 'zh' }, '中文'));
  sel.onchange = () => {
    try { localStorage.setItem('gs_lang', sel.value); } catch (e) {}
    try {
      if (window.GSI18N && window.GSI18N.setLang) window.GSI18N.setLang(sel.value);
      else location.reload();
    } catch (e) { location.reload(); }
  };
  const tg = el('a', { class: 'gs-modal-btn gs-modal-telegram',
    href: 'https://t.me/goldenstore_10', target: '_blank', rel: 'noopener noreferrer',
    'data-noi18n': '' }, t('المزيد من الأخبار'));
  row.append(sel, tg);
  return row;
}

function showUpdateDialog(update, opts = {}) {
  if (!update || !updateApkUrl(update)) return;
  if (!opts.manual && dialogShownThisLoad) return;   // never auto-open twice per load
  dialogShownThisLoad = true;
  // ANY display counts as "once", including a manual open followed by a
  // language switch (which reloads the WebView).
  markUpdateSeen(update.version_name);
  const existing = document.getElementById('gs-update-dialog');
  if (existing) existing.remove();

  const overlay = el('div', {
    id: 'gs-update-dialog', class: 'gs-update-overlay', role: 'dialog',
    'aria-modal': 'true', 'aria-labelledby': 'gs-update-title', 'data-noi18n': '',
  });
  const apkUrl = updateApkUrl(update);
  // Release notes come from the admin/API in whatever language the owner typed
  // (usually English). Route them through the content translator so they read in
  // the visitor's language; the shipped table paints instantly, unknown notes
  // are translated on demand and cached.
  const rawNotes = update.notes || t('يتوفر إصدار جديد من التطبيق. حمّله الآن للحصول على أحدث الميزات والإصلاحات.');
  // Keep the source in the DOM and let the shared content engine fill it in:
  // `data-i18n-content` holders are repainted automatically when a translation
  // arrives, so the dialog never shows an empty card while it is fetching.
  let notes = rawNotes;
  try {
    const g = window.GSI18N;
    if (g && typeof g.content === 'function' && !update.notes_is_ui) {
      const hit = g.content(rawNotes);
      if (typeof hit === 'string' && hit) notes = hit;
    }
  } catch (e) {}
  const prevFocus = document.activeElement;
  const size = Number(update.size_bytes || 0);
  const sizeText = size > 0 ? formatBytes(size) : '—';
  const dateText = formatReleaseDate(update.created_at);

  const card = el('div', { class: 'gs-update-card', 'data-noi18n': '' },
    // Cinematic aura: two slow orbits + drifting gold particles (CSS only).
    el('div', { class: 'gs-update-halo', 'aria-hidden': 'true' },
      el('span', { class: 'gs-update-orbit o1' }),
      el('span', { class: 'gs-update-orbit o2' }),
      el('span', { class: 'gs-update-particle p1' }),
      el('span', { class: 'gs-update-particle p2' }),
      el('span', { class: 'gs-update-particle p3' }),
      el('span', { class: 'gs-update-particle p4' }),
      el('span', { class: 'gs-update-particle p5' }),
      el('span', { class: 'gs-update-particle p6' }),
    ),
    el('div', { class: 'gs-update-hero' },
      el('div', { class: 'gs-update-logo' },
        el('img', { src: '/images/logo.png', alt: 'Golden Store', draggable: 'false' })),
      el('div', { class: 'gs-update-head' },
        el('span', { class: 'gs-update-badge' }, update.force ? t('تحديث إلزامي') : t('تحديث جديد متاح')),
        el('span', { class: 'gs-update-version' }, t('الإصدار') + ' ' + (update.version_name || '—')),
      ),
      el('h2', { id: 'gs-update-title', class: 'gs-update-title' }, t('تحديث Golden Store')),
      el('p', { class: 'gs-update-lead' }, t('نسخة جديدة من Golden Store جاهزة للتثبيت.')),
    ),
    el('div', { class: 'gs-update-body' },
      el('div', { class: 'gs-update-compare' },
        el('span', { class: 'gs-update-ver-chip' },
          el('span', null, t('إصدارك الحالي')), el('strong', null, getCurrentAppVersion())),
        el('span', { class: 'gs-update-arrow' }, '←'),
        el('span', { class: 'gs-update-ver-chip is-new' },
          el('span', null, t('الإصدار الجديد')), el('strong', null, update.version_name || '—')),
      ),
      el('div', { class: 'gs-update-meta' },
        el('span', { class: 'gs-update-meta-item' },
          ico('download', 'icon'), el('b', null, t('حجم التحديث')), el('i', null, sizeText)),
        el('span', { class: 'gs-update-meta-item' },
          ico('clock', 'icon'), el('b', null, t('تاريخ النشر')), el('i', null, dateText)),
      ),
      el('div', { class: 'gs-update-notes' },
        el('span', { class: 'gs-update-notes-label' }, t('ما الجديد')),
        el('p', update.notes_is_ui ? null : { 'data-i18n-content': rawNotes }, notes),
      ),
      el('div', { class: 'gs-update-chips' },
        el('span', { class: 'gs-update-chip' }, ico('shield', 'icon'), t('تحميل آمن')),
        el('span', { class: 'gs-update-chip' }, ico('spark', 'icon'), t('ميزات جديدة')),
        el('span', { class: 'gs-update-chip' }, ico('clock', 'icon'), t('تثبيت سريع')),
      ),
    ),
  );

  const android = window.GSAndroid;
  let closed = false;
  function closeDialog() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    document.body.classList.remove('update-dialog-open');
    if (prevFocus && typeof prevFocus.focus === 'function') { try { prevFocus.focus(); } catch (e) {} }
  }
  function dismissDialog(showToast) {
    if (closed) return;
    const until = snoozeUpdate(update.version_name, laterMinutes());
    closeDialog();
    if (showToast) {
      try {
        const at = new Date(until).toLocaleTimeString(document.documentElement.lang || 'ar',
          { hour: '2-digit', minute: '2-digit' });
        toast(t('سنذكّرك بالتحديث في') + ' ' + at, 'info');
      } catch (e) {}
    }
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); dismissDialog(false); }
    else if (e.key === 'Tab') {
      const items = [...overlay.querySelectorAll('button:not([disabled])')];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function startDownload() {
    if (android && typeof android.downloadApk === 'function') {
      const filename = 'goldenstore-' + (update.version_name || 'update') + '.apk';
      try {
        android.downloadApk(apkUrl, filename, 'app-update', 'com.goldenstore.app');
        card.innerHTML = '<div class="gs-update-state"><div class="gs-update-state-icon">⬇</div>'
          + '<h2 class="gs-update-state-title">' + t('جارٍ التحميل…') + '</h2>'
          + '<p class="gs-update-state-text">' + t('سيتم التثبيت تلقائياً عند اكتمال التحميل.') + '</p>'
          + '<div class="gs-update-progress is-live"><i></i></div>'
          + '<div class="gs-update-progress-label">0%</div></div>';
        return;
      } catch (e) {}
    }
    window.open(apkUrl, '_blank');
    setTimeout(closeDialog, 200);
  }

  // Exactly TWO big actions: Download now, then "Update later" directly below
  // it at the same width/height. The shared row adds language + Telegram news.
  const actions = el('div', { class: 'gs-update-actions' },
    el('button', {
      class: 'btn btn-primary btn-lg gs-update-primary',
      type: 'button',
      onclick: startDownload,
    }, ico('download'), t('تحميل الآن')),
    el('button', {
      class: 'btn btn-secondary gs-update-later',
      type: 'button',
      onclick: () => dismissDialog(true),
    }, t('تحديث لاحقاً')),
    modalExtras(),
    el('div', { class: 'gs-update-foot' }, ico('shield', 'icon'), t('تحديث رسمي وموقّع')),
  );
  card.append(actions);

  overlay.append(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismissDialog(false); });
  document.body.append(overlay);
  document.body.classList.add('update-dialog-open');
  document.addEventListener('keydown', onKey, true);
  try { const btn = card.querySelector('.gs-update-primary'); if (btn) btn.focus(); } catch (e) {}
}


function normApkProgress(p) {
  const n = Number(p);
  if (!isFinite(n) || n < 0) return -1;
  if (n > 1.5) return Math.max(0, Math.min(1, n / 100));   // 0..100 -> 0..1
  return Math.max(0, Math.min(1, n));
}
window.__gsApkDownloadUpdate = function (slug, status, progress, message) {
  const progressNorm = normApkProgress(progress);
  try {
    if (slug && slug !== 'app-update') {
      if (status === 'downloading') {
        clearDeletedApk(slug);
        const prev = getApkState(slug) || {};
        setApkState(slug, {
          slug, status: 'downloading',
          progress: progressNorm >= 0 ? progressNorm : (prev.progress || 0),
          filename: message || prev.filename || '',
          updated_at: Math.floor(Date.now() / 1000),
        });
        const dls = getActiveDownloadMap();
        const entry = dls[slug] || {};
        setActiveDownload({
          slug,
          name: entry.name || slug,
          icon_url: entry.icon_url || null,
          developer: entry.developer || '',
          size_bytes: entry.size_bytes || 0,
          progress: progressNorm >= 0 ? progressNorm : (entry.progress || 0),
          status: 'downloading',
          started_at: entry.started_at || Math.floor(Date.now() / 1000),
        });
      } else if (status === 'downloaded') {
        setApkState(slug, { slug, status: 'downloaded', progress: 1, filename: message || (getApkState(slug) || {}).filename || '', updated_at: Math.floor(Date.now() / 1000) });
        const dls = getActiveDownloadMap();
        if (dls[slug]) setActiveDownload({ slug, status: 'downloaded', progress: 1 });
      } else if (status === 'installing') {
        setApkState(slug, { slug, status: 'installing', progress: 1, updated_at: Math.floor(Date.now() / 1000) });
        const dls = getActiveDownloadMap();
        if (dls[slug]) setActiveDownload({ slug, status: 'installing', progress: 1 });
      } else if (status === 'installed') {
        applyInstalled(slug, message || '');
      } else if (status === 'uninstalled') {
        unmarkInstalledStored(slug);
        removeApkState(slug);
        removeActiveDownload(slug);
        // A real uninstall starts from zero: clear the «deleted» marker so the
        // next download's «downloaded» state is not pruned away.
        clearDeletedApk(slug);
        try { window.dispatchEvent(new CustomEvent('gs-apk-state', { detail: { slug, status: 'uninstalled', progress: -1, message } })); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('gs-package-uninstalled', { detail: { slug, packageName: message } })); } catch (e) {}
        return;
      } else if (status === 'failed' && message === 'file_missing') {
        // The APK we tried to open was deleted: never keep its filename.
        removeApkState(slug);
        removeActiveDownload(slug);
        if (slug !== 'app-update') markDeletedApk(slug);
      } else if (status === 'cancelled' || status === 'failed') {
        const isInst = (typeof isSlugInstalled === 'function' && isSlugInstalled(slug)) || (typeof resolvedPackageName === 'function' && resolvedPackageName(slug) && typeof installedVersionOnDevice === 'function' && installedVersionOnDevice(resolvedPackageName(slug)));
        if (isInst && status === 'failed') {
          return;
        }
        removeApkState(slug);
        removeActiveDownload(slug);
      }
      if (status !== 'installed') {
        try { window.dispatchEvent(new CustomEvent('gs-apk-state', { detail: { slug, status, progress, message } })); } catch (e) {}
      }
    }
  } catch (e) { console.error('[apkStateHub]', e); }

  if (slug !== 'app-update') return;
  if (status === 'downloading' || status === 'downloaded') {
    const raw = Number(progress) || 0;
    const pct = status === 'downloaded' ? 100 : Math.max(0, Math.min(100, Math.round(raw <= 1 ? raw * 100 : raw)));
    const bar = document.querySelector('#gs-update-dialog .gs-update-progress i');
    const label = document.querySelector('#gs-update-dialog .gs-update-progress-label');
    if (bar) bar.style.width = pct + '%';
    if (label) label.textContent = pct + '%';
  }
  if (status === 'failed') {
    const map = {
      signature_mismatch: t('تعارض توقيع الحزمة: ألغِ التطبيق المثبت ثم ثبّت النسخة الجديدة.'),
      package_mismatch: t('اسم الحزمة غير متطابق مع التطبيق.'),
      apk_parse_failed: t('تعذّر قراءة ملف APK.'),
      install_error: t('فشل التثبيت.'),
      file_missing: t('ملف التحميل مفقود.'),
    };
    toast(map[message] || t('فشل التحميل'), 'error');
    const card = document.querySelector('#gs-update-dialog .gs-update-card');
    if (card) card.innerHTML = '<div class="gs-update-state gs-update-state-error"><div class="gs-update-state-icon">⚠</div>'
      + '<h2 class="gs-update-state-title">' + t('فشل التحديث') + '</h2>'
      + '<p class="gs-update-state-text">' + (map[message] || t('تعذّر تحديث التطبيق. حاول إلغاء التثبيت وإعادة المحاولة.')) + '</p></div>';
  } else if (status === 'installed') {
    toast(t('تم التحديث بنجاح'), 'success');
    setTimeout(() => { try { location.reload(); } catch (e) {} }, 500);
  }
};

window.__gsDownloadStatesSnapshot = function (states) {
  try {
    if (!states || typeof states !== 'object') return;
    Object.keys(states).forEach((slug) => {
      const st = states[slug] || {};
      const status = st.status || 'downloading';
      const progress = typeof st.progress === 'number' ? st.progress : -1;
      /* `progressNorm` was USED here but never declared in this function, which
         threw a ReferenceError on every snapshot the phone sent. That exception
         escaped the forEach, so the store never learned the real progress of a
         download — the entry looked dead, and after a couple of app switches the
         transfer could no longer be followed and stopped. Declared now. */
      const progressNorm = normApkProgress(progress);
      if ((status === 'downloaded' || status === 'installing') && isDeletedApk(slug)) return;
      if ((status === 'downloaded' || status === 'installing') && isDeadApkFile(st.filename)) return;
      if (status === 'downloading') {
        clearDeletedApk(slug);
        const prev = getApkState(slug) || {};
        if (prev.status === 'downloading' && prev.filename === (st.filename || '')
            && Math.abs((prev.progress || 0) - (progress || 0)) < 0.02) return;
        setApkState(slug, {
          slug, status: 'downloading', progress: progress >= 0 ? progress : 0,
          filename: st.filename || '', package_name: st.package_name || '',
          updated_at: st.updated_at || 0,
        });
        const dls = getActiveDownloadMap();
        const entry = dls[slug] || {};
        setActiveDownload({
          slug, name: entry.name || slug, icon_url: entry.icon_url || null,
          developer: entry.developer || '', size_bytes: entry.size_bytes || st.total_bytes || 0,
          progress: progressNorm >= 0 ? progressNorm : (entry.progress || 0),
          status: 'downloading', started_at: entry.started_at || Math.floor(Date.now() / 1000),
        });
      } else if (status === 'downloaded' || status === 'installing') {
        setApkState(slug, { slug, status, progress: 1, filename: st.filename || '', package_name: st.package_name || '', updated_at: st.updated_at || 0 });
      } else {
        removeApkState(slug);
        removeActiveDownload(slug);
      }
      try { window.dispatchEvent(new CustomEvent('gs-apk-state', { detail: { slug, status, progress, message: st.filename || '' } })); } catch (e) {}
    });
    const valid = new Set(Object.keys(states));
    const apkMap = getApkStateMap();
    Object.keys(apkMap).forEach((slug) => {
      if (slug === 'app-update') return;
      if (!valid.has(slug)) { removeApkState(slug); removeActiveDownload(slug); }
    });
    notifyActiveDownloads();
  } catch (e) { console.error('[statesSnapshot]', e); }
};

window.__gsPackageUninstalled = function (packageName) {
  try {
    if (!packageName) return;
    window.dispatchEvent(new CustomEvent('gs-package-uninstalled', { detail: { packageName: packageName } }));
    watchedApps.forEach((pkg, slug) => {
      if (pkg === packageName || resolvedPackageName(slug) === packageName) {
        unmarkInstalledStored(slug);
        removeApkState(slug);
        removeActiveDownload(slug);
        try { window.dispatchEvent(new CustomEvent('gs-apk-state', { detail: { slug, status: 'uninstalled', progress: -1, message: packageName } })); } catch (e) {}
      }
    });
  } catch (e) {}
};

async function checkAppUpdate() {
  if (!hasDeviceBridge() || autoUpdateChecked) return;
  autoUpdateChecked = true;                 // one automatic check per page load
  try {
    const update = await api('/api/app-update', { timeoutMs: 8000 });
    if (!shouldShowUpdate(update)) return; // seen / dismissed / snoozed -> never again
    // Centered popup ONLY: the old sticky top bar is intentionally gone.
    // The dialog opens ONCE per published version, then "Update later" defers
    // any reminder by the number of minutes set manually in Settings Center.
    markUpdateSeen(update.version_name);
    showUpdateDialog(update);
  } catch (e) { console.error('[appUpdate] check failed', e); }
}

/* ------------------- Live APK state registry (persistent) ------------------- */
const APK_STATE_KEY = 'gs_apk_states';
function getApkStateMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(APK_STATE_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}
function getApkState(slug) {
  if (!slug) return null;
  return getApkStateMap()[slug] || null;
}
function setApkState(slug, patch) {
  if (!slug || !patch) return;
  const map = getApkStateMap();
  map[slug] = { ...(map[slug] || {}), ...patch, slug };
  try { localStorage.setItem(APK_STATE_KEY, JSON.stringify(map)); } catch {}
}
function removeApkState(slug) {
  if (!slug) return;
  const map = getApkStateMap();
  if (!map[slug]) return;
  delete map[slug];
  try { localStorage.setItem(APK_STATE_KEY, JSON.stringify(map)); } catch {}
}
/* A deleted APK must not be resurrected by a stale native download snapshot.
   The marker is cleared as soon as a REAL new download starts. */
const DELETED_APK_KEY = 'gs_deleted_apks';
function deletedApkSet() {
  try { return new Set(JSON.parse(localStorage.getItem(DELETED_APK_KEY) || '[]')); } catch { return new Set(); }
}
function isDeletedApk(slug) { return slug ? deletedApkSet().has(slug) : false; }
function markDeletedApk(slug) {
  if (!slug) return;
  try { const set = deletedApkSet(); set.add(slug); localStorage.setItem(DELETED_APK_KEY, JSON.stringify([...set])); } catch {}
}
function clearDeletedApk(slug) {
  if (!slug) return;
  try { const set = deletedApkSet(); if (!set.delete(slug)) return; localStorage.setItem(DELETED_APK_KEY, JSON.stringify([...set])); } catch {}
}
/* EXACT filenames whose APK no longer exists on the device. The Android bridge
   keeps reporting «downloaded» for a file the user deleted, so the filename —
   not only the slug — has to be blacklisted. A blacklisted filename is never
   reused for a new download, which is what finally kills the endless
   «ملف التحميل مفقود» loop. */
const DEAD_FILE_KEY = 'gs_dead_apk_files';
function deadApkFileSet() {
  try { return new Set(JSON.parse(localStorage.getItem(DEAD_FILE_KEY) || '[]')); } catch { return new Set(); }
}
function isDeadApkFile(filename) {
  const fn = String(filename || '').trim();
  return fn ? deadApkFileSet().has(fn) : false;
}
function markDeadApkFile(filename) {
  const fn = String(filename || '').trim();
  if (!fn) return;
  try {
    const set = deadApkFileSet();
    set.add(fn);
    localStorage.setItem(DEAD_FILE_KEY, JSON.stringify([...set].slice(-40)));
  } catch {}
}
function clearDeadApkFile(filename) {
  const fn = String(filename || '').trim();
  if (!fn) return;
  try {
    const set = deadApkFileSet();
    if (!set.delete(fn)) return;
    localStorage.setItem(DEAD_FILE_KEY, JSON.stringify([...set]));
  } catch {}
}
/* Boot-time self-heal for WebViews that kept an old localStorage state. */
function pruneStaleApkStates() {
  try {
    const map = getApkStateMap();
    let changed = false;
    Object.keys(map).forEach((slug) => {
      const st = map[slug];
      if (isDeletedApk(slug) || !st || st.status === 'none'
          || ((st.status === 'downloaded' || st.status === 'installing') && !st.filename)
          || ((st.status === 'downloaded' || st.status === 'installing') && isDeadApkFile(st.filename))) {
        delete map[slug]; changed = true;
      }
    });
    if (!changed) return;
    localStorage.setItem(APK_STATE_KEY, JSON.stringify(map));
    const dls = getActiveDownloadMap();
    let changedDls = false;
    Object.keys(dls).forEach((slug) => {
      if (isDeletedApk(slug)) { delete dls[slug]; changedDls = true; }
    });
    if (changedDls) writeActiveDownloadMap(dls);
    else notifyActiveDownloads();
  } catch (e) {}
}
/* When the user leaves an app page mid-download, the browser takes over the
   file transfer. Keep THIS slug active (indeterminate) so «مكتبتي» still
   shows it alongside every other concurrent download instead of deleting it. */
function markDownloadHandedOff(slug) {
  if (!slug) return;
  const now = Math.floor(Date.now() / 1000);
  const map = getActiveDownloadMap();
  const entry = map[slug] || {
    slug, name: slug, icon_url: null, developer: '', size_bytes: 0,
    status: 'downloading', progress: -1, started_at: now,
  };
  entry.status = 'downloading';
  entry.progress = -1;
  entry.handed_off = true;
  map[slug] = entry;
  writeActiveDownloadMap(map);
  setApkState(slug, { slug, status: 'downloading', progress: -1, handed_off: true, updated_at: now });
  try { window.dispatchEvent(new CustomEvent('gs-apk-state', { detail: { slug, status: 'downloading', progress: -1 } })); } catch {}
}
function onApkState(fn) {
  const handler = (e) => { try { fn(e.detail || {}); } catch (err) { console.error(err); } };
  window.addEventListener('gs-apk-state', handler);
  return () => window.removeEventListener('gs-apk-state', handler);
}

function syncNativeStates() {
  if (!hasDeviceBridge()) return;
  try {
    if (window.GSAndroid && typeof window.GSAndroid.getDownloadStates === 'function') {
      const raw = window.GSAndroid.getDownloadStates();
      if (raw) window.__gsDownloadStatesSnapshot(JSON.parse(raw));
    }
  } catch (e) { console.error('[syncNativeStates]', e); }
}

/* ------------------- Device truth resolver + heartbeat (v1.9) ------------------- */
function isNativeBridge() {
  return !!(window.GSAndroid && typeof window.GSAndroid.checkAppStatus === 'function');
}
function checkAppStatus(slug, packageName) {
  if (!slug || !isNativeBridge()) return null;
  try {
    const raw = window.GSAndroid.checkAppStatus(String(slug), String(packageName || ''));
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && obj.package_name) rememberResolvedPackage(slug, obj.package_name);
    return obj;
  } catch (e) { return null; }
}
const RESOLVED_PKG_KEY = 'gs_resolved_pkgs';
function rememberResolvedPackage(slug, pkg) {
  if (!slug || !pkg) return;
  try {
    const map = JSON.parse(sessionStorage.getItem(RESOLVED_PKG_KEY) || '{}');
    if (map[slug] === pkg) return;
    map[slug] = pkg;
    sessionStorage.setItem(RESOLVED_PKG_KEY, JSON.stringify(map));
  } catch {}
}
/* The device remembers which package it found for a slug. When the owner edits
 * an item's package name, that memory is the OLD truth and would keep answering
 * with it (an update would target the wrong package). This drops it. */
function clearResolvedPackage(slug) {
  if (!slug) return;
  try {
    const map = JSON.parse(sessionStorage.getItem(RESOLVED_PKG_KEY) || '{}');
    if (map[slug] === undefined) return;
    delete map[slug];
    sessionStorage.setItem(RESOLVED_PKG_KEY, JSON.stringify(map));
  } catch (e) {}
}
function resolvedPackageName(slug) {
  if (!slug) return '';
  try {
    const map = JSON.parse(sessionStorage.getItem(RESOLVED_PKG_KEY) || '{}');
    return map[slug] || '';
  } catch { return ''; }
}
const recentInstalledAt = Object.create(null);
/* True while an APK for this slug is still downloading/installing. The phone
   keeps the OLD version installed during an update, so the heartbeat would
   otherwise report «installed» every 400ms and wipe the in-flight download
   (that is why «تحديث التطبيق» only showed a download counter). */
function hasInFlightApk(slug) {
  if (!slug) return false;
  const now = Math.floor(Date.now() / 1000);
  /* A download is NOT over because the record is old.
     The 5-minute "stale" guard treated a real multi-GB transfer for dead: part
     of a big APK takes far longer than five minutes on mobile data, so once the
     record aged out the heartbeat reported the app as «installed» (the old
     version still is), which wiped the in-flight entry and destroyed the
     identifier the phone's downloader is tracked by — after which the transfer
     could no longer be followed and it stopped. Only a STATUS that is clearly
     finished counts as finished; age alone never ends a download. */
  const st = getApkState(slug);
  if (st && (st.status === 'downloading' || st.status === 'installing')) return true;
  const dl = getActiveDownloadMap()[slug];
  if (!dl) return false;
  if (dl.status === 'downloading' || dl.status === 'installing' || dl.status === 'paused') return true;
  // A 'paused' record is waiting for the user, and a record that was handed to
  // the platform downloader keeps running outside this page.
  if (dl.handed_off) return true;
  return false;
}
function applyInstalled(slug, resolvedPkg) {
  if (!slug) return;
  if (hasInFlightApk(slug)) return;
  const now = Date.now();
  if (now - (recentInstalledAt[slug] || 0) < 500) return;
  recentInstalledAt[slug] = now;
  if (resolvedPkg) rememberResolvedPackage(slug, resolvedPkg);
  markInstalledStored(slug);
  removeApkState(slug);
  removeActiveDownload(slug);
  try { window.dispatchEvent(new CustomEvent('gs-apk-state', { detail: { slug, status: 'installed', progress: 1, message: resolvedPkg || '' } })); } catch (e) {}
  try { window.dispatchEvent(new CustomEvent('gs-install-resolved', { detail: { slug, packageName: resolvedPkg || '' } })); } catch (e) {}
}
const watchedApps = new Map();
let heartbeatTimer = null;
function registerInstallWatch(slug, packageName) {
  if (!slug) return;
  watchedApps.set(slug, packageName || '');
  startHeartbeat();
}
function startHeartbeat() {
  if (heartbeatTimer || !isNativeBridge()) return;
  heartbeatTimer = setInterval(heartbeatTick, 400);
  heartbeatTick();
  const onVisible = () => { if (!document.hidden) heartbeatTick(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  window.addEventListener('pageshow', onVisible);
}
let heartbeatBusy = false;
function heartbeatTick() {
  if (!isNativeBridge()) return;
  // Never overlap ticks and never burn CPU while the WebView is in the
  // background — that was making the whole page feel unresponsive.
  if (heartbeatBusy || (typeof document !== 'undefined' && document.hidden)) return;
  heartbeatBusy = true;
  try {
    watchedApps.forEach((pkg, slug) => {
      const targetPkg = pkg || resolvedPackageName(slug) || '';
      const st = checkAppStatus(slug, targetPkg);
      if (st && st.installed) {
        if (!hasInFlightApk(slug)) applyInstalled(slug, st.package_name);
      } else if (st && !st.installed && isInstalledStored(slug)) {
        unmarkInstalledStored(slug);
        removeApkState(slug);
        removeActiveDownload(slug);
        try { window.dispatchEvent(new CustomEvent('gs-apk-state', { detail: { slug, status: 'uninstalled', progress: -1, message: targetPkg } })); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('gs-package-uninstalled', { detail: { slug, packageName: targetPkg } })); } catch (e) {}
      }
    });
    const map = getApkStateMap();
    Object.keys(map).forEach((slug) => {
      const st = map[slug];
      if (!st || st.status === 'none') return;
      if (st.status === 'downloading') return;
      const info = st.package_name || resolvedPackageName(slug) || '';
      const res = checkAppStatus(slug, info);
      if (res && res.installed) {
        if (!hasInFlightApk(slug)) applyInstalled(slug, res.package_name);
      } else if (res && !res.installed && isInstalledStored(slug)) {
        unmarkInstalledStored(slug);
        removeApkState(slug);
        removeActiveDownload(slug);
        try { window.dispatchEvent(new CustomEvent('gs-apk-state', { detail: { slug, status: 'uninstalled', progress: -1, message: info } })); } catch (e) {}
      }
    });
  } catch (e) { console.error('[heartbeat]', e); }
  finally { heartbeatBusy = false; }
}

/* ------------------- Installed apps registry (device truth) ------------------- */
const INSTALL_KEY = 'gs_installed';
function installedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(INSTALL_KEY) || '[]')); } catch { return new Set(); }
}
function isInstalledStored(slug) { return installedSet().has(slug); }
function markInstalledStored(slug) {
  try { const s = installedSet(); s.add(slug); localStorage.setItem(INSTALL_KEY, JSON.stringify([...s])); } catch {}
}
function unmarkInstalledStored(slug) {
  try { const s = installedSet(); s.delete(slug); localStorage.setItem(INSTALL_KEY, JSON.stringify([...s])); } catch {}
}
function installedVersionOnDevice(packageName) {
  if (!hasDeviceBridge() || !packageName) return '';
  try {
    if (window.GSAndroid && typeof window.GSAndroid.isPackageInstalled === 'function') {
      return window.GSAndroid.isPackageInstalled(packageName) || '';
    }
  } catch (e) {}
  return '';
}
function isSlugInstalled(slug) {
  if (!hasDeviceBridge() || !slug) return '';
  try {
    if (window.GSAndroid && typeof window.GSAndroid.isSlugInstalled === 'function') {
      return window.GSAndroid.isSlugInstalled(slug) || '';
    }
  } catch (e) {}
  return '';
}
function versionIsNewer(storeVersion, deviceVersion) {
  if (!storeVersion || !deviceVersion) return false;
  if (deviceVersion === 'installed') return false;
  const norm = (v) => String(v).split(/[.\-_+]/).map((x) => parseInt(x, 10) || 0);
  const a = norm(storeVersion), b = norm(deviceVersion);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}
/* Device truth for one app, using the REAL GSAndroid bridge (not Capacitor). */
function deviceAppInfo(app) {
  const empty = { installed: false, version: '', versionCode: 0 };
  if (!app || !hasDeviceBridge()) return empty;
  /* The row is the truth. A remembered package is only a fallback for rows that
     have none — otherwise editing «اسم الحزمة» in the dashboard changed the store
     while the installed app kept asking Android about the OLD package and
     reported the app as not installed. */
  const pkg = String(app.package_name || '').trim()
    || (typeof resolvedPackageName === 'function' ? resolvedPackageName(app.slug) : '') || '';
  const st = typeof checkAppStatus === 'function' ? checkAppStatus(app.slug, pkg) : null;
  if (st && st.installed) {
    return {
      installed: true,
      version: String(st.version || st.version_name || '').trim(),
      versionCode: Number(st.version_code || st.versionCode || 0) || 0,
    };
  }
  const raw = String(
    (typeof installedVersionOnDevice === 'function' ? installedVersionOnDevice(pkg) : '')
    || (typeof isSlugInstalled === 'function' ? isSlugInstalled(app.slug) : '')
    || ''
  ).trim();
  if (!raw) return empty;
  return { installed: true, version: raw === 'installed' ? '' : raw, versionCode: 0 };
}
function isAppInstalledOnDevice(app) { return deviceAppInfo(app).installed; }
/* Does the store APK represent a NEWER build than the copy on this device?
   Uses version_code first, then version_name, and — when the bridge cannot
   report a device version — treats the store build as newer instead of
   silently re-opening an old installation. */
function appHasUpdate(app) {
  const info = deviceAppInfo(app);
  if (!info.installed) return false;
  const storeCode = Number(app.version_code || 0) || 0;
  const storeName = String(app.version_name || '').trim();
  if (storeCode > 0 && info.versionCode > 0) return storeCode > info.versionCode;
  if (storeName && info.version) return versionIsNewer(storeName, info.version);
  // Unknown device version: never OPEN instead of updating a user-downloaded APK.
  return !!storeName;
}

/* Ask the API for the app's permanent APK url.
   Used by the native download path when the app payload was served from a
   cached response that predates `apk_url`: the phone's own downloader must
   never be handed a pre-signed link that expires in five minutes. */
async function resolveApkUrl(slug) {
  if (!slug) return '';
  try {
    const res = await api(`/api/apps/${encodeURIComponent(slug)}`);
    const app = (res && (res.app || res)) || {};
    const url = typeof app.apk_url === 'string' ? app.apk_url : '';
    return /^https:\/\//.test(url) ? url : '';
  } catch { return ''; }
}

function cancelDownload(slug) {
  try {
    abortWebDownload(slug);
    if (hasDeviceBridge() && window.GSAndroid && typeof window.GSAndroid.cancelDownload === 'function') {
      window.GSAndroid.cancelDownload(slug);
    }
    removeActiveDownload(slug);   // only THIS slug; other downloads stay active
    removeApkState(slug);
  } catch (e) {}
}

/* ----------------------------- Boot ----------------------------- */
function boot() {
  initAuth();
  bindAndroidShareTarget();
  pruneStaleApkStates();
  syncNativeStates();
  startHeartbeat();
  if (hasDeviceBridge()) setTimeout(checkAppUpdate, 2000);
}

/* ----------------------------- Download History ----------------------------- */
const DL_HISTORY_KEY = 'gs_downloads';
function getDownloadHistory() {
  try { return JSON.parse(localStorage.getItem(DL_HISTORY_KEY) || '[]'); } catch { return []; }
}
function addToDownloadHistory(app) {
  try {
    const list = getDownloadHistory();
    const filtered = list.filter((e) => e.slug !== app.slug);
    filtered.unshift({
      slug: app.slug,
      name: app.name,
      icon_url: app.icon_url || null,
      developer: app.developer || '',
      size_bytes: app.size_bytes || 0,
      package_name: app.package_name || '',
      downloaded_at: Math.floor(Date.now() / 1000),
    });
    localStorage.setItem(DL_HISTORY_KEY, JSON.stringify(filtered.slice(0, 200)));
  } catch {}
}
function clearDownloadHistory() {
  try { localStorage.removeItem(DL_HISTORY_KEY); } catch {}
}

/* Concurrent downloads: explicit owner request = UNLIMITED simultaneous
   downloads. Every slug owns its own controller/reader; starting a second
   app/game never aborts or removes another slug's entry. */
const MAX_CONCURRENT_DOWNLOADS = Infinity;
const WEB_DOWNLOAD_CONTROLLERS = new Map();
const WEB_DOWNLOAD_READERS = new Map();
function downloadConcurrencyLimit() { return MAX_CONCURRENT_DOWNLOADS; }
function canStartConcurrentDownload() { return true; }
function registerWebDownload(slug, controller, reader) {
  if (!slug) return;
  if (controller) WEB_DOWNLOAD_CONTROLLERS.set(slug, controller);
  if (reader) WEB_DOWNLOAD_READERS.set(slug, reader);
}
function abortWebDownload(slug) {
  const c = WEB_DOWNLOAD_CONTROLLERS.get(slug);
  if (c) { try { c.abort(); } catch {} }
  const r = WEB_DOWNLOAD_READERS.get(slug);
  if (r) { try { r.cancel().catch(() => {}); } catch {} }
  WEB_DOWNLOAD_CONTROLLERS.delete(slug);
  WEB_DOWNLOAD_READERS.delete(slug);
}
function unregisterWebDownload(slug) {
  WEB_DOWNLOAD_CONTROLLERS.delete(slug);
  WEB_DOWNLOAD_READERS.delete(slug);
}

/* ---------------------------------------------------------------------------
   PAUSED DOWNLOADS
   ---------------------------------------------------------------------------
   A `fetch` stream is killed by the browser when the document unloads, so a
   download used to die the moment the user opened another app or game. The
   stream now records how far it got and keeps the slug ACTIVE (never failed,
   never removed), so:
     · «مكتبتي» still shows the download after the page is gone,
     · coming back resumes from that byte offset with a Range request instead
       of starting again at 0 %.
   The record is small and lives next to the other download state.
   ------------------------------------------------------------------------- */
const PAUSED_DL_KEY = 'gs_paused_dl';

function getPausedMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(PAUSED_DL_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

/** Remember where a stream stopped. Called on page leave (not on a real cancel). */
function pauseDownload(slug, info) {
  if (!slug) return null;
  const map = getPausedMap();
  const received = Math.max(0, Number(info && info.received) || 0);
  const total = Math.max(0, Number(info && info.total) || 0);
  map[slug] = {
    received,
    total,
    filename: (info && info.filename) || '',
    pct: total > 0 ? Math.min(99, Math.floor((received / total) * 100)) : 0,
    paused_at: Math.floor(Date.now() / 1000),
  };
  try { localStorage.setItem(PAUSED_DL_KEY, JSON.stringify(map)); } catch {}
  // The entry stays active: a download that is waiting is not a failed download.
  const active = getActiveDownloadMap();
  if (active[slug]) {
    active[slug] = { ...active[slug], status: 'paused', progress: map[slug].pct, paused: true };
    writeActiveDownloadMap(active);
  }
  return map[slug];
}

function getPausedDownload(slug) {
  if (!slug) return null;
  const rec = getPausedMap()[slug];
  return rec && Number(rec.received) > 0 ? rec : null;
}

/** Bytes already on the device for this slug, or 0 when starting fresh. */
function pausedDownloadOffset(slug) {
  const rec = getPausedDownload(slug);
  return rec ? Number(rec.received) || 0 : 0;
}

function clearPausedDownload(slug) {
  if (!slug) return;
  const map = getPausedMap();
  if (!Object.prototype.hasOwnProperty.call(map, slug)) return;
  delete map[slug];
  try { localStorage.setItem(PAUSED_DL_KEY, JSON.stringify(map)); } catch {}
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
  if (entry.status === 'downloading') clearDeletedApk(entry.slug);
  // Map is keyed by slug: unlimited entries coexist, no global slot/cancel.
  const map = getActiveDownloadMap();
  map[entry.slug] = { ...(map[entry.slug] || {}), ...entry };
  writeActiveDownloadMap(map);
  return map[entry.slug];
}
const lastProgressWriteAt = Object.create(null);
function updateActiveDownloadProgress(slug, progress) {
  if (!slug) return;
  // Progress arrives many times per second; writing + broadcasting every time
  // re-renders every listener and stutters the UI. 400ms is plenty.
  const now = Date.now();
  const key = `${slug}`;
  const last = lastProgressWriteAt[key] || 0;
  const p = Number(progress);
  if (now - last < 400 && p !== 1 && p !== 0 && p !== -1) return;
  lastProgressWriteAt[key] = now;
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
(function injectNativeUx() {
  try {
    var style = document.createElement('style');
    style.textContent =
      'html,body{-webkit-text-size-adjust:100%;touch-action:manipulation;}' +
      '*{-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;}' +
      'body{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;}' +
      'input,textarea,[contenteditable="true"]{-webkit-user-select:text;user-select:text;}';
    (document.head || document.documentElement).appendChild(style);
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('touchmove', function (e) {
      if (e.touches && e.touches.length > 1) e.preventDefault();
    }, { passive: false });
  } catch (e) {}
})();

(function pushBridge() {
  /* Unified native bridge.
     The APK historically called window.__gsRegisterPushToken(token) which
     posted to the OLD native registration path, while the Web
     Push client used a different table. That is exactly why one device ended
     up with several registrations (and several notifications). Both paths now
     converge on GSNotify.registerNativeToken() → the unified device registry.
     The function name is kept so existing APK builds keep working. */
  function call(token, extra) {
    try {
      if (window.GSNotify && typeof window.GSNotify.registerNativeToken === 'function') {
        return window.GSNotify.registerNativeToken(token, extra || {});
      }
    } catch (e) {}
    // Fallback for a page where the hub has not loaded yet.
    return new Promise(function (resolve) {
      setTimeout(function () {
        try {
          if (window.GSNotify && typeof window.GSNotify.registerNativeToken === 'function') {
            resolve(window.GSNotify.registerNativeToken(token, extra || {}));
          } else resolve({ ok: false, error: 'hub_unavailable' });
        } catch (e) { resolve({ ok: false, error: String(e) }); }
      }, 300);
    });
  }

  window.__gsRegisterPushToken = function (token, installationId) {
    if (!token || typeof token !== 'string') return;
    var extra = { platform: 'android' };
    if (installationId) extra.installation_id = String(installationId);
    call(token, extra).catch(function () {});
  };

  window.__gsUnregisterPushToken = function (token) {
    if (!token) return;
    try {
      fetch('/api/notifications/unregister-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  };
})();

window.Store = {
  STORE, api, apiList, authedApi, el, ico, t,
  formatBytes, formatCount, formatNum, formatDate, ratingOf, ratingValue, ratingCountOf, getQuery, toast,
  publicOrigin,
  publicSiteOrigin,
  posterCard, listRow, gridCard, featureCarousel, categoryName, appName, appNameAttrs,
  spinner, skeletonHome, skeletonDetail, skeletonList, skeletonSimilar, emptyState, errorState,
  topbarSearch, topbarNav, bottomNav, renderSiteFooter, avatarEl, themeToggleBtn, langSwitcherEl, toggleTheme, currentTheme,
  fetchNotifications, notifUnreadCount, notifSeenAt, setNotifSeenAt, openNotifications, loadNotificationsForPage,
  ready, onAuthChanged, signOut, getUser: () => _user, isLoggedIn, requireAuth, goToLogin,
  openSupportSheet, supportTopButton,
  apiBaseUrl,
  getDownloadHistory, addToDownloadHistory, clearDownloadHistory,
  getActiveDownloads, setActiveDownload, updateActiveDownloadProgress, removeActiveDownload, onActiveDownloadsChange,
  downloadConcurrencyLimit, canStartConcurrentDownload, registerWebDownload, abortWebDownload, unregisterWebDownload,
  hasDeviceBridge, durableRoutes, startNativeDownload, hasCapacitorFilesystem, hasCapacitorBrowser, hasDurableDownloader, startDurableDownload, downloadableUrl, pauseDownload, getPausedDownload, clearPausedDownload, pausedDownloadOffset, resolveApkUrl,
  markDownloadHandedOff,
  getApkState, getApkStateMap, setApkState, removeApkState, onApkState, syncNativeStates,
  isDeletedApk, markDeletedApk, clearDeletedApk,
  isDeadApkFile, markDeadApkFile, clearDeadApkFile,
  isInstalledStored, markInstalledStored, unmarkInstalledStored,
  installedVersionOnDevice, versionIsNewer, appHasUpdate, isAppInstalledOnDevice, cancelDownload, isSlugInstalled,
  checkAppStatus, resolvedPackageName, rememberResolvedPackage, clearResolvedPackage, registerInstallWatch, applyInstalled, hasInFlightApk,
  checkAppUpdate, checkForUpdates, showUpdateDialog, showUpdateBanner, shouldShowUpdate, offlineScreen, getCurrentAppVersion,
};

document.addEventListener('DOMContentLoaded', boot);
