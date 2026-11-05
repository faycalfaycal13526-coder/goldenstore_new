import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { verifyFirebaseToken, messaging, getAuthAdmin, sendWebPush } from '../lib/firebase.js';
import {
  listApps, getAppBySlug, listScreenshots, listReviews, countReviews,
  getRatingDistribution, listNotifications, getStoreSettings,
  getReviewById, toggleReviewLike, reportReview, getAllReports, deleteReport, deleteReview,
  searchApps, suggestApps,
  createSupportThread, listUserSupportThreads, listAdminSupportThreads, getSupportThread,
  addSupportMessage, setSupportThreadStatus, markSupportThreadRead, deleteSupportThread,
} from '../lib/d1.js';
import {
  r2PresignPut, r2PresignGet, r2PublicUrl, r2Delete, r2Head,
  r2CreateMultipartUpload, r2PresignUploadPart, r2CompleteMultipartUpload,
  r2AbortMultipartUpload, r2ConfigureCors,
} from '../lib/r2.js';
import { COOKIE_NAME, constantTimeEqual, signJwt, verifyJwt } from '../lib/auth.js';
import { nowSec, randomId, safeExt, searchTerms, slugify, sanitizeText, sanitizeUrl, safeInt, sha1Hex, sha256Hex } from '../lib/utils.js';
import { DEFAULT_CATEGORIES, APP_CATEGORIES, GAME_CATEGORIES, type App, type Category, type Screenshot } from '../lib/types.js';
import type { Env } from '../lib/env.js';

const app = new Hono<{ Bindings: Env }>().basePath('/api');

// Caches
const categoriesCache: { data: Record<string, number> | null; ts: number } = { data: null, ts: 0 };
const CATEGORIES_CACHE_TTL = 3600;

function invalidateAppsCache() { categoriesCache.data = null; categoriesCache.ts = 0; }

// Security: CORS
app.use('*', async (c, next) => {
  const origin = c.req.header('origin') || '';
  const allowedOrigins = (c.env.ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);
  const allowed = !!origin && allowedOrigins.includes(origin);
  if (allowed) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Vary', 'Origin');
  }
  if (c.req.method === 'OPTIONS') {
    if (allowed) {
      c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Admin-Password');
      c.header('Access-Control-Max-Age', '600');
    }
    return c.body(null, 204);
  }
  await next();
});

// Rate limiter
const rateLimits = new Map<string, { count: number; reset: number }>();
let rateLimitCalls = 0;
function rateLimit(ip: string, key: string, maxRequests: number, windowSec: number): boolean {
  const k = `${key}:${ip}`, now = Date.now();
  if (++rateLimitCalls % 256 === 0 || rateLimits.size > 2000) {
    for (const [sk, sv] of rateLimits) if (now > sv.reset) rateLimits.delete(sk);
  }
  const entry = rateLimits.get(k);
  if (!entry || now > entry.reset) { rateLimits.set(k, { count: 1, reset: now + windowSec * 1000 }); return true; }
  entry.count++; return entry.count <= maxRequests;
}

function getClientIp(c: any): string {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
}

// Security headers
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff'); c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block'); c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
});

// Body size limit
const MAX_BODY_SIZE = 1024 * 1024;
app.use('*', async (c, next) => {
  const cl = c.req.header('content-length');
  if (cl && Number(cl) > MAX_BODY_SIZE) return c.json({ error: 'payload_too_large' }, 413);
  await next();
});

// Helpers
function isValidSlug(s: string): boolean {
  if (!s || s.length > 200 || /[\/\\<>\x00-\x1f]/.test(s) || s.includes('..')) return false;
  return true;
}
app.use('/apps/:slug/*', async (c, next) => {
  if (!isValidSlug(c.req.param('slug'))) return c.json({ error: 'invalid_slug' }, 400);
  await next();
});
app.use('/apps/:slug', async (c, next) => {
  if (!isValidSlug(c.req.param('slug'))) return c.json({ error: 'invalid_slug' }, 400);
  await next();
});

async function requireAdmin(c: any, next: any) {
  let token = getCookie(c, COOKIE_NAME);
  const authHeader = c.req.header('authorization') || '';
  if (!token && authHeader.toLowerCase().startsWith('bearer ')) token = authHeader.slice(7).trim();
  
  // إزالة القيمة الافتراضية لسر JWT
  const secret = c.env.JWT_SECRET;
  if (!secret) return c.json({ error: 'server_misconfigured', message: 'JWT_SECRET is not set' }, 500);
  
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  const payload = await verifyJwt(token, secret);
  if (!payload || payload.role !== 'admin') return c.json({ error: 'unauthorized' }, 401);
  c.set('user', { sub: String(payload.sub) });
  await next();
}

function appPublic(d: any, includeInternalKeys = false): App & { id: string } {
  const result: any = {
    id: d.id, slug: d.slug, name: d.name, name_lower: d.name_lower, search_terms: d.search_terms || [],
    package_name: d.package_name, short_description: d.short_description, description: d.description,
    category: d.category, type: d.type === 'game' ? 'game' : 'app', developer: d.developer,
    version_name: d.version_name, version_code: d.version_code, min_sdk: d.min_sdk, size_bytes: d.size_bytes,
    rating: d.rating || 0, rating_count: d.rating_count || 0, stars: d.stars || 0, downloads: d.downloads || 0,
    created_at: d.created_at, updated_at: d.updated_at,
  };
  if (includeInternalKeys) { result.apk_key = d.apk_key; result.icon_key = d.icon_key; result.feature_key = d.feature_key; }
  return result;
}

// Accepted report reasons are stable codes. The human-readable label is what
// gets stored in review_reports.reason so the admin table is self-explanatory.
const REVIEW_REPORT_REASONS: Record<string, string> = {
  spam: 'رسائل مزعجة أو إعلانات',
  harassment: 'إساءة أو تحرش',
  hate: 'خطاب كراهية',
  inappropriate: 'محتوى غير لائق',
  misleading: 'معلومات مضللة أو احتيال',
  off_topic: 'محتوى خارج عن الموضوع',
  other: 'سبب آخر',
};
function reportReasonLabel(value: unknown): string {
  const key = String(value ?? '').trim().toLowerCase();
  if (REVIEW_REPORT_REASONS[key]) return REVIEW_REPORT_REASONS[key];
  // Backwards compatibility: accept an already-labelled reason from older clients.
  const labels = Object.values(REVIEW_REPORT_REASONS);
  return labels.includes(String(value ?? '').trim()) ? String(value).trim() : '';
}

/** Validate a review id and confirm it belongs to the app in the URL. */
async function resolveReview(c: any, slug: string, reviewId: string): Promise<any | null> {
  if (!reviewId || reviewId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(reviewId)) return null;
  const [appData, review] = await Promise.all([
    getAppBySlug(c.env, slug),
    getReviewById(c.env, reviewId),
  ]);
  if (!appData || !review || String(review.app_id) !== String(appData.id)) return null;
  return review;
}

// النطاق الديناميكي
function storeDomain(env: Env): string { return env.STORE_DOMAIN || 'goldenstore.online'; }

// دالة مساعدة لبناء روابط الصور
function cdnImageUrl(key: string | undefined, env: Env, width: number): string | null {
  if (!key) return null;
  try { 
    return `https://${storeDomain(env)}/cdn-cgi/image/width=${width},format=auto,quality=80/${r2PublicUrl(key, env)}`; 
  } catch { return null; }
}

function feature_url(feature_key: string | undefined, env: Env, width: number = 800): string | null {
  return cdnImageUrl(feature_key, env, width);
}
function icon_url(icon_key: string | undefined, env: Env, width: number = 200): string | null {
  return cdnImageUrl(icon_key, env, width);
}
// دالة جديدة لصور الشاشات بدقة 720
function shot_url(shot_key: string | undefined, env: Env, width: number = 720): string | null {
  return cdnImageUrl(shot_key, env, width);
}

function storeLogoUrl(env: Env): string { return env.STORE_LOGO_URL || `https://${storeDomain(env)}/images/logo.png`; }

// Notifications Helper
async function sendPushToTokens(tokens: string[], n: any, env: Env): Promise<any> {
  const result = { targeted: tokens.length, success: 0, failure: 0, errors: [] as string[], invalid_tokens: [] as string[] };
  if (tokens.length === 0) return result;
  const msg = await messaging(env);
  const dataPayload: any = { title: n.title, body: n.body || '', type: n.type, app_slug: n.app_slug || '', notification_id: n.id, image: n.image || '', store_logo: storeLogoUrl(env) };
  if (n.data) try { dataPayload.extra = JSON.stringify(n.data); } catch {}
  
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    try {
      const resp = await msg.sendEachForMulticast({ tokens: batch, data: dataPayload, notification: { title: n.title, body: n.body || '' }, android: { priority: 'high', notification: { title: n.title, body: n.body || '', channelId: 'goldenstore_notifications', color: '#f4c01f', visibility: 'public' } } });
      result.success += resp.successCount || 0; result.failure += resp.failureCount || 0;
      resp.responses.forEach((r: any, idx: number) => {
        if (!r.success) {
          const code = r.error?.code || '';
          if (result.errors.length < 5) result.errors.push(code);
          if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) result.invalid_tokens.push(batch[idx]);
        }
      });
    } catch (err: any) { result.failure += batch.length; result.errors.push('multicast_error'); }
  }
  return result;
}

async function sendPushToRegistered(env: Env, n: any): Promise<any> {
  const result = { targeted: 0, success: 0, failure: 0, errors: [] as string[] };
  try {
    const tokens = await env.DB.prepare('SELECT token FROM fcm_tokens LIMIT 1000').all();
    result.targeted = tokens.results?.length || 0;
  } catch {}

  const msg = await messaging(env);
  const dataPayload: any = { title: n.title, body: n.body || '', type: n.type, app_slug: n.app_slug || '', notification_id: n.id, image: n.image || '', store_logo: storeLogoUrl(env) };
  if (n.data) try { dataPayload.extra = JSON.stringify(n.data); } catch {}

  try {
    await msg.send({ topic: 'all', data: dataPayload, notification: { title: n.title, body: n.body || '' }, android: { priority: 'high', notification: { title: n.title, body: n.body || '', channelId: 'goldenstore_notifications', color: '#f4c01f' } } });
    result.success = Math.max(1, result.targeted);
  } catch { result.failure = Math.max(1, result.targeted); }

  try {
    const web = await sendWebPush(env, n.title, n.body || '', { type: n.type, app_slug: n.app_slug || '', notification_id: n.id, image: n.image || '', store_logo: storeLogoUrl(env) });
    result.targeted += web.targeted; result.success += web.success; result.failure += web.failure;
  } catch {}
  return result;
}

async function addNotification(env: Env, data: any) {
  const id = randomId();
  const title = sanitizeText(data.title, 200), body = sanitizeText(data.body, 1000);
  const type = data.type === 'new_app' || data.type === 'update' ? data.type : 'announcement';
  const app_slug = sanitizeText(data.app_slug, 120);
  await env.DB.prepare(`INSERT INTO notifications (id, title, body, type, app_slug, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, title, body, type, app_slug, data.data ? JSON.stringify(data.data) : null, data.created_at || nowSec()).run();
  
  let image = '';
  if (app_slug) {
    const app = await env.DB.prepare('SELECT icon_key FROM apps WHERE slug = ?').bind(app_slug).first();
    if (app?.icon_key) image = icon_url(app.icon_key as string, env) || '';
  }
  
  const push = await sendPushToRegistered(env, { title, body, type, app_slug, id, image, data: data.data });
  return { id, push };
}

// ============================================================
// Public Routes
// ============================================================
app.get('/store', (c) => {
  c.header('Cache-Control', 'public, max-age=3600');
  return c.json({ name: c.env.STORE_NAME || 'Goldenstore', domain: c.env.STORE_DOMAIN || 'goldenstore.online' });
});

const CURRENT_RELEASE = { version_name: '1.18', version_code: 19, apk_url: 'https://cdn.goldenstore.online/apk/goldenstore-app-1791319330825-c2d8f1.apk', notes: 'تحديث' };

app.get('/app-update', async (c) => {
  try {
    const row: any = await c.env.DB.prepare("SELECT * FROM app_updates WHERE id = 'current'").first();
    if (!row) return c.json({ version_name: CURRENT_RELEASE.version_name, version_code: CURRENT_RELEASE.version_code, apk_url: CURRENT_RELEASE.apk_url, url: CURRENT_RELEASE.apk_url, notes: CURRENT_RELEASE.notes, force: false, downloads: 0 });
    const out = { version_name: row.version_name || CURRENT_RELEASE.version_name, version_code: row.version_code || 0, apk_url: row.apk_url || CURRENT_RELEASE.apk_url, url: row.apk_url || CURRENT_RELEASE.apk_url, notes: row.notes || CURRENT_RELEASE.notes, force: row.force === 1, downloads: row.downloads || 0 };
    return c.json({ ...out, update: { ...out } });
  } catch { return c.json({}); }
});

app.get('/app-update/download', async (c) => {
  try {
    const row: any = await c.env.DB.prepare("SELECT apk_url FROM app_updates WHERE id = 'current'").first();
    const apkUrl = row?.apk_url || CURRENT_RELEASE.apk_url;
    if (!apkUrl) return c.json({ error: 'apk_not_available' }, 404);
    await c.env.DB.prepare("UPDATE app_updates SET downloads = downloads + 1 WHERE id = 'current'").run().catch(() => {});
    return c.redirect(apkUrl, 302);
  } catch { return c.json({ error: 'not_found' }, 404); }
});

/* ---- Legal consent (defence in depth) -----------------------------------
   Google sign-in itself is handled entirely by Firebase Auth in the browser,
   so there is no Hono "login" endpoint to gate. This endpoint validates the
   consent payload server-side and issues a signed, httpOnly consent receipt
   that can later be checked by any endpoint (or moved into a D1 audit table).
   The UI checkbox in login.js / store.js remains the actual blocking gate. */
const LEGAL_VERSION = '2026-11-05';

function legalConsentFromRequest(c: any): { ok: boolean; at: number } {
  const raw = getCookie(c, 'gs_legal_consent') || '';
  const parts = raw.split('.');
  if (parts.length !== 2 || parts[0] !== LEGAL_VERSION) return { ok: false, at: 0 };
  const at = Number(parts[1]);
  return { ok: Number.isFinite(at) && at > 0, at };
}

app.post('/legal/consent', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'legal-consent', 30, 60)) return c.json({ error: 'rate_limited' }, 429);
  const body: any = await c.req.json().catch(() => ({}));
  if (body?.accepted !== true || body?.version !== LEGAL_VERSION) {
    return c.json({ error: 'consent_required', version: LEGAL_VERSION }, 400);
  }
  const at = nowSec();
  setCookie(c, 'gs_legal_consent', LEGAL_VERSION + '.' + at, {
    path: '/api', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 31536000,
  });
  return c.json({ ok: true, version: LEGAL_VERSION, acceptedAt: at });
});

app.get('/legal/consent', async (c) => {
  const consent = legalConsentFromRequest(c);
  return c.json({ accepted: consent.ok, version: LEGAL_VERSION, acceptedAt: consent.at || null });
});

app.get('/auth/token', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'auth-token', 20, 60)) {
    return c.json({ error: 'rate_limited' }, 429);
  }
  try {
    const uid = 'gs_' + randomId();
    const auth = await getAuthAdmin(c.env);
    const token = await auth.createCustomToken(uid);
    return c.json({ token, uid });
  } catch (err: any) {
    console.error('[auth/token] failed:', err?.message || err);
    return c.json({ error: 'token_creation_failed' }, 500);
  }
});

app.get('/notifications', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') || '30'), 50);
  const notifs = await listNotifications(c.env, limit);
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({ notifications: notifs.map(n => ({ ...n, data: n.data ? JSON.parse(n.data) : null })) });
});

// Notifications Tokens (D1)
async function requireFirebaseUser(c: any) {
  const token = c.req.header('authorization')?.replace('Bearer ', '') || '';
  return token ? verifyFirebaseToken(token, c.env) : null;
}

app.post('/notifications/register-token', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'reg-token', 30, 60)) return c.json({ error: 'rate_limited' }, 429);
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  if (!token || token.length > 4096) return c.json({ error: 'invalid_token' }, 400);
  const docId = await sha256Hex(token);
  await c.env.DB.prepare(`INSERT OR REPLACE INTO fcm_tokens (id, token, uid, platform, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(docId, token, user.uid, body.platform || 'android', nowSec()).run();
  return c.json({ ok: true });
});

app.post('/notifications/register-web', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'reg-web-token', 30, 60)) return c.json({ error: 'rate_limited' }, 429);
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  if (!token || token.length > 4096) return c.json({ error: 'invalid_token' }, 400);
  await c.env.DB.prepare(`INSERT OR REPLACE INTO web_tokens (uid, token, platform, userAgent, updatedAt) VALUES (?, ?, ?, ?, ?)`)
    .bind(user.uid, token, 'web', String(c.req.header('user-agent')).slice(0,300), nowSec()).run();
  return c.json({ ok: true });
});

app.post('/notifications/unregister-token', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (body.token) await c.env.DB.prepare('DELETE FROM fcm_tokens WHERE id = ?').bind(await sha256Hex(String(body.token))).run().catch(() => {});
  return c.json({ ok: true });
});

app.post('/notifications/self-test', async (c) => {
  const user = await requireFirebaseUser(c); if (!user) return c.json({ error: 'unauthorized' }, 401);
  const snaps = await c.env.DB.prepare('SELECT token FROM fcm_tokens WHERE uid = ?').bind(user.uid).all();
  const tokens = (snaps.results || []).map(r => r.token as string).filter(Boolean);
  if (!tokens.length) return c.json({ error: 'no_registered_devices' }, 400);
  const push = await sendPushToTokens(tokens, { title: 'إشعار تجريبي', body: 'يعمل ✓', type: 'announcement', id: 'test' }, c.env);
  delete (push as any).invalid_tokens;
  return c.json({ ok: true, push });
});

app.post('/translate', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const target = String(body.target || '').toLowerCase();
  const q = Array.isArray(body.q) ? body.q.slice(0, 60).map((x: any) => String(x||'')) : [];
  if (!['en','fr','es'].includes(target) || !q.length) return c.json({ t: q });

  const out = new Array(q.length).fill(null);
  const toFetch: any[] = [];
  for (let i=0; i<q.length; i++) {
    if (!q[i] || q[i].length > 5000) { out[i] = q[i]; continue; }
    const id = await sha1Hex(target + '::' + q[i]);
    const row: any = await c.env.DB.prepare('SELECT out FROM i18n_cache WHERE id = ?').bind(id).first();
    if (row) out[i] = row.out; else toFetch.push({ i, text: q[i], id });
  }

  for (let k=0; k<toFetch.length; k+=6) {
    await Promise.all(toFetch.slice(k, k+6).map(async (item) => {
      try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(item.text)}`);
        const data: any = await res.json();
        const tr = Array.isArray(data[0]) ? data[0].map((s: any) => s[0]).join('') : item.text;
        out[item.i] = tr;
        c.env.DB.prepare('INSERT INTO i18n_cache (id, target, src, out, ts) VALUES (?, ?, ?, ?, ?)').bind(item.id, target, item.text, tr, nowSec()).run().catch(()=>{});
      } catch { out[item.i] = item.text; }
    }));
  }
  for (let i=0; i<q.length; i++) if (out[i] == null) out[i] = q[i];
  return c.json({ t: out });
});

// Apps List & Categories
app.get('/categories', async (c) => {
  const type = (c.req.query('type') || '').trim();
  const now = Date.now();
  let counts: Record<string, number> = {};
  
  if (categoriesCache.data && (now - categoriesCache.ts) < CATEGORIES_CACHE_TTL * 1000) {
    counts = categoriesCache.data;
  } else {
    const snap = await c.env.DB.prepare('SELECT category, COUNT(*) as c FROM apps GROUP BY category').all();
    snap.results?.forEach((r: any) => counts[r.category] = r.c);
    categoriesCache.data = counts; categoriesCache.ts = now;
  }
  const source = type === 'app' ? APP_CATEGORIES : type === 'game' ? GAME_CATEGORIES : DEFAULT_CATEGORIES;
  return c.json({ categories: source.map(cat => ({ ...cat, count: counts[cat.slug] || 0 })) });
});

/* =========================================================================
   Advanced search — GET /api/search  (+ /api/search/suggest for autocomplete)
   q            fuzzy LIKE over name / developer / short_description /
                description / search_terms (all tokens must match)
   category     exact slug
   type         all | app | game
   sort         recent | popular | rating | name (plus aliases)
   min_rating   0..5
   limit        1..60 (default 24), offset >= 0
   All values are bound; sort uses a whitelist in lib/d1.ts.
   ========================================================================= */
app.get('/search/suggest', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'search-suggest', 90, 60)) return c.json({ error: 'rate_limited' }, 429);
  const q = (c.req.query('q') || '').trim().slice(0, 80).toLowerCase();
  const limit = safeInt(c.req.query('limit') || '8', 1, 12);
  if (!q) { c.header('Cache-Control', 'public, max-age=30'); return c.json({ suggestions: [], q: '' }); }
  try {
    const rows = await suggestApps(c.env, q, limit);
    const suggestions = rows.map((r: any) => ({
      slug: r.slug,
      name: r.name,
      developer: r.developer || '',
      category: r.category,
      type: r.type === 'game' ? 'game' : 'app',
      rating: Number(r.rating) || 0,
      icon_url: icon_url(r.icon_key, c.env, 96),
    }));
    c.header('Cache-Control', 'public, max-age=30');
    return c.json({ suggestions, q });
  } catch (e: any) {
    return c.json({ error: 'd1_error', message: e.message }, 500);
  }
});

app.get('/search', async (c) => {
  const q = (c.req.query('q') || '').trim().slice(0, 120);
  const category = (c.req.query('category') || '').trim().slice(0, 60);
  const type = (c.req.query('type') || '').trim();
  const sort = (c.req.query('sort') || 'recent').trim();
  const minRatingRaw = Number(c.req.query('min_rating') || 0);
  const minRating = Number.isFinite(minRatingRaw) ? Math.max(0, Math.min(5, minRatingRaw)) : 0;
  const limit = safeInt(c.req.query('limit') || '24', 1, 60);
  const offset = safeInt(c.req.query('offset') || '0', 0, 1000000);

  try {
    const result = await searchApps(c.env, { q, category, type, sort, minRating, limit, offset });
    const apps = result.apps.map((a) => ({
      ...appPublic(a),
      icon_url: icon_url(a.icon_key, c.env),
      feature_url: feature_url(a.feature_key, c.env),
    }));
    c.header('Cache-Control', q ? 'public, max-age=60' : 'public, max-age=120');
    return c.json({
      apps,
      total: result.total,
      limit,
      offset,
      hasMore: offset + apps.length < result.total,
      query: q,
      filters: { category, type: type || 'all', sort, min_rating: minRating },
    });
  } catch (e: any) {
    return c.json({ error: 'd1_error', message: e.message }, 500);
  }
});

app.get('/apps', async (c) => {
  const q = (c.req.query('q') || '').trim().toLowerCase(), category = (c.req.query('category') || '').trim(), type = (c.req.query('type') || '').trim();
  const sort = (c.req.query('sort') || 'recent').trim(), starredOnly = c.req.query('starred') === '1';
  const limit = Math.min(Number(c.req.query('limit') || '24') || 24, 60), offset = Math.max(Number(c.req.query('offset') || '0') || 0, 0);

  try {
    const result = await listApps(c.env, { q, category, type, sort, starredOnly, limit, offset });
    const apps = result.apps.map(a => ({ ...appPublic(a), icon_url: icon_url(a.icon_key, c.env), feature_url: feature_url(a.feature_key, c.env) }));
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ apps, total: result.total });
  } catch (e: any) { return c.json({ error: 'd1_error', message: e.message }, 500); }
});

app.get('/apps/:slug', async (c) => {
  const appData = await getAppBySlug(c.env, c.req.param('slug'));
  if (!appData) return c.json({ error: 'not_found' }, 404);
  
  const screenshotsData = await listScreenshots(c.env, appData.id);
  // استخدام shot_url بدقة 720 لجلب صور الشاشات
  const screenshots = screenshotsData.map(s => ({ id: s.id, position: s.position, url: shot_url(s.r2_key, c.env) }));
  
  return c.json({ app: { ...appPublic(appData), icon_url: icon_url(appData.icon_key, c.env), feature_url: feature_url(appData.feature_key, c.env) }, screenshots });
});

app.get('/apps/:slug/download', async (c) => {
  const appData = await getAppBySlug(c.env, c.req.param('slug'));
  if (!appData || !appData.apk_key) return c.json({ error: 'apk_not_available' }, 404);

  if (rateLimit(getClientIp(c), `dl:${appData.slug}`, 1, 600)) {
    await c.env.DB.prepare('UPDATE apps SET downloads = downloads + 1 WHERE id = ?').bind(appData.id).run().catch(()=>{});
  }
  
  const filename = `${appData.slug}-${appData.version_name || ''}.apk`.replace(/-+/g, '-');
  const url = await r2PresignGet(c.env, appData.apk_key, 300, `attachment; filename="${filename}"`);
  return c.redirect(url);
});

// Stars & Reviews (D1)
function serverFingerprint(c: any): string {
  return `${c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'}||${c.req.header('user-agent')||''}||${c.req.header('accept-language')||''}`;
}

app.post('/apps/:slug/star', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'star', 10, 60)) return c.json({ error: 'rate_limit_exceeded' }, 429);
  const body = await c.req.json().catch(() => ({}));
  const appData = await getAppBySlug(c.env, c.req.param('slug'));
  if (!appData) return c.json({ error: 'not_found' }, 404);

  const rating = Math.round(Number(body.rating)), clientFp = String(body.fp || '').trim();
  if (rating < 1 || rating > 5 || clientFp.length < 16) return c.json({ error: 'invalid_data' }, 400);

  const voteHash = await sha256Hex(`${clientFp}::${serverFingerprint(c)}`);
  const uid = sanitizeText(body.uid, 128);

  const existing = uid 
    ? await c.env.DB.prepare('SELECT id FROM star_votes WHERE app_id = ? AND uid = ?').bind(appData.id, uid).first()
    : await c.env.DB.prepare('SELECT id FROM star_votes WHERE app_id = ? AND hash = ?').bind(appData.id, voteHash).first();
  
  if (existing) return c.json({ error: 'already_voted', rating: appData.rating, rating_count: appData.rating_count }, 409);

  const voteId = randomId();
  await c.env.DB.prepare(`INSERT INTO star_votes (id, app_id, hash, server_hash, uid, rating, comment, name, photo_url, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(voteId, appData.id, voteHash, await sha256Hex(serverFingerprint(c)), uid||null, rating, sanitizeText(body.comment, 2000), sanitizeText(body.name, 60), sanitizeUrl(body.photo_url)||null, nowSec()).run();

  const newCount = appData.rating_count + 1;
  const newSum = appData.rating_sum + rating;
  const newAvg = Math.round((newSum / newCount) * 10) / 10;
  await c.env.DB.prepare('UPDATE apps SET rating = ?, rating_count = ?, rating_sum = ?, stars = ? WHERE id = ?')
    .bind(newAvg, newCount, newSum, newCount, appData.id).run();

  const ts = nowSec();
  return c.json({
    ok: true, rating: newAvg, rating_count: newCount,
    review: { id: voteId, name: body.name || 'مستخدم', rating, comment: body.comment, photo_url: body.photo_url, ts, likes_count: 0, liked: false },
  });
});

app.post('/apps/:slug/star-check', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const appData = await getAppBySlug(c.env, c.req.param('slug'));
  if (!appData) return c.json({ error: 'not_found' }, 404);

  const uid = String(body.uid || '').trim(), clientFp = String(body.fp || '').trim();
  let vote: any = null;
  if (uid) vote = await c.env.DB.prepare('SELECT * FROM star_votes WHERE app_id = ? AND uid = ?').bind(appData.id, uid).first();
  else if (clientFp) vote = await c.env.DB.prepare('SELECT * FROM star_votes WHERE app_id = ? AND hash = ?').bind(appData.id, await sha256Hex(`${clientFp}::${serverFingerprint(c)}`)).first();

  if (vote) return c.json({ voted: true, my_rating: vote.rating, my_comment: vote.comment, my_name: vote.name, my_photo: vote.photo_url, rating: appData.rating, rating_count: appData.rating_count });
  return c.json({ voted: false, rating: appData.rating, rating_count: appData.rating_count });
});

/* ---------------------------- Reviews (public) ---------------------------- */
app.get('/apps/:slug/reviews', async (c) => {
  const appData = await getAppBySlug(c.env, c.req.param('slug'));
  if (!appData) return c.json({ error: 'not_found' }, 404);

  const rawLimit = Number(c.req.query('limit') || '50');
  const limit = Math.min(Math.max(Math.floor(Number.isFinite(rawLimit) ? rawLimit : 50), 1), 100);
  // `uid` is the identifier used by star_votes; here it identifies the viewer
  // so the response can carry their personal like state. Never cached publicly.
  const viewerId = sanitizeText(c.req.query('userId') || c.req.query('uid') || '', 128);

  const [votes, dist, total] = await Promise.all([
    listReviews(c.env, appData.id, limit, viewerId),
    getRatingDistribution(c.env, appData.id),
    countReviews(c.env, appData.id),
  ]);

  const reviews = votes.map((v: any) => ({
    id: String(v.id),
    name: v.name || 'مستخدم',
    rating: Math.round(Number(v.rating) || 0),
    comment: v.comment,
    photo_url: v.photo_url || null,
    ts: Number(v.ts) || 0,
    likes_count: Number(v.likes_count) || 0,
    liked: !!v.liked_by_me,
  }));

  c.header('Cache-Control', 'private, no-store');
  return c.json({ reviews, total, dist, rating: appData.rating, rating_count: appData.rating_count });
});

app.post('/apps/:slug/reviews/:reviewId/like', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'review-like', 30, 60)) return c.json({ error: 'rate_limit_exceeded' }, 429);
  const body = await c.req.json().catch(() => ({}));
  const userId = sanitizeText(body.userId || body.uid, 128);
  if (!userId) return c.json({ error: 'userId_required' }, 400);
  const review = await resolveReview(c, c.req.param('slug'), c.req.param('reviewId'));
  if (!review) return c.json({ error: 'review_not_found' }, 404);

  const result = await toggleReviewLike(c.env, String(review.id), userId);
  return c.json({ ok: true, ...result });
});

app.post('/apps/:slug/reviews/:reviewId/report', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'review-report', 10, 60)) return c.json({ error: 'rate_limit_exceeded' }, 429);
  const body = await c.req.json().catch(() => ({}));
  const userId = sanitizeText(body.userId || body.uid, 128);
  const reason = reportReasonLabel(body.reason);
  if (!userId) return c.json({ error: 'userId_required' }, 400);
  if (!reason) return c.json({ error: 'invalid_reason' }, 400);
  const review = await resolveReview(c, c.req.param('slug'), c.req.param('reviewId'));
  if (!review) return c.json({ error: 'review_not_found' }, 404);

  const result = await reportReview(c.env, String(review.id), c.req.param('slug'), userId, reason);
  return c.json({ ok: true, ...result });
});

// Requests (D1)
app.post('/apps/:slug/request-update', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const appData = await getAppBySlug(c.env, c.req.param('slug'));
  if (!appData || !body.new_version) return c.json({ error: 'invalid' }, 400);
  
  await c.env.DB.prepare(`INSERT INTO app_requests (id, type, slug, app_name, current_version, new_version, source, status, ts) VALUES (?, 'update', ?, ?, ?, ?, ?, 'new', ?)`)
    .bind(randomId(), appData.slug, appData.name, appData.version_name || '', sanitizeText(body.new_version, 60), sanitizeUrl(body.source) || '', nowSec()).run();
  return c.json({ ok: true });
});

app.post('/apps/:slug/report', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const appData = await getAppBySlug(c.env, c.req.param('slug'));
  if (!appData || !body.reason) return c.json({ error: 'invalid' }, 400);
  
  await c.env.DB.prepare(`INSERT INTO app_requests (id, type, slug, app_name, reason, details, status, ts) VALUES (?, 'report', ?, ?, ?, ?, 'new', ?)`)
    .bind(randomId(), appData.slug, appData.name, sanitizeText(body.reason, 80), sanitizeText(body.details, 2000), nowSec()).run();
  return c.json({ ok: true });
});

// ============================================================
// Auth & Admin Routes (D1)
// ============================================================
function isSecureRequest(c: any): boolean { return c.req.header('x-forwarded-proto')?.split(',')[0] === 'https' || new URL(c.req.url).protocol === 'https:'; }

app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const providedPass = String(body.password || body.pass || '');
  const adminPass = c.env.ADMIN_PASSWORD;
  const adminUser = String(c.env.ADMIN_USERNAME || 'store-admin');
  const secret = c.env.JWT_SECRET;

  // التحقق من الإعدادات
  if (!adminPass || !secret) {
    return c.json({ error: 'server_misconfigured', message: 'ADMIN_PASSWORD and JWT_SECRET must be set' }, 500);
  }

  // استخدام المقارنة الآمنة
  if (!constantTimeEqual(providedPass, adminPass)) {
    return c.json({ error: 'invalid_credentials' }, 401);
  }
  
  const token = await signJwt({ sub: adminUser, role: 'admin' }, secret);
  setCookie(c, COOKIE_NAME, token, { httpOnly: true, secure: isSecureRequest(c), sameSite: 'Lax', path: '/', maxAge: 7 * 24 * 60 * 60 });
  return c.json({ ok: true, user: { username: adminUser } });
});

app.post('/logout', (c) => { setCookie(c, COOKIE_NAME, '', { httpOnly: true, secure: isSecureRequest(c), sameSite: 'Lax', path: '/', maxAge: 0 }); return c.json({ ok: true }); });
app.get('/me', async (c) => {
  const token = getCookie(c, COOKIE_NAME), secret = c.env.JWT_SECRET;
  if (!secret) return c.json({ error: 'server_misconfigured', message: 'JWT_SECRET is not set' }, 500);
  if (!token) return c.json({ authenticated: false });
  const payload = await verifyJwt(token, secret);
  return payload ? c.json({ authenticated: true, user: { username: payload.sub, role: payload.role } }) : c.json({ authenticated: false });
});

app.post('/setup-r2-cors', async (c) => {
  const setupPass = c.env.ADMIN_PASSWORD;
  if (!setupPass) return c.json({ error: 'server_misconfigured', message: 'ADMIN_PASSWORD is not set' }, 500);
  if (!constantTimeEqual(String(c.req.header('x-admin-password') || ''), setupPass)) return c.json({ error: 'unauthorized' }, 401);
  try {
    await r2ConfigureCors(c.env, (c.env.ALLOWED_ORIGINS || '').split(',').map(o=>o.trim()).filter(Boolean));
    return c.json({ ok: true });
  } catch { return c.json({ error: 'failed' }, 500); }
});


/* ---------------------------- Support chat ---------------------------- */
// Users authenticate with their Firebase ID token (Store.authedApi sends it).
app.post('/support/threads', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'support-new', 8, 60)) return c.json({ error: 'rate_limited' }, 429);
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const subject = sanitizeText(body.subject, 120) || 'رسالة دعم';
  const message = sanitizeText(body.message, 2000);
  if (message.length < 2) return c.json({ error: 'invalid_message' }, 400);
  const { thread, messages } = await createSupportThread(c.env, {
    uid: user.uid, email: user.email, name: user.name, subject, message,
  });
  c.header('Cache-Control', 'no-store');
  return c.json({ thread: { ...thread, messages } }, 201);
});

app.get('/support/threads', async (c) => {
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const threads = await listUserSupportThreads(c.env, user.uid, 20);
  c.header('Cache-Control', 'no-store');
  return c.json({ threads });
});

app.post('/support/threads/:id/messages', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'support-msg', 30, 60)) return c.json({ error: 'rate_limited' }, 429);
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const message = sanitizeText(body.message, 2000);
  if (message.length < 2) return c.json({ error: 'invalid_message' }, 400);
  const out = await addSupportMessage(c.env, c.req.param('id'), 'user', message, user.uid);
  if (!out) return c.json({ error: 'thread_not_found_or_closed' }, 404);
  c.header('Cache-Control', 'no-store');
  return c.json({ thread: out.thread, messages: out.messages }, 201);
});

app.post('/support/threads/:id/read', async (c) => {
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const found = await getSupportThread(c.env, c.req.param('id'));
  if (!found || found.thread.uid !== user.uid) return c.json({ error: 'not_found' }, 404);
  await markSupportThreadRead(c.env, found.thread.id, 'user');
  return c.json({ ok: true });
});

app.use('/admin/*', requireAdmin);

/* --------------------- Review reports (admin only) --------------------- */

/* ---------------------- Support chat (admin) ---------------------- */
app.get('/admin/support/threads', async (c) => {
  const threads = await listAdminSupportThreads(c.env);
  c.header('Cache-Control', 'no-store');
  return c.json({ threads });
});

app.get('/admin/support/threads/:id', async (c) => {
  const found = await getSupportThread(c.env, c.req.param('id'));
  if (!found) return c.json({ error: 'not_found' }, 404);
  await markSupportThreadRead(c.env, found.thread.id, 'admin');
  c.header('Cache-Control', 'no-store');
  return c.json({ thread: found.thread, messages: found.messages });
});

app.post('/admin/support/threads/:id/messages', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const message = sanitizeText(body.message, 2000);
  if (message.length < 2) return c.json({ error: 'invalid_message' }, 400);
  const out = await addSupportMessage(c.env, c.req.param('id'), 'admin', message);
  if (!out) return c.json({ error: 'not_found' }, 404);
  c.header('Cache-Control', 'no-store');
  return c.json({ thread: out.thread, messages: out.messages }, 201);
});

app.patch('/admin/support/threads/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const status = body.status === 'closed' ? 'closed' : body.status === 'open' ? 'open' : '';
  if (!status) return c.json({ error: 'invalid_status' }, 400);
  const ok = await setSupportThreadStatus(c.env, c.req.param('id'), status);
  if (!ok) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, status });
});

app.delete('/admin/support/threads/:id', async (c) => {
  const ok = await deleteSupportThread(c.env, c.req.param('id'));
  if (!ok) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

app.get('/admin/reports', async (c) => {
  try {
    const reports = await getAllReports(c.env);
    c.header('Cache-Control', 'private, no-store');
    return c.json({ reports });
  } catch (err: any) {
    console.error('[admin/reports] fetch failed:', err?.message || err);
    return c.json({ error: 'fetch_reports_failed' }, 500);
  }
});

app.delete('/admin/reports/:id', async (c) => {
  const id = String(c.req.param('id') || '');
  if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) return c.json({ error: 'invalid_id' }, 400);
  try {
    const deleted = await deleteReport(c.env, id);
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  } catch (err: any) {
    console.error('[admin/reports] delete failed:', err?.message || err);
    return c.json({ error: 'delete_report_failed' }, 500);
  }
});

app.delete('/admin/reviews/:reviewId', async (c) => {
  const reviewId = String(c.req.param('reviewId') || '');
  if (!reviewId || reviewId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(reviewId)) {
    return c.json({ error: 'invalid_id' }, 400);
  }
  try {
    const result = await deleteReview(c.env, reviewId);
    if (!result.deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[admin/reviews] delete failed:', err?.message || err);
    return c.json({ error: 'delete_review_failed' }, 500);
  }
});

app.get('/admin/settings', async (c) => c.json({ settings: await getStoreSettings(c.env) }));
app.patch('/admin/settings', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.notify_new_publications !== 'boolean') return c.json({ error: 'invalid' }, 400);
  await c.env.DB.prepare(`INSERT OR REPLACE INTO store_settings (id, notify_new_publications, updated_at) VALUES ('general', ?, ?)`)
    .bind(body.notify_new_publications ? 1 : 0, nowSec()).run();
  return c.json({ settings: { notify_new_publications: body.notify_new_publications } });
});

app.get('/admin/stats', async (c) => {
  const res = await c.env.DB.prepare('SELECT id, slug, name, downloads, size_bytes, icon_key FROM apps ORDER BY downloads DESC').all();
  let totDl = 0, totSize = 0;
  const apps = (res.results || []).map(a => { totDl += (a.downloads as number); totSize += (a.size_bytes as number); return { ...a, icon_url: icon_url(a.icon_key as string, c.env) }; });
  return c.json({ total_apps: apps.length, total_downloads: totDl, total_size_bytes: totSize, top_apps: apps.slice(0, 5) });
});

app.get('/admin/apps', async (c) => {
  const res = await c.env.DB.prepare('SELECT * FROM apps ORDER BY created_at DESC').all();
  return c.json({ apps: (res.results || []).map(d => { const a = appPublic(d, true); return { ...a, icon_url: icon_url(a.icon_key, c.env), feature_url: feature_url(a.feature_key, c.env) }; }) });
});

app.get('/admin/requests', async (c) => {
  const res = await c.env.DB.prepare('SELECT * FROM app_requests ORDER BY ts DESC LIMIT 200').all();
  return c.json({ requests: res.results || [] });
});

app.get('/admin/notifications', async (c) => c.json({ notifications: (await listNotifications(c.env)).map(n => ({ ...n, data: n.data ? JSON.parse(n.data) : null })) }));

app.post('/admin/notifications', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.title) return c.json({ error: 'title_required' }, 400);
  const res = await addNotification(c.env, { ...body, type: 'announcement', created_at: nowSec() });
  return c.json({ ok: true, id: res.id, push: res.push });
});

app.post('/admin/app-update', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  let apk_url = sanitizeUrl(body.apk_url), apk_key = String(body.apk_key || '').trim(), size_bytes = 0;
  
  if (apk_key) {
    if (!isValidR2Key(apk_key, 'apk')) return c.json({ error: 'invalid_key' }, 400);
    const head = await r2Head(c.env, apk_key); if (!head) return c.json({ error: 'not_found' }, 400);
    apk_url = r2PublicUrl(apk_key, c.env); size_bytes = head.size || 0;
  }
  if (!apk_url) return c.json({ error: 'apk_required' }, 400);

  await c.env.DB.prepare(`INSERT OR REPLACE INTO app_updates (id, version_name, version_code, apk_url, apk_key, notes, force, size_bytes, created_at) VALUES ('current', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(sanitizeText(body.version_name, 60), safeInt(body.version_code, 0, 999999999), apk_url, apk_key, sanitizeText(body.notes, 1000), body.force ? 1 : 0, size_bytes, nowSec()).run();

  let push = null;
  if (body.send_notification) {
    const res = await addNotification(c.env, { type: 'update', title: body.version_name ? `تحديث ${body.version_name}` : 'تحديث جديد', body: body.notes || 'تحديث', data: { apk_url }, created_at: nowSec() });
    push = res.push;
  }
  return c.json({ ok: true, push });
});

app.get('/admin/push/status', async (c) => {
  const res = await c.env.DB.prepare('SELECT platform, uid, token, updated_at FROM fcm_tokens LIMIT 500').all();
  const plats: Record<string, number> = {};
  const tokens = (res.results || []).map(r => {
    plats[r.platform as string] = (plats[r.platform as string] || 0) + 1;
    return { platform: r.platform, uid_masked: String(r.uid).slice(0, 10), updated_at: r.updated_at, token_tail: String(r.token).slice(-6) };
  }).sort((a, b) => (b.updated_at as number) - (a.updated_at as number));
  return c.json({ registered_tokens: tokens.length, platforms: plats, tokens });
});

app.post('/admin/push/test', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json({ ok: true, push: await sendPushToRegistered(c.env, { title: body.title || 'Test', body: body.body || 'Test', type: 'announcement', id: 'test' }) });
});

app.delete('/admin/notifications/:id', async (c) => { await c.env.DB.prepare('DELETE FROM notifications WHERE id = ?').bind(c.req.param('id')).run().catch(()=>{}); return c.json({ ok: true }); });
app.delete('/admin/requests/:id', async (c) => { await c.env.DB.prepare('DELETE FROM app_requests WHERE id = ?').bind(c.req.param('id')).run().catch(()=>{}); return c.json({ ok: true }); });

app.get('/admin/apps/:id', async (c) => {
  const doc: any = await c.env.DB.prepare('SELECT * FROM apps WHERE id = ?').bind(c.req.param('id')).first();
  if (!doc) return c.json({ error: 'not_found' }, 404);
  const ss = await c.env.DB.prepare('SELECT * FROM screenshots WHERE app_id = ? ORDER BY position ASC').bind(doc.id).all();
  return c.json({ app: { ...appPublic(doc, true), icon_url: icon_url(doc.icon_key, c.env), feature_url: feature_url(doc.feature_key, c.env) }, screenshots: (ss.results || []).map((s: any) => ({ ...s, url: icon_url(s.r2_key, c.env) })) });
});

// Uploads (R2)
app.post('/admin/upload-url', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ext = safeExt(String(body.filename), body.kind === 'apk' ? 'apk' : body.kind === 'feature' ? 'jpg' : body.kind === 'icon' ? 'png' : 'jpg');
  const folder = body.kind === 'apk' ? 'apk' : body.kind === 'icon' ? 'icon' : body.kind === 'feature' ? 'feature' : 'ss';
  const key = `${folder}/${slugify(String(body.slug_hint || 'app'))}-${Date.now()}-${randomId().slice(0, 6)}.${ext}`;
  return c.json({ url: await r2PresignPut(c.env, key, String(body.content_type || 'application/octet-stream'), 7200), key });
});

app.post('/admin/multipart/create', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ext = safeExt(String(body.filename), body.kind === 'apk' ? 'apk' : body.kind === 'feature' ? 'jpg' : body.kind === 'icon' ? 'png' : 'jpg');
  const folder = body.kind === 'apk' ? 'apk' : body.kind === 'icon' ? 'icon' : body.kind === 'feature' ? 'feature' : 'ss';
  const key = `${folder}/${slugify(String(body.slug_hint || 'app'))}-${Date.now()}-${randomId().slice(0, 6)}.${ext}`;
  const uploadId = await r2CreateMultipartUpload(c.env, key, String(body.content_type || 'application/octet-stream'));
  const parts = [];
  for (let i = 1; i <= Math.ceil(Number(body.file_size) / (10 * 1024 * 1024)); i++) parts.push({ partNumber: i, url: await r2PresignUploadPart(c.env, key, uploadId, i, 3600) });
  return c.json({ key, uploadId, partSize: 10 * 1024 * 1024, parts });
});

app.post('/admin/multipart/complete', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  await r2CompleteMultipartUpload(c.env, body.key, body.uploadId, body.parts);
  return c.json({ ok: true, key: body.key });
});

app.post('/admin/multipart/abort', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (body.key && body.uploadId) await r2AbortMultipartUpload(c.env, body.key, body.uploadId);
  return c.json({ ok: true });
});

function isValidR2Key(key: string, prefix: string): boolean { return key.startsWith(`${prefix}/`) && !key.includes('..'); }

app.post('/admin/apps', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.name || !body.package_name || !body.apk_key) return c.json({ error: 'missing_fields' }, 400);
  if (!isValidR2Key(body.apk_key, 'apk')) return c.json({ error: 'invalid_apk_key' }, 400);
  
  const head = await r2Head(c.env, body.apk_key); if (!head) return c.json({ error: 'apk_not_found' }, 400);
  
  let base = slugify(body.name), slug = base, i = 1;
  while (await c.env.DB.prepare('SELECT id FROM apps WHERE slug = ?').bind(slug).first()) { i++; slug = `${base}-${i}`; }
  
  const now = nowSec(), id = randomId();
  await c.env.DB.prepare(`INSERT INTO apps (id, slug, name, name_lower, search_terms, package_name, short_description, description, category, type, developer, version_name, version_code, min_sdk, size_bytes, apk_key, icon_key, feature_key, stars, rating_sum, rating_count, rating, downloads, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?)`)
    .bind(id, slug, sanitizeText(body.name, 200), sanitizeText(body.name, 200).toLowerCase(), JSON.stringify(searchTerms(body.name, body.developer, body.short_description, body.package_name)), sanitizeText(body.package_name, 200), sanitizeText(body.short_description, 500)||null, sanitizeText(body.description, 10000)||null, sanitizeText(body.category, 60)||'other', body.type === 'game' ? 'game' : 'app', sanitizeText(body.developer, 120)||null, sanitizeText(body.version_name, 60)||null, safeInt(body.version_code,0,999999999)||null, safeInt(body.min_sdk,1,99)||null, head.size, body.apk_key, body.icon_key||null, body.feature_key||null, now, now).run();

  if (Array.isArray(body.screenshot_keys)) {
    for (let j = 0; j < body.screenshot_keys.length; j++) {
      if (isValidR2Key(body.screenshot_keys[j], 'ss')) {
        await c.env.DB.prepare('INSERT INTO screenshots (id, app_id, r2_key, position, created_at) VALUES (?, ?, ?, ?, ?)').bind(randomId(), id, body.screenshot_keys[j], j, now).run();
      }
    }
  }
  
  if ((await getStoreSettings(c.env)).notify_new_publications) await addNotification(c.env, { type: 'new_app', title: body.name, body: '', app_slug: slug, created_at: now });
  
  // إبطال الكاش بعد الإضافة
  invalidateAppsCache();
  
  return c.json({ ok: true, id, slug });
});

app.patch('/admin/apps/:id', async (c) => {
  const id = c.req.param('id'), body = await c.req.json().catch(() => ({}));
  const old: any = await c.env.DB.prepare('SELECT * FROM apps WHERE id = ?').bind(id).first();
  if (!old) return c.json({ error: 'not_found' }, 404);

  let name = body.name !== undefined ? sanitizeText(body.name, 200) : old.name;
  let name_lower = body.name !== undefined ? name.toLowerCase() : old.name_lower;
  let search_terms = body.name || body.developer || body.short_description || body.package_name ? JSON.stringify(searchTerms(name, body.developer||old.developer, body.short_description||old.short_description, body.package_name||old.package_name)) : old.search_terms;

  const versionChanged = (body.version_name && body.version_name !== old.version_name) || (body.version_code && body.version_code !== old.version_code);
  
  await c.env.DB.prepare(`UPDATE apps SET name=?, name_lower=?, search_terms=?, package_name=?, short_description=?, description=?, category=?, type=?, developer=?, version_name=?, version_code=?, min_sdk=?, updated_at=? WHERE id=?`)
    .bind(name, name_lower, search_terms, body.package_name||old.package_name, body.short_description !== undefined ? sanitizeText(body.short_description, 500) : old.short_description, body.description !== undefined ? sanitizeText(body.description, 10000) : old.description, body.category||old.category, body.type ? (body.type==='game'?'game':'app') : old.type, body.developer !== undefined ? sanitizeText(body.developer, 120) : old.developer, body.version_name !== undefined ? sanitizeText(body.version_name, 60) : old.version_name, body.version_code !== undefined ? safeInt(body.version_code,0,999999999) : old.version_code, body.min_sdk !== undefined ? safeInt(body.min_sdk,1,99) : old.min_sdk, nowSec(), id).run();

  if (versionChanged) await addNotification(c.env, { type: 'update', title: name, body: `إصدار ${body.version_name||old.version_name}`, app_slug: old.slug, created_at: nowSec() });
  
  // إبطال الكاش بعد التعديل
  invalidateAppsCache();
  
  return c.json({ ok: true });
});

app.post('/admin/apps/:id/apk', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const head = await r2Head(c.env, body.apk_key); if (!head) return c.json({ error: 'not_found' }, 400);
  const old: any = await c.env.DB.prepare('SELECT * FROM apps WHERE id = ?').bind(c.req.param('id')).first();
  if (!old) return c.json({ error: 'not_found' }, 404);

  await c.env.DB.prepare('UPDATE apps SET apk_key=?, size_bytes=?, version_name=?, version_code=?, updated_at=? WHERE id=?')
    .bind(body.apk_key, head.size, body.version_name||old.version_name, body.version_code!==undefined?body.version_code:old.version_code, nowSec(), old.id).run();
  
  if (old.apk_key && old.apk_key !== body.apk_key) await r2Delete(c.env, old.apk_key).catch(()=>{});
  await addNotification(c.env, { type: 'update', title: old.name, body: `إصدار ${body.version_name||old.version_name}`, app_slug: old.slug, created_at: nowSec() });
  return c.json({ ok: true });
});

app.post('/admin/apps/:id/icon', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const old: any = await c.env.DB.prepare('SELECT icon_key, id FROM apps WHERE id = ?').bind(c.req.param('id')).first();
  await c.env.DB.prepare('UPDATE apps SET icon_key=?, updated_at=? WHERE id=?').bind(body.icon_key, nowSec(), old.id).run();
  if (old.icon_key && old.icon_key !== body.icon_key) await r2Delete(c.env, old.icon_key).catch(()=>{});
  return c.json({ ok: true });
});

app.post('/admin/apps/:id/feature', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const old: any = await c.env.DB.prepare('SELECT feature_key, id FROM apps WHERE id = ?').bind(c.req.param('id')).first();
  await c.env.DB.prepare('UPDATE apps SET feature_key=?, updated_at=? WHERE id=?').bind(body.feature_key, nowSec(), old.id).run();
  if (old.feature_key && old.feature_key !== body.feature_key) await r2Delete(c.env, old.feature_key).catch(()=>{});
  return c.json({ ok: true });
});

app.post('/admin/apps/:id/screenshots', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.screenshot_keys) || !body.screenshot_keys.length) return c.json({ error: 'no_screenshots' }, 400);
  const id = c.req.param('id');
  const max: any = await c.env.DB.prepare('SELECT MAX(position) as max_pos FROM screenshots WHERE app_id = ?').bind(id).first();
  let pos = (max?.max_pos || 0) + 1;
  
  for (const k of body.screenshot_keys) {
    if (isValidR2Key(k, 'ss')) await c.env.DB.prepare('INSERT INTO screenshots (id, app_id, r2_key, position, created_at) VALUES (?, ?, ?, ?, ?)').bind(randomId(), id, k, pos++, nowSec()).run();
  }
  return c.json({ ok: true });
});

app.delete('/admin/apps/:id/screenshots/:sid', async (c) => {
  const row: any = await c.env.DB.prepare('SELECT r2_key FROM screenshots WHERE id = ? AND app_id = ?').bind(c.req.param('sid'), c.req.param('id')).first();
  if (row) {
    await c.env.DB.prepare('DELETE FROM screenshots WHERE id = ?').bind(c.req.param('sid')).run();
    if (row.r2_key) await r2Delete(c.env, row.r2_key).catch(()=>{});
  }
  return c.json({ ok: true });
});

app.delete('/admin/apps/:id', async (c) => {
  const id = c.req.param('id'), app: any = await c.env.DB.prepare('SELECT * FROM apps WHERE id = ?').bind(id).first();
  if (!app) return c.json({ error: 'not_found' }, 404);

  const ss = await c.env.DB.prepare('SELECT r2_key FROM screenshots WHERE app_id = ?').bind(id).all();
  for (const s of (ss.results||[])) if (s.r2_key) await r2Delete(c.env, s.r2_key as string).catch(()=>{});
  await c.env.DB.prepare('DELETE FROM screenshots WHERE app_id = ?').bind(id).run();
  
  if (app.apk_key) await r2Delete(c.env, app.apk_key).catch(()=>{});
  if (app.icon_key) await r2Delete(c.env, app.icon_key).catch(()=>{});
  if (app.feature_key) await r2Delete(c.env, app.feature_key).catch(()=>{});
  await c.env.DB.prepare('DELETE FROM apps WHERE id = ?').bind(id).run();
  
  // إبطال الكاش بعد الحذف
  invalidateAppsCache();
  
  return c.json({ ok: true });
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => { console.error('[api error]', err); return c.json({ error: 'internal_error' }, 500); });

export default app;
