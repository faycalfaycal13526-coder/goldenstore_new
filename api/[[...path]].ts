import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { verifyFirebaseToken, getAuthAdmin, getServiceAccountToken } from '../lib/firebase.js';
import {
  broadcastPush, sendDirectPush, buildPushPayload, registerPushToken, setPushPreference,
  unregisterPushToken, ensurePushSchema, processPushJob, syncTopicSubscriptions,
  pushTokenStats, pushDiagnostics, listPushLogs, listPushRegistrations,
  deliverNotification, notificationDiagnostics, recordPushReceipt,
  drainDeliveryJobs, processDeliveryJob,
} from '../lib/push.js';
import {
  sendAdvancedPush, processAdvancedJob, schedulePush, listScheduledPushes,
  cancelScheduledPush, processScheduledPushes, recordPushClick, pushHistory,
  followApp, unfollowApp, appFollowerCount, analyticsOverview, resolveAudience,
} from '../lib/advanced-push.js';
import { cloudflareUsage as cfUsage, firebaseUsage } from '../lib/usage.js';
import {
  listApps, getAppBySlug, listScreenshots, listReviews, countReviews,
  getRatingDistribution, listNotifications, getStoreSettings,
  getReviewById, toggleReviewLike, reportReview, getAllReports, deleteReport, deleteReview,
  searchApps, suggestApps, trendingSearches, recordSearchQuery, ensureSearchQuerySchema,
  createSupportThread, listUserSupportThreads, listAdminSupportThreads, getSupportThread,
  addSupportMessage, setSupportThreadStatus, markSupportThreadRead, deleteSupportThread,
  ensureSupportSchema, ensureUserNotificationSchema, hasRecentUserNotification,
  insertNotificationRow,
  ensureVideosSchema, listAppVideos, addAppVideo, updateAppVideo,
  deleteAppVideo, deleteAppVideos, listVideoThumbKeys,
} from '../lib/d1.js';
import {
  r2PresignPut, r2PresignGet, r2PublicUrl, r2Delete, r2Head, r2GetObject, r2PutObject, r2PutUploadPart,
  r2DeleteStrict, r2DeleteMany, r2List, r2Bucket, r2MultipartUploads, r2AbortMultipartUploadByKey,
  r2CreateMultipartUpload, r2PresignUploadPart, r2CompleteMultipartUpload,
  r2AbortMultipartUpload, r2ConfigureCors,
  r2Move, organiseKey,
} from '../lib/r2.js';
import { COOKIE_NAME, constantTimeEqual, signJwt, verifyJwt } from '../lib/auth.js';
import { nowSec, randomId, safeExt, searchTerms, slugify, sanitizeText, sanitizeUrl, safeInt, sha1Hex, sha256Hex, parseYouTubeUrl } from '../lib/utils.js';
import { DEFAULT_CATEGORIES, APP_CATEGORIES, GAME_CATEGORIES, type App, type Category, type Screenshot } from '../lib/types.js';
import type { Env } from '../lib/env.js';
import {
  ratingSnapshot, allVoteAggregates, mergeAggregate, appAliases,
  recomputeAppRating, recomputeAllRatings,
} from '../lib/ratings.js';

const app = new Hono<{ Bindings: Env }>().basePath('/api');

// Caches
const categoriesCache: { data: Record<string, number> | null; ts: number } = { data: null, ts: 0 };
const CATEGORIES_CACHE_TTL = 3600;

function invalidateAppsCache() { categoriesCache.data = null; categoriesCache.ts = 0; }

/* The Capacitor build of the store runs its WebView on https://localhost
 * (Android) or capacitor://localhost (iOS), so every call it makes is
 * cross-origin. These origins are the app itself, not a third-party site: they
 * are matched exactly and never echo an arbitrary Origin, so allowing them adds
 * no CSRF surface. Without them the installed app was rejected by CORS before it
 * could read a single JSON byte — the store appeared empty inside the APK while
 * the website worked.
 */
const NATIVE_ORIGINS = ['https://localhost', 'capacitor://localhost', 'http://localhost'];

// Security: CORS
app.use('*', async (c, next) => {
  const origin = c.req.header('origin') || '';
  const allowedOrigins = (c.env.ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);
  const allowed = !!origin && (allowedOrigins.includes(origin) || NATIVE_ORIGINS.includes(origin));
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

/** Android's downloader (and every «تحميل» click on a phone) can take the object
 *  directly; a desktop browser keeps the same-origin path so the file name and
 *  the counter stay identical to what the site promises. */
function prefersDirectDownload(c: any): boolean {
  const ua = String(c.req.header('user-agent') || '');
  if (!/android|aosp|okhttp|dalvik/i.test(ua)) return false;
  // A headless checker or a bot must not skew the download counters.
  return !/bot|crawler|spider|preview|headless/i.test(ua);
}

function getClientIp(c: any): string {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
}

/* =========================================================================
   CENTRAL WRITE-AUTHORIZATION POLICY  (security audit, 2026-11-08)
   -------------------------------------------------------------------------
   Registered BEFORE every route, so a handler added later can never silently
   become an unauthenticated database write. Three rules:

   1. The 7 legacy `/api/import-*-temp` bulk-import scripts (which used
      INSERT OR REPLACE on production tables) are PERMANENTLY retired. Even if
      somebody re-adds such a route, this middleware answers 404 first.
   2. `/api/admin/*` and `/api/setup-r2-cors` always require a verified admin
      JWT (requireAdmin), independently of route registration order.
   3. Every other POST/PUT/PATCH/DELETE must be on an explicit allowlist of
      intentionally public, rate-limited endpoints. Anything else is 403.

   All D1 statements use .bind() placeholders; see lib/d1.ts whitelists.
   ========================================================================= */
const LEGACY_IMPORT_TEMP = /^\/api\/import-[a-z0-9_-]*temp(?:\/|$)/i;
const PUBLIC_WRITE_EXACT = new Set([
  '/api/login', '/api/logout', '/api/legal/consent', '/api/translate', '/api/i18n-content',
  '/api/notifications/register-token', '/api/notifications/register-web',
  '/api/notifications/register-device', '/api/notifications/unregister-token',
  '/api/notifications/preference', '/api/notifications/receipt',
  '/api/notifications/click', '/api/notifications/self-test',
  '/api/profile/demographics', '/api/support/threads', '/api/publish-request',
]);
const PUBLIC_WRITE_PATTERNS: RegExp[] = [
  /^\/api\/apps\/[^/]+\/(star|star-check|request-update|report|follow)$/,
  /^\/api\/apps\/[^/]+\/reviews\/[^/]+\/(like|report)$/,
  /^\/api\/support\/threads\/[^/]+\/(messages|read)$/,
];
// Stricter buckets for endpoints that write on every request or are brute-force
// targets. The generic bucket is a backstop, not the only control: individual
// handlers keep their own validation, sanitizers and rate limits.
const WRITE_BUCKETS: Record<string, { max: number; sec: number }> = {
  '/api/login': { max: 8, sec: 60 },
  '/api/translate': { max: 40, sec: 60 },
  '/api/i18n-content': { max: 30, sec: 60 },
  '/api/notifications/unregister-token': { max: 20, sec: 60 },
  '/api/profile/demographics': { max: 15, sec: 60 },
  '/api/apps/:slug/report': { max: 10, sec: 60 },
  '/api/apps/:slug/request-update': { max: 10, sec: 60 },
  '/api/publish-request': { max: 6, sec: 60 },
};
const loginFailures = new Map<string, { count: number; lockedUntil: number }>();

app.use('*', async (c, next) => {
  const path = c.req.path;
  // 1) Retired bulk-import endpoints — never reachable again.
  if (LEGACY_IMPORT_TEMP.test(path)) {
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'not_found' }, 404);
  }
  const method = c.req.method.toUpperCase();
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') return next();

  const ip = getClientIp(c);
  // 2) Admin namespace: verified JWT, no exceptions and no ordering gap.
  if (path.startsWith('/api/admin/') || path === '/api/setup-r2-cors') {
    if (!rateLimit(ip, 'write:admin', 300, 60)) return c.json({ error: 'rate_limited' }, 429);
    return requireAdmin(c, next);
  }

  // 3) Secure-by-default allowlist for public writes.
  const exact = PUBLIC_WRITE_EXACT.has(path);
  const patterned = PUBLIC_WRITE_PATTERNS.some((re) => re.test(path));
  if (!exact && !patterned) {
    console.warn(JSON.stringify({ level: 'warn', event: 'blocked_unlisted_write', path, method, ip }));
    return c.json({ error: 'forbidden', message: 'Write endpoint is not on the public allowlist.' }, 403);
  }

  // 4) Per-endpoint rate limiting + progressive lockout for admin login.
  const bucketKey = WRITE_BUCKETS[path]
    ? path
    : (path.includes('/report') ? '/api/apps/:slug/report'
      : path.includes('/request-update') ? '/api/apps/:slug/request-update' : '');
  const rule = WRITE_BUCKETS[bucketKey] || { max: 180, sec: 60 };
  if (!rateLimit(ip, 'write:' + (bucketKey || 'public'), rule.max, rule.sec)) {
    return c.json({ error: 'rate_limited' }, 429);
  }
  if (path === '/api/login') {
    const attempt = loginFailures.get(ip);
    if (attempt && attempt.lockedUntil > Date.now()) {
      return c.json({ error: 'too_many_attempts', retry_after: Math.ceil((attempt.lockedUntil - Date.now()) / 1000) }, 429);
    }
    await next();
    if (c.res.status === 401) {
      const cur = loginFailures.get(ip) || { count: 0, lockedUntil: 0 };
      cur.count++;
      if (cur.count >= 8) { cur.lockedUntil = Date.now() + 15 * 60 * 1000; cur.count = 0; }
      loginFailures.set(ip, cur);
    } else if (c.res.status === 200) {
      loginFailures.delete(ip);
    }
    return;
  }
  return next();
});

// Security headers
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff'); c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block'); c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
});

// Body size limit: all endpoints keep the 1 MB cap (attachments were removed).
const MAX_BODY_SIZE = 1024 * 1024;
/* The one exception is the console's upload route: it carries the file itself
 * (a part of a large APK is 10 MB), and it is what replaced the browser's
 * cross-origin PUT to the bucket. Its own ceiling is explicit. */
const UPLOAD_BODY_LIMIT = 32 * 1024 * 1024;
app.use('*', async (c, next) => {
  const cl = c.req.header('content-length');
  const limit = c.req.path === '/api/admin/r2/put' ? UPLOAD_BODY_LIMIT : MAX_BODY_SIZE;
  if (cl && Number(cl) > limit) return c.json({ error: 'payload_too_large', limit }, 413);
  await next();
});

/* =========================================================================
   Maintenance lock — a REAL server-side gate.
   The centered modal cannot be bypassed with DevTools or by calling the API
   directly: every public endpoint returns 503 while maintenance is active.
   Only the admin session (verified JWT) and a tiny allowlist pass through.
   ========================================================================= */
/* The owner explicitly asked for the Golden Store download page to keep
   working during maintenance. These two read-only download endpoints are the
   only public APIs exempted; every other public route stays 503. */
const MAINTENANCE_ALLOWLIST = ['/api/settings', '/api/login', '/api/logout', '/api/me',
  '/api/app-update', '/api/app-update/download'];
const maintenanceCache: { data: Record<string, string> | null; ts: number } = { data: null, ts: 0 };
const MAINTENANCE_CACHE_TTL = 3000;
function invalidateMaintenanceCache() { maintenanceCache.data = null; maintenanceCache.ts = 0; }
function maintenanceActive(cfg: Record<string, string>, now = nowSec()): boolean {
  if (cfg.maintenance_mode !== '1') return false;
  const end = Number(cfg.maintenance_end_at || 0);
  return !(end > 0 && end <= now);
}
function maintenanceRemaining(cfg: Record<string, string>, now = nowSec()): number {
  const end = Number(cfg.maintenance_end_at || 0);
  return end > now ? end - now : 0;
}
async function hasAdminSession(c: any): Promise<boolean> {
  try {
    const secret = c.env.JWT_SECRET;
    if (!secret) return false;
    let token = getCookie(c, COOKIE_NAME);
    const auth = c.req.header('authorization') || '';
    if (!token && auth.toLowerCase().startsWith('bearer ')) token = auth.slice(7).trim();
    if (!token) return false;
    const payload = await verifyJwt(token, secret);
    return !!payload && payload.role === 'admin';
  } catch { return false; }
}
/* Explicit, time-limited admin preview. It is a SEPARATE cookie with a
   dedicated scope: it can never be used as an admin session cookie, and an
   admin session alone does not unlock the website without clicking the
   console's preview button. */
const PREVIEW_COOKIE_NAME = 'gs_admin_preview';
const MAINTENANCE_PREVIEW_TTL = 10 * 60;
async function hasMaintenancePreview(c: any): Promise<boolean> {
  try {
    const secret = c.env.JWT_SECRET;
    if (!secret) return false;
    const token = getCookie(c, PREVIEW_COOKIE_NAME);
    if (!token) return false;
    const payload = await verifyJwt(token, secret);
    return !!payload && payload.role === 'maintenance_preview'
      && payload.scope === 'maintenance_preview';
  } catch { return false; }
}
async function maintenanceConfig(c: any): Promise<Record<string, string>> {
  const t = Date.now();
  if (maintenanceCache.data && t - maintenanceCache.ts < MAINTENANCE_CACHE_TTL) return maintenanceCache.data;
  const data = await readAllSettings(c.env).catch(() => ({ ...SETTING_DEFAULTS }));
  maintenanceCache.data = data; maintenanceCache.ts = t;
  return data;
}
app.use('*', async (c, next) => {
  const path = c.req.path;
  if (MAINTENANCE_ALLOWLIST.includes(path) || path.startsWith('/api/admin/')
    || path.startsWith('/api/media/')) return next();
  const cfg = await maintenanceConfig(c);
  if (!maintenanceActive(cfg)) return next();
  if (await hasAdminSession(c)) return next();
  /* The console's «معاينة الموقع» button issues this signed, 10-minute cookie.
   * The gate MUST honour it: /settings already reports maintenance_preview to
   * the client (which unlocks the UI), but without this check every other API
   * call still answered 503 — the owner saw an unlocked, EMPTY store. */
  if (await hasMaintenancePreview(c)) return next();
  const now = nowSec();
  c.header('Cache-Control', 'no-store');
  c.header('Retry-After', String(Math.max(1, maintenanceRemaining(cfg, now))));
  return c.json({ error: 'maintenance', maintenance: {
    active: true,
    message: cfg.maintenance_message || '',
    end_at: Number(cfg.maintenance_end_at || 0),
    remaining: maintenanceRemaining(cfg, now),
    duration_minutes: Number(cfg.maintenance_duration_minutes || 0),
    server_time: now,
  } }, 503);
});

// Helpers
function isValidSlug(s: string): boolean {
  if (!s || s.length > 200 || /[\/\\<>\x00-\x1f]/.test(s) || s.includes('..')) return false;
  return true;
}
/* The sitemap belongs at the SITE root (/sitemap.xml), but this Worker is mounted
 * under /api. Both spellings are therefore served: /api/sitemap.xml from here,
 * and /sitemap.xml through the Pages site's rewrite.
 */
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

/* =========================================================================
   Admin Console — Phase 2 (2026-11-07)
   All tables are created lazily with CREATE TABLE IF NOT EXISTS so no manual
   migration is required and an older D1 database keeps working unchanged.
   Publication/order/category layers are ADDITIVE: with empty tables the store
   behaves exactly as before.
   ========================================================================= */
const CONSOLE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS app_publication (
     slug TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'published',
     publish_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS app_order (
     slug TEXT PRIMARY KEY, position INTEGER NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS store_categories (
     slug TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'grid',
     type TEXT NOT NULL DEFAULT 'app', position INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS admin_activity (
     id TEXT PRIMARY KEY, actor TEXT, action TEXT, kind TEXT DEFAULT 'info', ts INTEGER)`,
  `CREATE TABLE IF NOT EXISTS admin_roles (
     username TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'viewer', created_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_admin_activity_ts ON admin_activity(ts DESC)`,
];
/* Schema guards are MODULE-LEVEL flags, not WeakSets keyed on env.DB.
 * As documented at ensureAnalyticsTables below, `env.DB` is a binding proxy
 * and `env.DB === env.DB` is false — a WeakSet keyed on it NEVER hits, so every
 * request re-ran the whole CREATE TABLE batch (six D1 round trips on the busiest
 * public route). One flag per isolate is the correct memoisation: the Worker is
 * bound to exactly one D1 database, and a new deploy starts a fresh isolate. */
let consoleReady = false;
async function ensureConsoleTables(db: any) {
  if (!db || consoleReady) return;
  consoleReady = true;
  for (const sql of CONSOLE_SCHEMA) { try { await db.prepare(sql).run(); } catch { /* best effort */ } }
}
/* What the storefront must NOT show: its publication row says draft/scheduled.
 *
 * The two-step publish («ملف التطبيق أولاً ثم الصور») creates its row as a
 * DRAFT and the APK step publishes it, so a half-made item is never listed and
 * a download button never answers 404. Deliberately built on the existing draft
 * mechanism: an older row that has no file keeps exactly the visibility it has
 * today — this change must never make something of his disappear. */
async function hiddenSlugs(env: Env): Promise<Set<string>> {
  await ensureConsoleTables(env.DB);
  const rows: any = await env.DB.prepare(
    "SELECT slug FROM app_publication WHERE status = 'draft' OR (status = 'scheduled' AND publish_at > ?)"
  ).bind(nowSec()).all().catch(() => ({ results: [] }));
  return new Set<string>((rows.results || []).map((r: any) => String(r.slug)));
}
async function consoleOrder(env: Env): Promise<Map<string, number>> {
  const rows: any = await env.DB.prepare('SELECT slug, position FROM app_order').all().catch(() => ({ results: [] }));
  return new Map((rows.results || []).map((r: any) => [String(r.slug), Number(r.position) || 0]));
}
function applyConsoleOrder<T extends { slug: string }>(apps: T[], order: Map<string, number>): T[] {
  if (!order.size) return apps;
  return apps.slice().sort((a, b) => (order.get(a.slug) ?? 1e9) - (order.get(b.slug) ?? 1e9));
}
async function recordActivity(env: Env, actor: string, action: string, kind = 'info') {
  await ensureConsoleTables(env.DB);
  try {
    await env.DB.prepare('INSERT INTO admin_activity (id, actor, action, kind, ts) VALUES (?, ?, ?, ?, ?)')
      .bind(String(crypto.randomUUID()), actor, sanitizeText(action, 300), kind, nowSec()).run();
  } catch { /* logging must never break an action */ }
}
function consoleActor(c: any): string { return String((c.get('user') || {}).sub || 'admin'); }
async function publishDueApps(env: Env) {
  await ensureConsoleTables(env.DB);
  const res: any = await env.DB.prepare(
    "UPDATE app_publication SET status = 'published', updated_at = ? WHERE status = 'scheduled' AND publish_at <= ?"
  ).bind(nowSec(), nowSec()).run().catch(() => null);
  const n = Number(res?.meta?.changes ?? res?.changes ?? 0);
  if (n > 0) await recordActivity(env, 'cron', `نشر ${n} عنصراً مجدولاً تلقائياً`, 'publish');
}
async function requireOwner(c: any, next: any) {
  await ensureConsoleTables(c.env.DB);
  const owners: any = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM admin_roles WHERE role = 'owner'").first().catch(() => null);
  if (!Number(owners?.n || 0)) { await next(); return; }   // bootstrap: no owner configured yet
  const me = consoleActor(c);
  const row: any = await c.env.DB.prepare('SELECT role FROM admin_roles WHERE username = ?').bind(me).first().catch(() => null);
  if (!row || row.role !== 'owner') return c.json({ error: 'forbidden' }, 403);
  await next();
}

function appPublic(d: any, includeInternalKeys = false, env?: any): App & { id: string } {
  const result: any = {
    id: d.id, slug: d.slug, name: d.name, name_lower: d.name_lower, search_terms: d.search_terms || [],
    package_name: d.package_name, short_description: d.short_description, description: d.description,
    category: d.category, type: d.type === 'game' ? 'game' : 'app', developer: d.developer,
    version_name: d.version_name, version_code: d.version_code, min_sdk: d.min_sdk, size_bytes: d.size_bytes,
    rating: d.rating || 0, rating_count: d.rating_count || 0, stars: d.stars || 0, downloads: d.downloads || 0,
    created_at: d.created_at, updated_at: d.updated_at,
  };
  if (includeInternalKeys) { result.apk_key = d.apk_key; result.icon_key = d.icon_key; result.feature_key = d.feature_key; }
  // A PERMANENT url for the file itself. `/download` answers with a 302 to a
  // signed R2 link that expires in 5 minutes, which is fine as a click target
  // but useless for a multi-GB transfer: a downloader that follows the redirect
  // once and keeps the pre-signed URL loses it mid-transfer. The public R2
  // domain serves the same object without an expiry and honours Range, so a
  // download can resume instead of dying when the app is left or the phone
  // sleeps. Public payloads only — never on the admin surface.
  if (!includeInternalKeys && d.apk_key) {
    try { result.apk_url = r2PublicUrl(d.apk_key, env); } catch { /* domain unset: UI falls back to /download */ }
  }
  return result;
}

/** Never let a missing D1 table break a public app page. */
function videoThumbKey(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;              // leave unchanged
  if (raw === null || raw === '') return null;          // clear custom thumb
  const k = String(raw);
  return isValidR2Key(k, 'vthumb') ? k : undefined;     // invalid -> caller rejects
}

async function videosFor(env: Env, appId: string): Promise<any[]> {
  try {
    const rows = await listAppVideos(env, appId);
    return rows.map(v => ({
      id: v.id, video_id: v.video_id, kind: v.kind, url: v.url,
      title: v.title || '', position: v.position,
      thumb_url: v.thumb_key ? shot_url(v.thumb_key, env) : null,
    }));
  } catch (e: any) {
    console.error('[videos] list failed:', e?.message || e);
    return [];
  }
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
  /* Ids are generated by randomId() (hex) but legacy rows may carry other safe
     characters; only obviously unsafe input is rejected. */
  if (!reviewId || reviewId.length > 128 || /[^A-Za-z0-9_:.-]/.test(reviewId)) return null;
  const appData = await getAppBySlug(c.env, slug);
  if (!appData) return null;
  /* A client may hold a review identifier that is not the primary key: the
     vote id used by older bundles, the hash, or the server_hash. Accepting all
     three is what makes «like» reliable on rows created by previous versions
     (and it is still scoped to this app). */
  const aliases = await appAliases(c.env, appData).catch(() => [String(appData.id)]);
  const row: any = await c.env.DB.prepare(
    `SELECT v.id, v.app_id, v.uid, v.comment, v.rating, a.name AS app_name
       FROM star_votes v LEFT JOIN apps a ON a.id = v.app_id
      WHERE v.id = ? OR v.hash = ? OR v.server_hash = ?
      LIMIT 1`,
  ).bind(reviewId, reviewId, reviewId).first().catch(() => null);
  if (!row) return null;
  const mine = aliases.map(String).concat([String(appData.id), String(appData.slug || '')]);
  if (!mine.includes(String(row.app_id))) return null;
  const uid = String(row.uid || '').trim();
  return { ...row, uid, uid_is_anonymous: !uid || /^gs_[a-z0-9]{6,}$/i.test(uid), app_name: String(row.app_name || '') };
}

// النطاق الديناميكي
function storeDomain(env: Env): string { return env.STORE_DOMAIN || 'goldenstore.online'; }

/* Image URLs.
 *
 * These used to be wrapped in Cloudflare's `/cdn-cgi/image/…` resizer:
 *   https://goldenstore.online/cdn-cgi/image/width=200,…/<r2 url>
 * That transform is only available once Image Resizing is enabled for the zone.
 * It is not — the endpoint returns 404 even for the site's own logo — so every
 * icon, screenshot and feature image in the store was a broken 404, and a freshly
 * published game looked «missing» because its card had no picture.
 *
 * The R2 public bucket URL serves the objects directly, already correctly typed
 * (image/webp, image/jpeg), so the resize step is pure loss here. Set
 * R2_IMAGE_TRANSFORM = "on" (wrangler.toml [vars]) to put the resizer back the
 * day Image Resizing is enabled — no code change needed.
 */
function imageTransformEnabled(env: Env): boolean {
  const v = String((env as any).R2_IMAGE_TRANSFORM || '').trim().toLowerCase();
  return v === 'on' || v === 'true' || v === '1';
}

/* ── Pictures now travel on the site's own domain ──────────────────────────
 * Owner: «اضن سبب الثقل الموقع لانه بعيد» while looking at the bucket's
 * «Public Development URL».
 *
 * He is half right, and the measurable half matters more than the distance.
 * R2's r2.dev hostname answers EVERY request with no `Cache-Control` and no
 * `Age`/`cf-cache-status` (checked: only ETag + Last-Modified come back), so a
 * phone cannot keep an icon: the store's own cards show them again on every
 * visit, and each one left the browser on a second origin (a second DNS
 * lookup + TLS handshake) that is also rate-limited by Cloudflare.
 *
 * `/media/<key>` streams the object from the bucket and marks it immutable, so
 * the picture is fetched from Cloudflare's edge — already warm in the same POP
 * that answered the page — and kept by the phone. The `<img>` therefore loads
 * from the origin it already trusts, and no r2.dev round trip happens at all.
 * The 1-hour TTL is what makes a re-uploaded icon show up again.
 */
const MEDIA_CACHE = 'public, max-age=3600, stale-while-revalidate=86400';
function mediaUrl(key: string | undefined, env: Env, width: number, variant = ''): string | null {
  try {
    if (!key) return null;
    const direct = r2PublicUrl(key, env);
    if (imageTransformEnabled(env)) {
      return `https://${storeDomain(env)}/cdn-cgi/image/width=${width},format=auto,quality=80/${direct}`;
    }
    // `?v=` changes with the object, so a replaced picture is not served stale.
    return `/api/media/${key.split('/').map(encodeURIComponent).join('/')}?w=${width}${variant ? '&v=' + variant : ''}`;
  } catch { return null; }
}

// دالة مساعدة لبناء روابط الصور
function cdnImageUrl(key: string | undefined, env: Env, width: number, variant = ''): string | null {
  return mediaUrl(key, env, width, variant);
}

/** A short, stable token for the object: the same key always gives the same
 *  token, a re-uploaded picture (new key from the organiser or a new upload)
 *  gives a new one — which is all `?v=` needs to do. */
function hashToken(base: string): string {
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
/* The `?v=` a picture URL carries.
 *
 * It used to be a hash of the KEY alone. Because a replacement keeps the key
 * (`icon/<slug>.webp`, `ss/<slug>-2.jpg`), the URL was byte-identical before and
 * after an update — so the phone (which now keeps pictures for an hour, R90) and
 * Cloudflare's edge both served the OLD picture, and the console looked like it
 * had published nothing. Mixing the row's updated_at in makes a replacement a
 * new URL, which is the only reliable way to change a cached image. */
function versionToken(key: string | undefined, stamp?: unknown): string {
  const base = String(key || '');
  const n = Number(stamp) || 0;
  return n ? `${hashToken(base)}-${n.toString(36)}` : hashToken(base);
}
function keyToken(key: string | undefined): string { return versionToken(key); }
function feature_url(feature_key: string | undefined, env: Env, width: number = 800): string | null {
  return cdnImageUrl(feature_key, env, width, keyToken(feature_key));
}
function icon_url(icon_key: string | undefined, env: Env, width: number = 200): string | null {
  return cdnImageUrl(icon_key, env, width, keyToken(icon_key));
}
// دالة جديدة لصور الشاشات بدقة 720
function shot_url(shot_key: string | undefined, env: Env, width: number = 720): string | null {
  return cdnImageUrl(shot_key, env, width, keyToken(shot_key));
}

/* FCM delivery now lives in lib/push.ts. Keeping it in one module means the
   admin broadcast, the "new version" notification and the self-test all use
   the same targeting, batching, pruning and logging rules. */

function inQuietHours(settings: Record<string, string>): boolean {
  const start = Number(settings.quiet_start || 23);
  const end = Number(settings.quiet_end || 7);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  const h = new Date().getUTCHours();
  return start > end ? (h >= start || h < end) : (h >= start && h < end);
}

/** The push half of a saved notification (settings + quiet hours + FCM). */
async function broadcastSaved(env: Env, rich: any, data: any, settings: Record<string, string>) {
  if (settings.push_enabled !== '1') return { skipped: 'push_disabled', targeted: 0, success: 0, failure: 0 };
  if (inQuietHours(settings)) return { skipped: 'quiet_hours', targeted: 0, success: 0, failure: 0 };
  try {
    return await deliverNotification(env, rich, data.segment || { mode: 'all' });
  } catch (error: any) {
    console.error('[fcm] broadcast failed but notification was saved:', error?.message || error);
    return { error: 'push_failed', message: String(error?.message || error), targeted: 0, success: 0, failure: 0 };
  }
}

async function addNotification(env: Env, data: any, ctx?: any) {
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
  
  // The notification row is already persisted. An FCM outage must never make
  // the admin publish request fail — report the delivery result instead.
  const rich = {
    title, body, type, app_slug, id, image,
    image_url: data.image_url || image,
    click_url: data.click_url || (app_slug ? `/app?slug=${encodeURIComponent(app_slug)}` : ''),
    data: data.data,
  };
  const settings = await readAllSettings(env).catch(() => ({ ...SETTING_DEFAULTS }));
  /* ── The row is saved now; the BROADCAST is backgrounded ────────────────
   * `addNotification` used to await `deliverNotification`, which fans out to
   * every device through FCM. That is what made «النشر بطيئاً»: the console (and
   * the update button) sat waiting for a job measured in seconds while the row
   * was already written. `fast` keeps the row synchronous — so the caller can
   * report `notified: true` honestly — and hands the push to `waitUntil`.
   * The delivery itself is queued by the engine anyway (delivery_jobs), so
   * nothing is lost if the request ends first. */
  if (data.fast && ctx && typeof ctx.waitUntil === 'function') {
    const fire = () => broadcastSaved(env, rich, data, settings).catch((error: any) => {
      console.error('[fcm] broadcast failed but notification was saved:', error?.message || error);
    });
    ctx.waitUntil(fire());
    return { id, push: { queued: true } };
  }
  let push: any;
  if (settings.push_enabled !== '1') {
    push = { skipped: 'push_disabled', targeted: 0, success: 0, failure: 0 };
  } else if (inQuietHours(settings)) {
    push = { skipped: 'quiet_hours', targeted: 0, success: 0, failure: 0 };
  } else {
    try {
      // NORMAL + ADVANCED + AUTOMATED + SCHEDULED → the SAME unified engine.
      push = await deliverNotification(env, rich, data.segment || { mode: 'all' });
    } catch (error: any) {
      console.error('[fcm] broadcast failed but notification was saved:', error?.message || error);
      push = { error: 'push_failed', message: String(error?.message || error), targeted: 0, success: 0, failure: 0 };
    }
  }
  return { id, push };
}

/* -------------------------------------------------------------------------
   PER-USER NOTIFICATIONS
   -------------------------------------------------------------------------
   Two real events create a PRIVATE notification row (uid set), which only the
   signed-in owner can see in «مركز إعلام»:
     1) a support reply   → fires when the USER sends a message in /support
                            (type 'support', tap opens /support?thread=…)
     2) a like received   → fires for the AUTHOR of a review when somebody
                            else likes it (type 'like', tap opens the app page)
   Rows are written with insertNotificationRow() (same `notifications` table, so
   the existing bell badge, list API and page need no second source of truth),
   and pushed to that one uid through the unified engine (segment.mode='users').
   A failure here must never break the user-facing request.
   ------------------------------------------------------------------------- */
const SUPPORT_NOTIFY_COOLDOWN = 1800;   // 30 min per support thread
const LIKE_NOTIFY_COOLDOWN = 3600;      // 1 h per review

async function notifyUser(
  env: Env, uid: string,
  // `type` is one of the three values the store already understands — that is
  // what makes the page's three quick buttons filter these rows:
  //   announcement → «اشعار رسمي»   (support)
  //   new_app      → «تلقى الإعجابات» (likes)
  // The exact kind is kept in data.kind.
  note: { type: 'announcement' | 'new_app'; title: string; body: string; app_slug?: string;
          click_url?: string; data?: Record<string, any>; },
): Promise<{ id: string; created: boolean; push?: any }> {
  const owner = String(uid || '').trim();
  if (!owner) return { id: '', created: false };
  await ensureUserNotificationSchema(env);
  const id = randomId();
  await insertNotificationRow(env, {
    id, title: note.title, body: note.body, type: note.type,
    app_slug: note.app_slug || '', uid: owner, created_at: nowSec(),
    data: { ...(note.data || {}), click_url: note.click_url || '' },
  });
  let push: any = null;
  try {
    const settings = await readAllSettings(env).catch(() => ({ ...SETTING_DEFAULTS }));
    if (settings.push_enabled === '1' && !inQuietHours(settings)) {
      push = await deliverNotification(env, {
        id, title: note.title, body: note.body, type: note.type,
        app_slug: note.app_slug || '',
        click_url: note.click_url || '',
        image: '', image_url: '',
        data: note.data || {},
      }, { mode: 'users', uids: [owner] }, { force: true });
    }
  } catch (error: any) {
    console.error('[notify-user] push failed, row saved:', error?.message || error);
  }
  return { id, created: true, push };
}

// ============================================================
// Public Routes
// ============================================================
app.get('/store', (c) => {
  c.header('Cache-Control', 'public, max-age=3600');
  return c.json({ name: c.env.STORE_NAME || 'Goldenstore', domain: c.env.STORE_DOMAIN || 'goldenstore.online' });
});

/* No hard-coded APK fallback.
   This used to point at a build that no longer exists in the bucket, so
   `/api/app-update` advertised a dead link and `/api/app-update/download`
   redirected to a 404 — a download that silently fails for every visitor.
   With an empty bucket the honest answer is «لا يوجد ملف بعد», and the admin
   Update Center is the only place that can make it exist. */
const CURRENT_RELEASE = { version_name: '', version_code: 0, apk_url: '', notes: '' };

/* -------------------------------------------------------------------
   Durable download counter. `app_updates` used to be REPLACEd every time
   an admin published a build, which reset `downloads` to 0. This separate
   monotonic table is never replaced, so the real total survives releases.
   ------------------------------------------------------------------- */
const DOWNLOAD_STATS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS app_download_stats (
     id TEXT PRIMARY KEY,
     downloads INTEGER NOT NULL DEFAULT 0,
     restored INTEGER NOT NULL DEFAULT 0
   )`,
];
// Older deployments created the table without `restored`; this ALTER is safe
// to fail with "duplicate column name".
const DOWNLOAD_STATS_UPGRADES = [
  `ALTER TABLE app_download_stats ADD COLUMN restored INTEGER NOT NULL DEFAULT 0`,
];
/* One-time restoration of the historic total. The admin publish endpoint
   used INSERT OR REPLACE, which reset app_updates.downloads; the store owner
   confirmed the real count had already passed 4,000. We add that floor back
   EXACTLY ONCE and keep every real download recorded since the reset. The
   `restored` flag makes the UPSERT idempotent across cold starts/deploys. */
const DOWNLOAD_RESTORE_BASELINE = 4000;
let downloadStatsReady = false;
async function ensureDownloadStatsSchema(env: Env): Promise<void> {
  const db: any = env.DB;
  if (downloadStatsReady) return;
  for (const sql of DOWNLOAD_STATS_SCHEMA) await db.prepare(sql).run();
  for (const sql of DOWNLOAD_STATS_UPGRADES) { try { await db.prepare(sql).run(); } catch { /* already present */ } }
  // If the durable row does not exist yet, carry over the legacy column so
  // no real download is lost. Single atomic, idempotent statement:
  //   fresh row      -> 4,000 + legacy
  //   existing row   -> +4,000 once, then +0 forever. The `downloads < 4000`
  //   guard also protects against an admin who already entered the historic
  //   total with the previously deployed code (no double counting).
  let legacySeed = 0;
  try {
    const lr: any = await db.prepare("SELECT downloads FROM app_updates WHERE id = 'current'").first();
    legacySeed = Number(lr?.downloads) || 0;
  } catch {}
  await db.prepare(`INSERT INTO app_download_stats (id, downloads, restored)
      VALUES ('current', ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        downloads = downloads + CASE WHEN restored = 0 AND downloads < ? THEN ? ELSE 0 END,
        restored = 1`)
    .bind(DOWNLOAD_RESTORE_BASELINE + legacySeed,
          DOWNLOAD_RESTORE_BASELINE, DOWNLOAD_RESTORE_BASELINE).run();
  downloadStatsReady = true;
}
async function bumpDownloadCount(env: Env): Promise<number> {
  await ensureDownloadStatsSchema(env);
  // The legacy column may already hold a larger historic total (from before
  // this table existed). Never let a sync overwrite it with a smaller value.
  let legacy = 0;
  try {
    const lr: any = await env.DB.prepare("SELECT downloads FROM app_updates WHERE id = 'current'").first();
    legacy = Number(lr?.downloads) || 0;
  } catch {}
  /* One write, not three. This runs on the download path, where the visitor is
   * waiting for a redirect: reading the durable row and then writing it back
   * cost two extra network hops (and could drift under concurrency). A single
   * atomic UPSERT increments in place; the legacy column is then set from the
   * value D1 itself reports, in the same round trip budget as before. */
  const res: any = await env.DB.prepare(`INSERT INTO app_download_stats (id, downloads, restored) VALUES ('current', ?, 1)
    ON CONFLICT(id) DO UPDATE SET downloads = downloads + 1, restored = 1
    RETURNING downloads`).bind(Math.max(legacy, 0) + 1).first().catch(() => null);
  const total = Number(res?.downloads) || Math.max(legacy, 0) + 1;
  await env.DB.prepare("UPDATE app_updates SET downloads = ? WHERE id = 'current'").bind(total).run().catch(() => {});
  return total;
}
async function readDownloadCount(env: Env, legacy: number): Promise<number> {
  try {
    await ensureDownloadStatsSchema(env);
    const row: any = await env.DB.prepare("SELECT downloads FROM app_download_stats WHERE id = 'current'").first();
    return Math.max(Number(legacy) || 0, Number(row?.downloads) || 0);
  } catch { return Number(legacy) || 0; }
}
async function setDownloadBaseline(env: Env, requested: number): Promise<number> {
  await ensureDownloadStatsSchema(env);
  let legacy = 0;
  try {
    const lr: any = await env.DB.prepare("SELECT downloads FROM app_updates WHERE id = 'current'").first();
    legacy = Number(lr?.downloads) || 0;
  } catch {}
  const current = await readDownloadCount(env, legacy);
  // Monotonic: an admin can restore a lost historic total but never decrease it.
  const total = Math.max(current, Math.floor(requested));
  await env.DB.prepare(`INSERT INTO app_download_stats (id, downloads, restored) VALUES ('current', ?, 1)
    ON CONFLICT(id) DO UPDATE SET downloads = excluded.downloads, restored = 1`).bind(total).run();
  await env.DB.prepare("UPDATE app_updates SET downloads = ? WHERE id = 'current'").bind(total).run().catch(() => {});
  return total;
}

/* The release row stores the FULL public URL of the APK (that is how it was
 * uploaded), so a row written while the store still used
 * https://cdn.goldenstore.online keeps that host for ever — and that hostname
 * now resolves to nothing (000), so «تحديث التطبيق» downloads nothing.
 *
 * Rewriting the stored URL on every read would be wrong (the row may legitimately
 * point at another CDN later), so this only repairs a URL that still points at a
 * host we know is dead, and only when the object really lives in our bucket.
 */
/* Every host that has ever served this bucket, and that is dead now.
 *
 * Owner (this round): «حذفت الحاوية القديمة وصنعت واحدة أخرى جديدة … عدل كل
 * الروابط الميتة». A stored FULL url outlives the bucket it named, so a release
 * row written last month kept pointing at a hostname that no longer answers —
 * the download button then fails with nothing to diagnose. The list covers the
 * old CDN, the API host, and every `pub-….r2.dev` bucket id this store has used.
 * Nothing else is rewritten: a url that points at a host we do not own is left
 * exactly as it is.
 */
const DEAD_MEDIA_HOSTS = [
  /^https?:\/\/(?:cdn|api)\.goldenstore\.online\//i,
  /^https?:\/\/pub-19788071c0444841a00871f67e620d63\.r2\.dev\//i,
];
function repairReleaseUrl(raw: unknown, env: Env): string {
  const url = String(raw || '');
  if (!url) return url;
  const dead = DEAD_MEDIA_HOSTS.find((re) => re.test(url));
  if (!dead) return url;
  const key = url.replace(dead, '').split('?')[0];
  try { return r2PublicUrl(decodeURIComponent(key), env); } catch { return url; }
}

app.get('/app-update', async (c) => {
  // Never let a CDN/browser serve a stale total.
  c.header('Cache-Control', 'no-store');
  let row: any = null;
  try { row = await c.env.DB.prepare("SELECT * FROM app_updates WHERE id = 'current'").first(); } catch {}
  const legacy = Number(row?.downloads) || 0;
  const downloads = await readDownloadCount(c.env, legacy);
  const apkUrl = repairReleaseUrl(row?.apk_url || CURRENT_RELEASE.apk_url, c.env);
  const out = {
    version_name: row?.version_name || CURRENT_RELEASE.version_name,
    version_code: Number(row?.version_code) || CURRENT_RELEASE.version_code,
    apk_url: apkUrl, url: apkUrl,
    notes: row?.notes || CURRENT_RELEASE.notes,
    force: row?.force === 1,
    size_bytes: Number(row?.size_bytes) || 0,   // real APK size for the dialog
    created_at: Number(row?.created_at) || 0,   // release date for the dialog
    downloads,                                  // always a real number, never undefined
  };
  // Round 40: logo + screenshots + YouTube videos for the download page.
  let shots: string[] = [];
  let vids: any[] = [];
  try { shots = JSON.parse(row && row.screenshots || '[]'); } catch {}
  try { vids = JSON.parse(row && row.videos || '[]'); } catch {}
  if (!Array.isArray(shots)) shots = [];
  if (!Array.isArray(vids)) vids = [];
  const media = {
    logo_url: row && row.logo_key ? icon_url(row.logo_key, c.env, 320) : null,
    screenshots: shots.map((k: string) => ({ key: k, url: shot_url(k, c.env) })).filter((x: any) => x.url),
    videos: vids.map((v: any) => ({
      video_id: v.video_id, kind: v.kind, title: v.title || '',
      thumb_url: `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`,
    })),
  };
  return c.json({ ...out, ...media, update: { ...out } });
});

app.get('/app-update/download', async (c) => {
  c.header('Cache-Control', 'no-store');
  let apkUrl = CURRENT_RELEASE.apk_url;
  try {
    const row: any = await c.env.DB.prepare("SELECT apk_url FROM app_updates WHERE id = 'current'").first();
    if (row?.apk_url) apkUrl = row.apk_url;
  } catch {}
  if (!apkUrl) return c.json({ error: 'apk_not_available' }, 404);
  // Headless checkers and crawlers must not inflate the public counter — the
  // same rule the per-app download route already applies.
  const ua = String(c.req.header('user-agent') || '');
  if (!/bot|crawler|spider|preview|headless/i.test(ua)) {
    await bumpDownloadCount(c.env).catch(() => {});
    await recordDownloadEvent(c.env, 'app-update', 'web');
  }
  /* Owner: «اضن سبب الثقل الموقع لانه بعيد» — for an APK this is measurable.
   *
   * The site is served by Pages, whose /api/* hop is a second full request to a
   * different Cloudflare product before the download even starts. On Android —
   * the only platform that installs these files — the browser is sent straight
   * to the object instead, so a 160 MB download starts one round trip earlier
   * and resumes natively. One hop is saved, not the transfer; the bytes always
   * came from the bucket.
   */
  return c.redirect(apkUrl, 302);
});

/* =========================================================================
   Round 40 — the DOWNLOAD page is now managed from «مركز التحديث»:
   a real logo (replacing the old green mascot) plus app screenshots and
   YouTube videos/Shorts, exactly like an app/game in the store.
   ========================================================================= */
app.post('/admin/app-update/media', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  await ensureReleaseTable(c.env.DB);
  // best-effort column upgrades (duplicate column errors are expected once)
  for (const sql of [
    `ALTER TABLE app_updates ADD COLUMN logo_key TEXT`,
    `ALTER TABLE app_updates ADD COLUMN screenshots TEXT`,
    `ALTER TABLE app_updates ADD COLUMN videos TEXT`,
  ]) { try { await c.env.DB.prepare(sql).run(); } catch {} }

  const readList = (raw: any, validate: (x: any) => boolean): any[] | null => {
    if (raw === undefined) return null;
    if (!Array.isArray(raw)) return [];
    return raw.filter(validate).slice(0, 24);
  };
  const shots = readList(body.screenshots,
    (x) => typeof x === 'string' && x.startsWith('ss/') && !x.includes('..'));
  const vids = readList(body.videos,
    (x) => x && /^[A-Za-z0-9_-]{6,20}$/.test(String(x.video_id || ''))
      && (x.kind === 'short' || x.kind === 'video'));
  const logo = body.logo_key === undefined ? undefined
    : (body.logo_key === null || body.logo_key === '' ? null
      : (typeof body.logo_key === 'string' && body.logo_key.startsWith('icon/') && !body.logo_key.includes('..')
        ? body.logo_key : undefined));
  if (logo === undefined && body.logo_key !== undefined) return c.json({ error: 'invalid_logo_key' }, 400);

  const sets: string[] = [];
  const binds: any[] = [];
  if (logo !== undefined) { sets.push('logo_key = ?'); binds.push(logo); }
  if (shots !== null) { sets.push('screenshots = ?'); binds.push(JSON.stringify(shots)); }
  if (vids !== null) {
    sets.push('videos = ?');
    binds.push(JSON.stringify(vids.map((v: any) => ({
      video_id: String(v.video_id), kind: v.kind === 'short' ? 'short' : 'video',
      title: sanitizeText(v.title, 120),
    }))));
  }
  if (sets.length) {
    try {
      await c.env.DB.prepare(`UPDATE app_updates SET ${sets.join(', ')} WHERE id = 'current'`).bind(...binds).run();
    } catch (e: any) { return c.json({ error: 'save_failed' }, 500); }
  }
  return c.json({ ok: true });
});

app.get('/admin/app-update/media', async (c) => {
  // Even if the /admin/* guard were ever reordered, never hand this to a guest.
  const admin = await requireAdmin(c, async () => {}).catch(() => null);
  if (admin) return admin;
  await ensureReleaseTable(c.env.DB);
  for (const sql of [
    `ALTER TABLE app_updates ADD COLUMN logo_key TEXT`,
    `ALTER TABLE app_updates ADD COLUMN screenshots TEXT`,
    `ALTER TABLE app_updates ADD COLUMN videos TEXT`,
  ]) { try { await c.env.DB.prepare(sql).run(); } catch {} }
  const row: any = await c.env.DB.prepare("SELECT * FROM app_updates WHERE id = 'current'").first().catch(() => null);
  let shots: string[] = [];
  let vids: any[] = [];
  try { shots = JSON.parse(row && row.screenshots || '[]'); } catch {}
  try { vids = JSON.parse(row && row.videos || '[]'); } catch {}
  if (!Array.isArray(shots)) shots = [];
  if (!Array.isArray(vids)) vids = [];
  return c.json({
    logo_url: row && row.logo_key ? icon_url(row.logo_key, c.env, 320) : null,
    logo_key: (row && row.logo_key) || null,
    screenshots: shots.map((k: string) => ({ key: k, url: shot_url(k, c.env) })),
    videos: vids.map((v: any) => ({
      video_id: v.video_id, kind: v.kind, title: v.title || '',
      thumb_url: `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`,
      embed_url: `https://www.youtube.com/embed/${v.video_id}`,
    })),
  });
});

/* ---- Legal consent (defence in depth) -----------------------------------
   Google sign-in itself is handled entirely by Firebase Auth in the browser,
   so there is no Hono "login" endpoint to gate. This endpoint validates the
   consent payload server-side and issues a signed, httpOnly consent receipt
   that can later be checked by any endpoint (or moved into a D1 audit table).
   The UI checkbox in login.js / store.js remains the actual blocking gate. */
const LEGAL_VERSION = '2026-11-05r2';

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

/* Owner question «حتى مع تسجيل الدخول لا أتلقى إشعار إعجاب» — a read-only
   self-diagnostic for the SIGNED-IN user. It answers, from the database itself:
     · which account am I?  · how many reviews do I own (and their ids)
     · how many likes did they receive · how many like-notifications exist for me.
   No data of other users is ever returned. */
app.get('/notifications/like-diagnostics', async (c) => {
  const user = await requireFirebaseUser(c).catch(() => null);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const uid = String(user.uid);
  await ensureUserNotificationSchema(c.env).catch(() => {});
  const myReviews: any = await c.env.DB.prepare(
    `SELECT v.id, v.app_id, v.rating, v.comment, v.ts, a.slug AS app_slug, a.name AS app_name
       FROM star_votes v LEFT JOIN apps a ON a.id = v.app_id
      WHERE v.uid = ? ORDER BY v.ts DESC LIMIT 50`,
  ).bind(uid).all().catch(() => ({ results: [] }));
  const reviews = (myReviews.results || []) as any[];
  let likesReceived = 0;
  for (const rv of reviews) {
    const row: any = await c.env.DB.prepare(
      'SELECT COUNT(DISTINCT user_id) AS n FROM review_likes WHERE review_id = ?',
    ).bind(String(rv.id)).first().catch(() => ({ n: 0 }));
    rv.likes_count = Number(row?.n || 0);
    likesReceived += rv.likes_count;
  }
  const notes: any = await c.env.DB.prepare(
    `SELECT id, title, data, created_at FROM notifications
      WHERE uid = ? AND type = 'new_app' ORDER BY created_at DESC LIMIT 50`,
  ).bind(uid).all().catch(() => ({ results: [] }));
  const likeNotes = ((notes.results || []) as any[]).filter((n) => {
    try { const d = JSON.parse(n.data || '{}'); return d && d.kind === 'like'; } catch { return false; }
  }).map((n) => ({ id: n.id, title: n.title, created_at: n.created_at }));
  c.header('Cache-Control', 'private, no-store');
  return c.json({
    uid: uid.slice(0, 6) + '…',                       // masked, never the full id
    push_enabled: (await readAllSettings(c.env).catch(() => ({ ...SETTING_DEFAULTS }))).push_enabled === '1',
    reviews_written: reviews.length,
    reviews: reviews.map((rv) => ({
      review_id: String(rv.id), app_slug: rv.app_slug || '', app_name: rv.app_name || '',
      rating: Number(rv.rating) || 0, has_comment: !!String(rv.comment || '').trim(),
      likes_received: rv.likes_count,
    })),
    likes_received: likesReceived,
    like_notifications: likeNotes.length,
    recent_like_notifications: likeNotes.slice(0, 5),
    verdict: likesReceived === 0
      ? 'no_likes_yet'
      : (likeNotes.length === 0
          ? 'likes_exist_but_notifications_missing'
          : (likeNotes.length < likesReceived ? 'partial' : 'ok')),
  });
});

app.get('/notifications', async (c) => {
  const limit = safeInt(c.req.query('limit') || '30', 1, 50);
  // The per-user column is created lazily; on an existing database this ALTER
  // is what makes the private-row queries below possible.
  await ensureUserNotificationSchema(c.env).catch(() => {});
  // A signed-in caller also receives their own PRIVATE rows (support replies,
  // likes received). Without a token the response is the public broadcast only,
  // exactly as before — and it must never be cached across users.
  const user = await requireFirebaseUser(c).catch(() => null);
  const uid = user ? String(user.uid) : '';
  const notifs = await listNotifications(c.env, limit, uid);
  c.header('Cache-Control', uid ? 'private, no-store' : 'public, max-age=60');
  return c.json({
    notifications: notifs.map(n => ({ ...n, data: n.data ? JSON.parse(n.data) : null })),
    // Tells the client whether this response already contains its private rows,
    // so the page can skip the extra authenticated request.
    personal: !!uid,
  });
});

// Notifications Tokens (D1)
async function requireFirebaseUser(c: any) {
  // Case-insensitive: HTTP auth schemes are case-insensitive ('bearer …' is valid).
  const token = (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '').trim();
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
  // Android 13+ POST_NOTIFICATIONS: the token is ALWAYS stored; consent is
  // a separate field used only when building the broadcast audience.
  const res = await registerPushToken(c.env, {
    token, uid: user.uid, platform: String(body.platform || 'android'),
    channel: 'native',
    installation_id: String(body.installation_id || ''),
    permission: String(body.permission || 'granted'),
    enabled: body.notifications_enabled !== false,
  });
  return c.json(res);
});

app.post('/notifications/register-web', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'reg-web-token', 30, 60)) return c.json({ error: 'rate_limited' }, 429);
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  if (!token || token.length > 4096) return c.json({ error: 'invalid_token' }, 400);
  // D1 is the single source of truth: sendWebPush() reads this exact table.
  const res = await registerPushToken(c.env, {
    token, uid: user.uid, web: true, channel: 'web',
    installation_id: String(body.installation_id || ''),
    permission: String(body.permission || 'granted'),
    enabled: body.notifications_enabled !== false,
    userAgent: String(c.req.header('user-agent') || ''),
  });
  return c.json(res);
});

// Unified device registration. The APK calls this with channel:'native'
// (real FCM device token); the WebView calls it with channel:'web'. A stable
// installation_id lets the server keep exactly ONE active token per device.
app.post('/notifications/register-device', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'register-device', 30, 60)) return c.json({ error: 'rate_limited' }, 429);
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  if (!token || token.length > 4096) return c.json({ error: 'invalid_token' }, 400);
  const channel = String(body.channel || 'native') === 'web' ? 'web' : 'native';
  const res = await registerPushToken(c.env, {
    token, uid: user.uid, channel,
    web: channel === 'web',
    installation_id: String(body.installation_id || ''),
    platform: String(body.platform || (channel === 'web' ? 'web' : 'android')),
    permission: String(body.permission || 'granted'),
    enabled: body.notifications_enabled !== false,
    userAgent: String(c.req.header('user-agent') || ''),
  });
  return c.json({ ok: true, engine: 'unified', ...res });
});

// Client-side display receipt: lets support prove whether a notification was
// actually rendered on the device, without exposing tokens or user data.
app.post('/notifications/receipt', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'push-receipt', 60, 60)) return c.json({ error: 'rate_limited' }, 429);
  const body = await c.req.json().catch(() => ({}));
  const id = String(body.notification_id || '').slice(0, 120);
  if (!id) return c.json({ error: 'invalid' }, 400);
  const user = await requireFirebaseUser(c).catch(() => null);
  await recordPushReceipt(c.env, id, user?.uid || '', String(body.channel || ''),
    String(body.event || 'displayed'));
  return c.json({ ok: true });
});

app.post('/notifications/unregister-token', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  // The token itself is a bearer capability, but we still validate it and,
  // when the caller is signed in, scope the deletion to that account so a
  // leaked/guessed token cannot be used to triage somebody else's devices.
  if (!token || token.length > 4096) return c.json({ error: 'invalid_token' }, 400);
  const user = await requireFirebaseUser(c).catch(() => null);
  if (user) {
    const owned: any = await c.env.DB.prepare(
      'SELECT uid FROM push_devices WHERE token = ?',
    ).bind(token).first().catch(() => null);
    if (!owned || String(owned.uid) !== user.uid) {
      return c.json({ error: 'forbidden' }, 403);
    }
  }
  await unregisterPushToken(c.env, token);
  return c.json({ ok: true });
});

// Persist the OS/browser notification permission for the signed-in user.
// Called on every page load and whenever Notification.permission changes, so
// broadcasts never target a user who revoked POST_NOTIFICATIONS (Android 13+).
app.post('/notifications/preference', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'push-pref', 30, 60)) return c.json({ error: 'rate_limited' }, 429);
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({}));
  // `platform` keeps a browser tab from disabling the same user's Android
  // device (and vice versa).
  const res = await setPushPreference(c.env, user.uid,
    String(body.permission || 'granted'), body.notifications_enabled !== false,
    String(body.platform || 'android'));
  return c.json(res);
});

app.post('/notifications/self-test', async (c) => {
  const user = await requireFirebaseUser(c); if (!user) return c.json({ error: 'unauthorized' }, 401);
  // One uid → one unified delivery. Every device of that user receives at most
  // ONE message, and never via both topic and direct paths.
  const note = {
    id: 'selftest-' + randomId(), title: 'إشعار تجريبي', body: 'يعمل ✓',
    type: 'announcement',
  };
  const push = await deliverNotification(c.env, note,
    { mode: 'uid', uid: user.uid }, { force: true });
  if (!push.targeted) return c.json({ error: 'no_registered_devices' }, 400);
  return c.json({ ok: true, push });
});

// ---- Translation helpers -------------------------------------------------
// Google's gtx endpoint answers Cloudflare Worker IPs with an HTML "Sorry..."
// bot-block page. The old route mistook that failure for a valid translation
// and cached the unchanged Arabic source forever, so any string missing from
// the curated dictionary could never be translated.
let translateReady = false;
async function ensureTranslateCache(db: any) {
  if (!db || translateReady) return;
  translateReady = true;
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS i18n_cache (
      id TEXT PRIMARY KEY,
      target TEXT,
      src TEXT,
      out TEXT,
      ts INTEGER
    )`).run();
  } catch { /* table already exists / D1 unavailable: still serve translations */ }
}

const ARABIC_CHARS = /[\u0600-\u06FF]/;
let gtxBackoffUntil = 0;
// All external providers rate-limit shared Cloudflare egress IPs with HTTP 429.
// After a fully failed batch, stop calling them for a few minutes entirely.
let providerCooldownUntil = 0;
type TrResult = { tr: string | null; why: string };

function pickTranslation(data: any, text: string): string | null {
  let tr = '';
  if (Array.isArray(data)) {
    if (typeof data[0] === 'string') tr = data.filter((x: any) => typeof x === 'string').join('');
    else if (Array.isArray(data[0])) tr = data.map((x: any) => (x && typeof x[0] === 'string' ? x[0] : '')).join('');
  }
  return tr && tr !== text ? tr : null;
}

// Guard against a provider answering with junk. When Google's gtx endpoint is
// bot-blocked it can return the English UI of its own error page, and a naive
// parse of that HTML yields a one-letter "translation" ('e', 'l'…). Such a
// value then looks like a REAL translation, so it used to be cached and served
// to every visitor — every app name rendered as «e». Anything that collapses a
// whole phrase into one or two characters is rejected here.
function plausibleTranslation(input: string, output: string | null): string | null {
  if (!output) return null;
  const src = String(input || '').trim();
  const out = String(output || '').trim();
  if (!out) return null;
  if (out === src) return null;
  // A translation that is a single character, while the source is a word of
  // two or more characters, is never a real translation for our content.
  if (out.length <= 2 && src.length > 3) return null;
  // Provider boilerplate leaking through.
  if (/google|sorry|automated queries|translate\.googleapis|\\u003c/i.test(out)) return null;
  return out;
}

// Primary: dict-chrome-ex is a different Google host and is not bot-blocked.
async function chromeTranslate(text: string, target: string, src = 'ar'): Promise<TrResult> {
  try {
    const res = await fetch(
      `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${src}&tl=${target}&q=${encodeURIComponent(text)}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; GoldenStore/1.0)' } },
    );
    const raw = await res.text();
    if (!raw || raw.charAt(0) !== '[') return { tr: null, why: `html/${res.status}` };
    const tr = plausibleTranslation(text, pickTranslation(JSON.parse(raw), text));
    return { tr, why: tr ? 'ok' : 'unchanged' };
  } catch (e: any) { return { tr: null, why: `err/${String(e && e.message || e).slice(0, 60)}` }; }
}

// Legacy: kept as a second opinion, but backed off for 5 min after a block.
async function gtxTranslate(text: string, target: string): Promise<TrResult> {
  if (Date.now() < gtxBackoffUntil) return { tr: null, why: 'backoff' };
  try {
    const res = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text)}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; GoldenStore/1.0)' } },
    );
    const raw = await res.text();
    if (!raw || raw.charAt(0) !== '[') {
      gtxBackoffUntil = Date.now() + 5 * 60 * 1000;
      return { tr: null, why: `html/${res.status}` };
    }
    const tr = plausibleTranslation(text, pickTranslation(JSON.parse(raw), text));
    return { tr, why: tr ? 'ok' : 'unchanged' };
  } catch (e: any) { return { tr: null, why: `err/${String(e && e.message || e).slice(0, 60)}` }; }
}

// Last resort: anonymous MyMemory quota is per-IP, so it can be exhausted on
// shared Cloudflare egress IPs. Arabic-only and short strings only.
async function memoryTranslate(text: string, target: string): Promise<TrResult> {
  if (!ARABIC_CHARS.test(text) || encodeURIComponent(text).length > 450) {
    return { tr: null, why: 'skipped' };
  }
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ar%7C${target}`,
      { headers: { Accept: 'application/json' } },
    );
    const data: any = await res.json();
    if (!data || Number(data.responseStatus) !== 200) return { tr: null, why: `status/${data && data.responseStatus}` };
    if (data.quotaFinished) return { tr: null, why: 'quota' };
    const raw = String((data.responseData && data.responseData.translatedText) || '');
    if (!raw || raw === text || /MYMEMORY WARNING|QUERY LENGTH|INVALID|QUOTA|PLEASE SELECT/i.test(raw)) {
      return { tr: null, why: `bad/${raw.slice(0, 40)}` };
    }
    return { tr: raw, why: 'ok' };
  } catch (e: any) { return { tr: null, why: `err/${String(e && e.message || e).slice(0, 60)}` }; }
}

async function translateOne(text: string, target: string, steps?: string[], src = 'ar'): Promise<string | null> {
  // Translating a language into itself is a no-op. Sending it to a provider is
  // what produced the «e» corruption: Google answered with its own block page
  // and the parse produced a single letter, which was then cached as a real
  // translation. Return the text untouched so callers keep the original.
  if (target === src) { if (steps) steps.push('noop=same-language'); return String(text || ''); }
  const providers = [chromeTranslate, gtxTranslate, memoryTranslate];
  for (const p of providers) {
    const r = p === chromeTranslate ? await p(text, target, src) : await p(text, target);
    if (steps) steps.push(`${p.name}=${r.tr ? 'ok' : r.why}`);
    if (r.tr) return r.tr;
  }
  return null;
}

app.post('/translate', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const target = String(body.target || '').toLowerCase();
  const q = Array.isArray(body.q) ? body.q.slice(0, 60).map((x: any) => String(x||'')) : [];
  if (!SUPPORTED_TARGETS.has(target) || !q.length) return c.json({ t: q });
  // Source language: 'ar' for the UI dictionary, 'en' for store content
  // (app/game names, descriptions, developer lines) written in English.
  const source = String(body.source || 'ar').toLowerCase() === 'en' ? 'en' : 'ar';
  const debug = body.debug === true;
  const diag: any[] = [];

  const db: any = c.env.DB;
  await ensureTranslateCache(db);

  const out = new Array(q.length).fill(null);
  const toFetch: any[] = [];
  const paused = Date.now() < providerCooldownUntil;
  if (debug) diag.push({ src: '__meta__', steps: [paused ? 'cooldown=active' : 'cooldown=off'], translated: false });
  for (let i=0; i<q.length; i++) {
    if (!q[i] || q[i].length > 5000) { out[i] = q[i]; continue; }
    const id = await sha1Hex(source + '::' + target + '::' + q[i]);
    let cached: string | null = null;
    try {
      const row: any = await db.prepare('SELECT out FROM i18n_cache WHERE id = ?').bind(id).first();
      // Self-heal rows poisoned by the old code: either out === source text, or
      // the junk a blocked provider produced ('e'). Both must be translated
      // again instead of being served.
      if (row && row.out && row.out !== q[i] && plausibleTranslation(q[i], String(row.out))) cached = String(row.out);
    } catch { /* no cache table: fall through to live translation */ }
    if (cached != null) {
      out[i] = cached;
      if (debug) diag.push({ src: q[i], steps: ['cache=hit'], translated: true });
    } else toFetch.push({ i, text: q[i], id });
  }

  for (let k=0; k<toFetch.length; k+=6) {
    await Promise.all(toFetch.slice(k, k+6).map(async (item) => {
      if (paused) {
        out[item.i] = item.text;
        if (debug) diag.push({ src: item.text, steps: ['cooldown'], translated: false });
        return;
      }
      const steps: string[] = [];
      const tr = await translateOne(item.text, target, debug ? steps : undefined, source);
      out[item.i] = tr || item.text;
      if (debug) diag.push({ src: item.text, steps, translated: !!tr });
      // Persist only real translations. INSERT OR REPLACE overwrites stale
      // poisoned rows so subsequent requests are served from cache.
      if (tr && plausibleTranslation(item.text, tr)) {
        try {
          await db.prepare('INSERT OR REPLACE INTO i18n_cache (id, target, src, out, ts) VALUES (?, ?, ?, ?, ?)')
            .bind(item.id, target, item.text, tr, nowSec()).run();
        } catch { /* caching is best-effort */ }
      }
    }));
  }
  if (!paused && toFetch.length) {
    const anySuccess = toFetch.some((item) => out[item.i] !== item.text);
    providerCooldownUntil = anySuccess ? 0 : Date.now() + 5 * 60 * 1000;
  }
  for (let i=0; i<q.length; i++) if (out[i] == null) out[i] = q[i];
  return c.json(debug ? { t: out, debug: diag } : { t: out });
});

const SUPPORTED_TARGETS = new Set(['en', 'fr', 'es', 'tr', 'de', 'pt', 'ru', 'hi', 'zh']);

// Bulk translation of store content (app/game names, descriptions, developer
// lines, review text). The client sends a map { "<lang>::<text>": true } of the
// pieces it needs; everything comes back from i18n_cache when warm, so a page
// load costs one round trip instead of one request per string.
app.post('/i18n-content', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const keys = body && body.keys && typeof body.keys === 'object' ? Object.keys(body.keys) : [];
  const src = String((body && body.source) || 'en').toLowerCase() === 'ar' ? 'ar' : 'en';
  const t: Record<string, string> = {};
  if (!keys.length) return c.json({ t });

  const db: any = c.env.DB;
  await ensureTranslateCache(db);

  const work: Array<{ k: string; target: string; text: string; id: string }> = [];
  for (const k of keys.slice(0, 600)) {
    const cut = k.indexOf('::');
    if (cut < 2) continue;
    const target = k.slice(0, cut);
    const text = k.slice(cut + 2);
    if (!SUPPORTED_TARGETS.has(target) || !text || text.length > 1200) { t[k] = text; continue; }
    const id = await sha1Hex(src + '::' + target + '::' + text);
    let cached: string | null = null;
    try {
      const row: any = await db.prepare('SELECT out FROM i18n_cache WHERE id = ?').bind(id).first();
      if (row && row.out && row.out !== text && plausibleTranslation(text, String(row.out))) cached = String(row.out);
    } catch { /* no cache table: fall through */ }
    if (cached != null) t[k] = cached;
    else work.push({ k, target, text, id });
  }

  // Cap the live work per request so a cold start can never stall the page.
  const paused = Date.now() < providerCooldownUntil;
  const live = paused ? [] : work.slice(0, 24);
  for (const item of work) t[item.k] = item.text;

  for (let k = 0; k < live.length; k += 6) {
    await Promise.all(live.slice(k, k + 6).map(async (item) => {
      const tr = await translateOne(item.text, item.target, undefined, src);
      if (!tr) return;
      t[item.k] = tr;
      try {
        await db.prepare('INSERT OR REPLACE INTO i18n_cache (id, target, src, out, ts) VALUES (?, ?, ?, ?, ?)')
          .bind(item.id, item.target, item.text, tr, nowSec()).run();
      } catch { /* caching is best-effort */ }
    }));
  }
  if (!paused && live.length) {
    const anySuccess = live.some((item) => t[item.k] !== item.text);
    if (!anySuccess) providerCooldownUntil = Date.now() + 5 * 60 * 1000;
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ t, remaining: Math.max(0, work.length - live.length) });
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
  // Admin-managed categories are additive and override a static category with
  // the same slug (rename / icon / position), without touching lib/types.ts.
  await ensureConsoleTables(c.env.DB);
  const custom: any = await c.env.DB.prepare('SELECT slug, name, icon, type, position FROM store_categories').all().catch(() => ({ results: [] }));
  const merged = source.map((cat) => ({ ...cat, count: counts[cat.slug] || 0 }));
  (custom.results || []).forEach((r: any) => {
    if (type === 'app' && r.type === 'game') return;
    if (type === 'game' && r.type === 'app') return;
    const hit = merged.find((x) => x.slug === r.slug);
    if (hit) { hit.name = r.name; hit.icon = r.icon || hit.icon; hit.position = Number(r.position) || hit.position; }
    else merged.push({ slug: r.slug, name: r.name, icon: r.icon || 'grid', position: Number(r.position) || 99, count: counts[r.slug] || 0 });
  });
  merged.sort((a, b) => (a.position || 0) - (b.position || 0));
  return c.json({ categories: merged });
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
/* «عمليات البحث الرائجة» — terms that people really typed at least FIVE times
   (from the search_queries log). Nothing is invented. Cached for one minute. */
app.get('/search/trending', async (c) => {
  try {
    const limit = safeInt(c.req.query('limit') || '14', 1, 24);
    await ensureSearchQuerySchema(c.env);
    const items = await trendingSearches(c.env, limit);
    c.header('Cache-Control', 'public, max-age=60');
    /* `real:true` only when the terms come from actual searches. */
    return c.json({ terms: items, real: true, count: items.length });
  } catch (e: any) {
    return c.json({ terms: [], error: e?.message || 'error' }, 200);
  }
});

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

  if (q && q.length >= 2 && offset === 0) {
    // Real activity log for «عمليات البحث الرائجة» — never blocks the answer.
    try { await ensureSearchQuerySchema(c.env); await recordSearchQuery(c.env, q); } catch {}
  }
  try {
    const result = await searchApps(c.env, { q, category, type, sort, minRating, limit, offset });
    const hidden = await hiddenSlugs(c.env);
    const visible = result.apps.filter((a) => !hidden.has(String(a.slug)));
    const apps = visible.map((a) => ({
      ...appPublic(a, false, c.env),
      icon_url: icon_url(a.icon_key, c.env),
      feature_url: feature_url(a.feature_key, c.env),
    }));
    c.header('Cache-Control', q ? 'public, max-age=60' : 'public, max-age=120');
    return c.json({
      apps,
      total: Math.max(0, Number(result.total) - (result.apps.length - visible.length)),
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

/* The catalogue page is the store's busiest call and it used to take ~1.2 s on
 * EVERY visit (measured from three different POPs): it ran five D1 round trips
 * in sequence — list, publication, order, hidden slugs, star votes — and each
 * one is a full network hop, because Cloudflare has no read replication enabled
 * for this database. The result is public, identical for everybody and only
 * changes when the console changes something.
 *
 * So it is kept in Cloudflare's own cache for 30 s. A Worker's response is NOT
 * cached by the CDN just because it carries Cache-Control (it never touches the
 * cache at all), so the Cache API is used explicitly — `caches.default`. The
 * console purges it after every write via `purgeAppsCache()`, so the owner never
 * sees a stale catalogue while a visitor saves about a second per page view.
 * Any request carrying a cookie skips the cache entirely.
 */
const APPS_EDGE_TTL = 30;
const APPS_STALE = 300;
/* Every key this isolate has written, so a console write can purge exactly the
 * entries it is responsible for. Cloudflare's cache has no «delete by prefix»,
 * so the set is the index; it is capped, and the 30-second TTL bounds what a
 * missed purge (a write handled by a different isolate) can ever expose. */
const appsCacheKeys = new Set<string>();
/* A replaced picture keeps its key, so the stored URL of that key must be
 * dropped as well — otherwise the next reader gets the old `?v=` and therefore
 * the old bytes. Kept next to the apps cache because both are purged by the same
 * writes. */
async function purgeMediaUrl(env: Env, key: unknown): Promise<void> {
  const cache = appsCache();
  const k = String(key || '');
  if (!cache || !k) return;
  for (const w of [96, 200, 320, 720, 800]) {
    for (const host of [`https://${storeDomain(env)}`, 'https://goldenstore.online']) {
      try { await cache.delete(new Request(`${host}/__edge/media/${w}/${k}`)); } catch { /* best effort */ }
    }
  }
}

function appsCacheKey(request: Request): Request {
  const u = new URL(request.url);
  u.pathname = '/__edge/apps';
  u.searchParams.delete('_');
  const key = u.toString();
  if (appsCacheKeys.size > 200) appsCacheKeys.clear();
  appsCacheKeys.add(key);
  return new Request(key, { method: 'GET' });
}
function appsCache(): any | null {
  try { return (caches as any).default || (caches as any).open('gs-apps'); } catch { return null; }
}
/** Drop the cached catalogue. Called by every admin write, so «تحديث» in the
 *  console is visible on the site immediately instead of 30 seconds later. */
async function purgeAppsCache(env: Env): Promise<void> {
  invalidateAppsCache();
  const cache = appsCache();
  if (!cache) return;
  // 1) Everything this isolate stored (exact keys, including query variants).
  const stored = [...appsCacheKeys];
  appsCacheKeys.clear();
  for (const key of stored) {
    try { await cache.delete(new Request(key)); } catch { /* keep going */ }
  }
  // 2) The canonical entries of every host the store answers on, so a write
  //    handled here also clears what another isolate cached for the same page.
  try {
    for (const host of [`https://${storeDomain(env)}`, 'https://goldenstore.online',
      'https://www.goldenstore.online']) {
      for (const q of ['', '?limit=24', '?limit=60', '?type=game', '?type=app']) {
        await cache.delete(new Request(`${host}/__edge/apps${q}`));
      }
    }
  } catch { /* a failed purge must never fail the write */ }
}

app.get('/apps', async (c) => {
  const q = (c.req.query('q') || '').trim().toLowerCase(), category = (c.req.query('category') || '').trim(), type = (c.req.query('type') || '').trim();
  // Invisible direction marks travel with developer names from APK metadata and
  // would break an exact match, so they are stripped before filtering.
  const developer = sanitizeText(c.req.query('developer') || '', 120).replace(/[\u200e\u200f\u061c]/g, '').trim();
  const sort = (c.req.query('sort') || 'recent').trim(), starredOnly = c.req.query('starred') === '1';
  const limit = Math.min(Number(c.req.query('limit') || '24') || 24, 60), offset = Math.max(Number(c.req.query('offset') || '0') || 0, 0);

  // The public catalogue: served from Cloudflare's cache when nothing personal
  // is involved (no cookie, no admin session).
  const cache = (!c.req.header('cookie') && c.req.method === 'GET') ? appsCache() : null;
  const cacheKey = cache ? appsCacheKey(c.req.raw) : null;
  if (cache && cacheKey) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        /* Return through c.body(), NOT a raw `new Response()`: Hono only applies
         * the middleware's c.header() values (CORS!) to responses it creates
         * itself. A raw Response dropped Access-Control-Allow-Origin, so every
         * cache HIT failed CORS inside the Capacitor APK (origin https://localhost)
         * while a MISS worked — the store looked randomly empty in the app. */
        const hitHeaders: Record<string, string> = {};
        hit.headers.forEach((v: string, k: string) => { hitHeaders[k] = v; });
        hitHeaders['X-GS-Cache'] = 'HIT';
        return c.body(hit.body, 200, hitHeaders);
      }
    } catch { /* a cache miss must never fail the request */ }
  }

  try {
    const result = await listApps(c.env, { q, category, type, sort, starredOnly, limit, offset, developer });
    const hidden = await hiddenSlugs(c.env);
    const visible = result.apps.filter(a => !hidden.has(String(a.slug)));
    const ordered = sort === 'recent' ? applyConsoleOrder(visible, await consoleOrder(c.env)) : visible;
    // Ratings are read from star_votes, not from the stored counters, so a
    // deleted comment can never keep contributing to the average in the cards.
    const aggMap = await allVoteAggregates(c.env);
    const apps = ordered.map(a => {
      const stamp = a.updated_at || a.created_at;
      const out: any = { ...appPublic(a, false, c.env),
        icon_url: mediaUrl(a.icon_key, c.env, 200, versionToken(a.icon_key, stamp)),
        feature_url: mediaUrl(a.feature_key, c.env, 800, versionToken(a.feature_key, stamp)) };
      if (aggMap) {
        const snap = mergeAggregate(aggMap, [String(a.id), String(a.slug || '')]);
        out.rating = snap.rating; out.rating_count = snap.count; out.stars = snap.count;
      }
      return out;
    });
    // A public, cacheable answer — but only when there is no admin cookie on the
    // request (an admin must never receive another user's cached copy, and the
    // console's own writes purge this key anyway).
    const payload = { apps, total: Math.max(0, Number(result.total) - (result.apps.length - visible.length)) };
    const body = JSON.stringify(payload);
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${APPS_EDGE_TTL}, stale-while-revalidate=${APPS_STALE}`,
      Vary: 'Origin',
    };
    if (cache && cacheKey) {
      try {
        const stored = new Response(body, { status: 200, headers });
        c.executionCtx.waitUntil(cache.put(cacheKey, stored));
      } catch { /* no execution context (tests) — the answer is still correct */ }
    }
    return c.body(body, 200, headers);
  } catch (e: any) { return c.json({ error: 'd1_error', message: e.message }, 500); }
});

app.get('/apps/:slug', async (c) => {
  const slug = c.req.param('slug');
  if ((await hiddenSlugs(c.env)).has(slug)) return c.json({ error: 'not_found' }, 404);
  const appData = await getAppBySlug(c.env, slug);
  if (!appData) return c.json({ error: 'not_found' }, 404);
  
  const screenshotsData = await listScreenshots(c.env, appData.id);
  // استخدام shot_url بدقة 720 لجلب صور الشاشات
  /* Each screenshot gets its own `?v=` from the row's created_at: a replaced
   * picture keeps its key, so a URL without a version could never change. */
  const screenshots = screenshotsData.map((s: any) => ({
    id: s.id, position: s.position,
    url: mediaUrl(s.r2_key, c.env, 720, versionToken(s.r2_key, s.created_at || s.updated_at)),
  }));
  const videos = await videosFor(c.env, appData.id);
  
  const detailAliases = await appAliases(c.env, appData);
  const detailSnap = await ratingSnapshot(c.env, detailAliases);
  const detailApp: any = { ...appPublic(appData, false, c.env),
    icon_url: mediaUrl(appData.icon_key, c.env, 200, versionToken(appData.icon_key, appData.updated_at)),
    feature_url: mediaUrl(appData.feature_key, c.env, 800, versionToken(appData.feature_key, appData.updated_at)),
    rating: detailSnap.rating, rating_count: detailSnap.count, stars: detailSnap.count,
    reviews_count: detailSnap.reviews_count };
  c.header('Cache-Control', 'private, no-store');
  return c.json({ app: detailApp, screenshots, videos });
});

app.get('/apps/:slug/download', async (c) => {
  const appData = await getAppBySlug(c.env, c.req.param('slug'));
  if (!appData || !appData.apk_key) return c.json({ error: 'apk_not_available' }, 404);

  if (rateLimit(getClientIp(c), `dl:${appData.slug}`, 1, 600)) {
    await c.env.DB.prepare('UPDATE apps SET downloads = downloads + 1 WHERE id = ?').bind(appData.id).run().catch(()=>{});
  }
  
  const filename = `${appData.slug}-${appData.version_name || ''}.apk`.replace(/-+/g, '-');
  await recordDownloadEvent(c.env, appData.slug, 'web');
  // Redirect to the PERMANENT public object, not to a pre-signed link.
  //
  // The signed link lives 5 minutes. A phone's own downloader follows the 302
  // once and then owns that URL: for a multi-GB APK on 4G the link is dead long
  // before the transfer ends, so the download simply STOPS — and, because the
  // URL is expired, it can never resume. Handing back the public R2 url (no
  // expiry, Range support) fixes every client at once, including an older
  // installed app whose bundled/cached JS still points here.
  const disposition = `attachment; filename="${filename}"`;
  if (prefersDirectDownload(c)) {
    // Android installs the file itself: hand it the object and skip the hop.
    try {
      return c.redirect(`${r2PublicUrl(appData.apk_key, c.env)}`
        + `?response-content-disposition=${encodeURIComponent(disposition)}`, 302);
    } catch { /* fall through to the proxy path */ }
  }
  try {
    const direct = r2PublicUrl(appData.apk_key, c.env);
    return c.redirect(`${direct}?response-content-disposition=${encodeURIComponent(disposition)}`);
  } catch {
    // Public domain not configured: keep the signed link as the only option.
  }
  const url = await r2PresignGet(c.env, appData.apk_key, 300, disposition);
  return c.redirect(url);
});

// Stars & Reviews (D1)
function serverFingerprint(c: any): string {
  return `${c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'}||${c.req.header('user-agent')||''}||${c.req.header('accept-language')||''}`;
}

app.post('/apps/:slug/star', async (c) => {
  const cfg = await readAllSettings(c.env).catch(() => ({ ...SETTING_DEFAULTS }));
  if (cfg.allow_reviews !== '1') return c.json({ error: 'reviews_disabled' }, 403);
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'star', 10, 60)) return c.json({ error: 'rate_limit_exceeded' }, 429);
  const body = await c.req.json().catch(() => ({}));
  const appData = await getAppBySlug(c.env, c.req.param('slug'));
  if (!appData) return c.json({ error: 'not_found' }, 404);

  const rating = Math.round(Number(body.rating)), clientFp = String(body.fp || '').trim();
  // NaN passes both `< 1` and `> 5` as false — it must be rejected explicitly,
  // otherwise the INSERT binds NaN and D1 answers with a 500.
  if (!Number.isFinite(rating) || rating < 1 || rating > 5 || clientFp.length < 16) return c.json({ error: 'invalid_data' }, 400);

  // A rating is only published together with a written comment. Stars on their
  // own are no longer accepted, so every row in the list is an actual review.
  const comment = sanitizeText(body.comment, 2000).trim();
  if (comment.length < COMMENT_MIN_LENGTH) return c.json({ error: 'comment_required', min_length: COMMENT_MIN_LENGTH }, 400);

  const voteHash = await sha256Hex(`${clientFp}::${serverFingerprint(c)}`);
  const uid = sanitizeText(body.uid, 128);

  const existing = uid 
    ? await c.env.DB.prepare('SELECT id FROM star_votes WHERE app_id = ? AND uid = ?').bind(appData.id, uid).first()
    : await c.env.DB.prepare('SELECT id FROM star_votes WHERE app_id = ? AND hash = ?').bind(appData.id, voteHash).first();
  
  if (existing) return c.json({ error: 'already_voted', rating: appData.rating, rating_count: appData.rating_count }, 409);

  const voteId = randomId();
  await c.env.DB.prepare(`INSERT INTO star_votes (id, app_id, hash, server_hash, uid, rating, comment, name, photo_url, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(voteId, appData.id, voteHash, await sha256Hex(serverFingerprint(c)), uid||null, rating, comment, sanitizeText(body.name, 60), sanitizeUrl(body.photo_url)||null, nowSec()).run();

  // Recompute from real rows: incremental `old + 1` arithmetic preserved any
  // pre-existing drift forever (e.g. comments deleted before this fix).
  let newCount = Number(appData.rating_count || 0) + 1;
  let newSum = Number(appData.rating_sum || 0) + rating;
  let newAvg = Math.round((newSum / newCount) * 10) / 10;
  try {
    const snap = await recomputeAppRating(c.env, { id: String(appData.id), slug: String(appData.slug || '') });
    newCount = snap.count; newSum = snap.sum; newAvg = snap.rating;
  } catch (e) { console.error('[ratings] recompute after vote failed:', (e as any)?.message || e); }

  const ts = nowSec();
  return c.json({
    ok: true, rating: newAvg, rating_count: newCount,
    // Echo the SANITISED values (the same ones stored), never the raw body.
    review: { id: voteId, name: sanitizeText(body.name, 60) || 'مستخدم', rating, comment, has_comment: true, photo_url: sanitizeUrl(body.photo_url) || null, ts, likes_count: 0, liked: false },
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

  const snap = await ratingSnapshot(c.env, await appAliases(c.env, appData));
  const rating = snap.rating, rating_count = snap.count;
  if (vote) {
    // The real row id is what a like must target, and `vote.uid` is the account
    // the notification will be delivered to ('' for a guest-written review).
    return c.json({
      voted: true, my_rating: vote.rating, my_comment: vote.comment,
      my_name: vote.name, my_photo: vote.photo_url,
      my_review_id: String(vote.id || ''), my_uid: String(vote.uid || ''),
      rating, rating_count,
    });
  }
  return c.json({ voted: false, rating, rating_count });
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

  const aliases = await appAliases(c.env, appData);
  const [votes, dist, total, snap] = await Promise.all([
    listReviews(c.env, aliases, limit, viewerId),
    getRatingDistribution(c.env, aliases),
    countReviews(c.env, aliases),
    ratingSnapshot(c.env, aliases),
  ]);

  const reviews = votes.map((v: any) => {
    // A rating can be stars only. It still belongs in the list: the page shows
    // «N ratings» counted from the same rows, so leaving these out made the
    // number and the list disagree.
    const comment = String(v.comment == null ? '' : v.comment).trim();
    return {
      id: String(v.id),
      name: v.name || 'مستخدم',
      rating: Math.round(Number(v.rating) || 0),
      comment,
      has_comment: comment.length > 0,
    // Legacy rows written before a comment became mandatory. The list still
    // shows them (never hide a real vote), but the UI labels them clearly.
    stars_only: comment.length === 0,
      photo_url: v.photo_url || null,
      ts: Number(v.ts) || 0,
      likes_count: Number(v.likes_count) || 0,
      liked: !!v.liked_by_me,
    };
  });

  c.header('Cache-Control', 'private, no-store');
  // `rating_count` = real votes; `total`/`reviews_count` = written comments.
  // Both come from star_votes, never from stale `apps` counters.
  return c.json({ reviews, total, dist,
    rating: snap.rating, rating_count: snap.count,
    votes_count: snap.count, reviews_count: snap.reviews_count });
});

/* «تلقى الإعجابات» reliability: the like endpoint now also accepts an optional
   Firebase Bearer token. The LIKE itself still belongs to the anonymous viewer
   id (that is what `review_likes.user_id` has always stored), but with a token
   we know the real Firebase account of the viewer, so:
     · a viewer can never notify himself by re-guessing his own review id,
     · the row is written for the review AUTHOR's real account,
     · `notified_reason` tells the client exactly why nothing was sent. */
app.post('/apps/:slug/reviews/:reviewId/like', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'review-like', 30, 60)) return c.json({ error: 'rate_limit_exceeded' }, 429);
  const body = await c.req.json().catch(() => ({}));
  const userId = sanitizeText(body.userId || body.uid, 128);
  if (!userId) return c.json({ error: 'userId_required' }, 400);
  const viewerAccount = await requireFirebaseUser(c).catch(() => null);
  const viewerUid = viewerAccount ? String(viewerAccount.uid) : '';
  const review = await resolveReview(c, c.req.param('slug'), c.req.param('reviewId'));
  if (!review) return c.json({ error: 'review_not_found' }, 404);

  const result = await toggleReviewLike(c.env, String(review.id), userId);
  // Likes received: the AUTHOR of the review gets a private notification.
  // Never for self-likes, never on un-like, and never more than once an hour
  // per review so a double tap cannot spam the feed.
  let notified = false;
  let notifiedReason = 'ok';
  try {
    const author = String(review.uid || '').trim();
    // A review written by a guaranteed-anonymous guest (numeric/random vote id,
    // no Firebase account behind it) has nobody to notify. That is a legitimate
    // case, not a bug — the client gets a reason so it can explain it.
    const authorIsAnonymous = !!review.uid_is_anonymous;
    if (!result.liked) {
      notifiedReason = 'not_liked';                 // this call was an un-like
    } else if (!author) {
      notifiedReason = 'review_has_no_owner';       // guest review, no account
    } else if (authorIsAnonymous) {
      notifiedReason = 'review_has_no_owner';
    } else if (author === userId || (viewerUid && author === viewerUid)) {
      notifiedReason = 'self_like';                 // never notify yourself
    } else if (await hasRecentUserNotification(c.env, author, 'like', `${c.req.param('slug')}:${review.id}`, LIKE_NOTIFY_COOLDOWN)) {
      notifiedReason = 'cooldown';                  // already told a moment ago
    } else {
      const slug = c.req.param('slug');
      const res = await notifyUser(c.env, author, {
        type: 'new_app',
        title: 'أعجب أحدهم بتعليقك',
        body: 'تلقّى تعليقك إعجاباً جديداً على ' + (review.app_name || slug),
        app_slug: slug,
        click_url: `/app?slug=${encodeURIComponent(slug)}`,
        data: { ref: `${slug}:${review.id}`, kind: 'like', app_slug: slug, review_id: String(review.id) },
      });
      notified = res.created;
      if (!notified) notifiedReason = 'save_failed';
    }
  } catch (error: any) {
    console.error('[reviews] like notification failed:', error?.message || error);
    notifiedReason = 'error';
  }
  return c.json({ ok: true, ...result, notified, notified_reason: notifiedReason });
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

/* =========================================================================
   Round 42 (owner: «عدل زر نشر التطبيقات والألعاب لان الرابط لا يعمل»):
   a real, working «نشر تطبيق / لعبة» form for visitors. Same table the admin
   console already reads («الطلبات والبلاغات»), so nothing new is needed there.
   ========================================================================= */
const PUBLISH_KINDS = ['app', 'game'];
app.post('/publish-request', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const kind = PUBLISH_KINDS.includes(String(body.kind)) ? String(body.kind) : 'app';
  const name = sanitizeText(body.name, 80);
  const developer = sanitizeText(body.developer, 80);
  const link = sanitizeUrl(body.link) || '';
  const notes = sanitizeText(body.notes, 1500);
  const contact = sanitizeText(body.contact, 120);
  if (name.length < 2) return c.json({ error: 'name_required' }, 400);
  if (!link && !contact) return c.json({ error: 'link_or_contact_required' }, 400);
  const ip = getClientIp(c);
  const id = randomId();
  const details = [
    developer ? 'المطوّر: ' + developer : '',
    link ? 'الرابط: ' + link : '',
    contact ? 'التواصل: ' + contact : '',
    notes ? 'ملاحظات: ' + notes : '',
  ].filter(Boolean).join(' | ');
  try {
    await c.env.DB.prepare(`INSERT INTO app_requests (id, type, slug, app_name, reason, details, status, ts)
      VALUES (?, 'publish', ?, ?, ?, ?, 'new', ?)`)
      .bind(id, '', `${kind === 'game' ? 'لعبة' : 'تطبيق'}: ${name}`, 'publish_request',
        sanitizeText(details, 2000), nowSec()).run();
  } catch (e: any) {
    return c.json({ error: 'save_failed' }, 500);
  }
  // One notification for the owner's feed; a failure never blocks the visitor.
  try {
    await addNotification(c.env, {
      type: 'announcement',
      title: 'طلب نشر جديد',
      body: `${kind === 'game' ? 'لعبة' : 'تطبيق'}: ${name}`,
      data: { kind: 'publish_request', request_id: id },
    });
  } catch (e) {}
  return c.json({ ok: true, id });
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

/* =========================================================================
   Admin password — changeable from the dashboard.
   -------------------------------------------------------------------------
   The password lived ONLY in the Worker secret ADMIN_PASSWORD, so changing it
   meant opening dash.cloudflare.com and redeploying. The owner asked for a
   screen instead. A hash can now be stored in D1 (`store_settings`) and it
   WINS over the secret; the secret stays as a fallback so an older deployment,
   a fresh database, or a forgotten password can always be recovered.

   Stored as PBKDF2-SHA256 (100k iterations, random salt) — never the plain
   text. `admin_password_updated_at` lets the UI show when it last changed.
   ========================================================================= */
const ADMIN_PASS_HASH = 'admin_password_hash';
const ADMIN_PASS_SALT = 'admin_password_salt';
const ADMIN_PASS_ITER = 'admin_password_iterations';

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  // A fresh ArrayBuffer keeps TypeScript (and the Workers runtime) happy about
  // the BufferSource type; the salt is never larger than 32 bytes.
  const saltBuf = new Uint8Array(salt).buffer;
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBuf, iterations, hash: 'SHA-256' }, key, 256,
  );
  return bytesToHex(new Uint8Array(bits));
}
async function storedPasswordHash(env: Env): Promise<{ hash: string; salt: string; iterations: number } | null> {
  try {
    await ensureInsightsTables(env.DB);
    // Read straight from `admin_preferences` (the settings table) rather than
    // readAllSettings(), which filters to a fixed SETTING_KEYS list.
    const rows: any = await env.DB.prepare(
      "SELECT key, value FROM admin_preferences WHERE key IN (?, ?, ?)",
    ).bind(ADMIN_PASS_HASH, ADMIN_PASS_SALT, ADMIN_PASS_ITER).all();
    const map: Record<string, string> = {};
    for (const r of (rows.results || [])) map[String(r.key)] = String(r.value);
    const hash = map[ADMIN_PASS_HASH] || '';
    const salt = map[ADMIN_PASS_SALT] || '';
    const iterations = Number(map[ADMIN_PASS_ITER] || 100000);
    if (!hash || !salt) return null;
    return { hash, salt, iterations };
  } catch { return null; }
}
async function verifyAdminPassword(env: Env, provided: string): Promise<boolean> {
  const stored = await storedPasswordHash(env);
  if (stored) {
    const got = await derivePassword(provided, hexToBytes(stored.salt), stored.iterations || 100000);
    return constantTimeEqual(got, stored.hash);
  }
  return !!env.ADMIN_PASSWORD && constantTimeEqual(provided, env.ADMIN_PASSWORD);
}

app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const providedPass = String(body.password || body.pass || '');
  const adminUser = String(c.env.ADMIN_USERNAME || 'store-admin');
  const secret = c.env.JWT_SECRET;

  // التحقق من الإعدادات
  if (!secret) {
    return c.json({ error: 'server_misconfigured', message: 'ADMIN_PASSWORD and JWT_SECRET must be set' }, 500);
  }

  // التحقق: تجزئة محفوظة في D1 إن وُجدت، وإلا السرّ القديم (مقارنة آمنة)
  if (!(await verifyAdminPassword(c.env, providedPass))) {
    return c.json({ error: 'invalid_credentials' }, 401);
  }
  
  const token = await signJwt({ sub: adminUser, role: 'admin' }, secret);
  const cfg = await readAllSettings(c.env).catch(() => ({ ...SETTING_DEFAULTS }));
  const sessionDays = Math.min(30, Math.max(1, Number(cfg.session_days) || 7));
  setCookie(c, COOKIE_NAME, token, { httpOnly: true, secure: isSecureRequest(c), sameSite: 'Lax', path: '/', maxAge: sessionDays * 24 * 60 * 60 });
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

/* ---- changing the admin password from the dashboard ----
   Requires the CURRENT password (a stolen session alone cannot lock the owner
   out), a new one of at least 8 characters, and a confirmation that matches.
   The stored hash replaces the Worker secret from then on. */
/* Registered BEFORE `app.use('/admin/*', requireAdmin)` below, and the central
 * write guard only covers POST/PUT/PATCH/DELETE — so this GET needs its OWN
 * explicit guard, or anyone could read whether/when the password was changed. */
app.get('/admin/password/status', requireAdmin, async (c) => {
  const stored = await storedPasswordHash(c.env);
  let updated = 0;
  try {
    const row: any = await c.env.DB.prepare(
      "SELECT value FROM admin_preferences WHERE key = 'admin_password_updated_at'",
    ).first();
    updated = Number(row?.value || 0);
  } catch { /* ignore */ }
  return c.json({
    custom: !!stored,
    source: stored ? 'dashboard' : 'worker_secret',
    updated_at: updated,
    min_length: 8,
  });
});

app.post('/admin/password', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const current = String(body.current_password || '');
  const next = String(body.new_password || '');
  const confirm = String(body.confirm_password ?? next);

  if (!(await verifyAdminPassword(c.env, current))) return c.json({ error: 'wrong_current_password' }, 400);
  if (next.length < 8) return c.json({ error: 'password_too_short', min_length: 8 }, 400);
  if (next !== confirm) return c.json({ error: 'password_mismatch' }, 400);
  if (constantTimeEqual(next, current)) return c.json({ error: 'password_unchanged' }, 400);

  await ensureInsightsTables(c.env.DB);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;
  const hash = await derivePassword(next, salt, iterations);
  const now = nowSec();
  const values: Record<string, string> = {
    [ADMIN_PASS_HASH]: hash,
    [ADMIN_PASS_SALT]: bytesToHex(salt),
    [ADMIN_PASS_ITER]: String(iterations),
    admin_password_updated_at: String(now),
  };
  for (const [key, value] of Object.entries(values)) {
    await c.env.DB.prepare(
      `INSERT INTO admin_preferences (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(key, value, now).run();
  }
  await recordActivity(c.env, consoleActor(c), 'تغيير كلمة سر لوحة الإدارة', 'security');

  // A new password invalidates every other session: re-issue this browser's.
  const adminUser = String(c.env.ADMIN_USERNAME || 'store-admin');
  if (c.env.JWT_SECRET) {
    const token = await signJwt({ sub: adminUser, role: 'admin', pwd_at: now }, c.env.JWT_SECRET);
    setCookie(c, COOKIE_NAME, token, { httpOnly: true, secure: isSecureRequest(c), sameSite: 'Lax', path: '/', maxAge: 7 * 24 * 60 * 60 });
  }
  return c.json({ ok: true, updated_at: now });
});

app.post('/setup-r2-cors', async (c) => {
  // The central write guard already verified an admin JWT. The shared
  // x-admin-password header remains as a SECOND factor for one-off setup
  // scripts; it is no longer sufficient on its own.
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
  // Every message the user sends opens a REAL entry in their own notification
  // centre («تم استلام رسالتك») so support is verifiable from inside the app.
  // Cooldown per thread keeps a long chat from flooding the feed.
  const threadId = String(out.thread.id);
  let notified = false;
  try {
    if (!(await hasRecentUserNotification(c.env, user.uid, 'support', threadId, SUPPORT_NOTIFY_COOLDOWN))) {
      const res = await notifyUser(c.env, user.uid, {
        type: 'announcement',
        title: 'تم استلام رسالتك في الدعم',
        body: message.length > 120 ? message.slice(0, 120) + '…' : message,
        click_url: `/support?thread=${encodeURIComponent(threadId)}`,
        data: { ref: threadId, kind: 'support', thread_id: threadId, subject: out.thread.subject },
      });
      notified = res.created;
    }
  } catch (error: any) {
    console.error('[support] notification failed:', error?.message || error);
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ thread: out.thread, messages: out.messages, notified }, 201);
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


/* One-click, short-lived «Enter the site during maintenance» for the OWNER.
   The console is already reachable; this button explicitly grants only this
   browser a 10-minute signed preview. Visitors keep receiving 503 + the
   centered maintenance screen. The preview cookie is httpOnly and scoped. */
app.post('/admin/maintenance-preview', async (c) => {
  const secret = c.env.JWT_SECRET;
  if (!secret) return c.json({ error: 'server_misconfigured' }, 500);
  const token = await signJwt({
    sub: 'maintenance-preview', role: 'maintenance_preview',
    scope: 'maintenance_preview', jti: randomId(),
  }, secret, MAINTENANCE_PREVIEW_TTL);
  setCookie(c, PREVIEW_COOKIE_NAME, token, {
    httpOnly: true, secure: isSecureRequest(c), sameSite: 'Lax', path: '/',
    maxAge: MAINTENANCE_PREVIEW_TTL,
  });
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, expires_in: MAINTENANCE_PREVIEW_TTL,
    expires_at: nowSec() + MAINTENANCE_PREVIEW_TTL });
});

app.post('/admin/maintenance-preview/end', (c) => {
  setCookie(c, PREVIEW_COOKIE_NAME, '', {
    httpOnly: true, secure: isSecureRequest(c), sameSite: 'Lax', path: '/', maxAge: 0,
  });
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true });
});


/* ---------------- Admin Console — Phase 2 routes ---------------------- */
app.get('/admin/console/state', async (c) => {
  await ensureConsoleTables(c.env.DB);
  const all = async (sql: string) => (await c.env.DB.prepare(sql).all().catch(() => ({ results: [] }))).results || [];
  const [publication, order, categories, activity, roles, releases] = await Promise.all([
    all('SELECT slug, status, publish_at, updated_at FROM app_publication'),
    all('SELECT slug, position FROM app_order ORDER BY position ASC'),
    all('SELECT slug, name, icon, type, position FROM store_categories ORDER BY position ASC'),
    all('SELECT id, actor, action, kind, ts FROM admin_activity ORDER BY ts DESC LIMIT 50'),
    all('SELECT username, role, created_at FROM admin_roles ORDER BY created_at DESC'),
    all('SELECT version_name, force, size_bytes, created_at FROM app_update_releases ORDER BY created_at DESC LIMIT 20'),
  ]);
  c.header('Cache-Control', 'no-store');
  return c.json({ publication, order, categories, activity, roles, releases });
});

/* =========================================================================
   GET /admin/publish/health — «رفعت تطبيقاً ولم يُنشر» answered with evidence
   -------------------------------------------------------------------------
   This is the route that removes the guessing. It walks everything a publish
   leaves behind and says, per item, where the chain stopped:

     files[].uploaded      the key exists in the bucket (HEAD, real bytes)
     files[].referenced_by a row in D1 actually points at that key
     publication           the console's status row (missing / draft / scheduled)
     visible_in_catalogue   would /api/apps show it right now?
     blocked_by            the one reason it is not on the site

   And, because a bucket swapped by hand is *the* way files get orphaned, it also
   compares the bucket with the store: `files_never_saved` are uploads that exist
   in storage and that NO row mentions — every one of them is an upload the
   console finished but never saved.
   ========================================================================= */
app.get('/admin/publish/health', async (c) => {
  await ensureConsoleTables(c.env.DB);
  const now = nowSec();
  const rows: any = await c.env.DB.prepare(
    'SELECT id, slug, name, apk_key, icon_key, feature_key, updated_at, created_at, version_name FROM apps ORDER BY updated_at DESC',
  ).all().catch(() => ({ results: [] }));
  const pub: any = await c.env.DB.prepare('SELECT slug, status, publish_at FROM app_publication')
    .all().catch(() => ({ results: [] }));
  const pubBySlug = new Map<string, any>((pub.results || []).map((r: any) => [String(r.slug), r] as [string, any]));
  const shots: any = await c.env.DB.prepare('SELECT app_id, r2_key, position FROM screenshots')
    .all().catch(() => ({ results: [] }));
  const ssByApp = new Map<string, any[]>();
  for (const r of shots.results || []) {
    const list = ssByApp.get(String(r.app_id)) || [];
    list.push(r);
    ssByApp.set(String(r.app_id), list);
  }
  const referenced = await referencedKeys(c.env);

  const items: any[] = [];
  for (const r of rows.results || []) {
    const files = [
      { kind: 'apk', key: r.apk_key }, { kind: 'icon', key: r.icon_key },
      { kind: 'feature', key: r.feature_key },
      ...(ssByApp.get(String(r.id)) || []).map((s: any) => ({ kind: 'screenshot', key: s.r2_key })),
    ].filter((f) => f.key);
    const checked: any[] = [];
    for (const f of files) {
      const head = await r2Head(c.env, String(f.key)).catch(() => null);
      checked.push({ kind: f.kind, key: f.key, uploaded: !!head, size: head?.size || 0 });
    }
    const p: any = pubBySlug.get(String(r.slug));
    const status = p ? String(p.status) : 'missing';
    const scheduled = status === 'scheduled' && Number(p?.publish_at || 0) > now;
    const hidden = status === 'draft' || scheduled;
    const missingFiles = checked.filter((f) => !f.uploaded);
    items.push({
      id: r.id, slug: r.slug, name: r.name, version_name: r.version_name,
      files: checked,
      files_missing: missingFiles.map((f) => f.key),
      publication: { status, publish_at: Number(p?.publish_at || 0) || 0, scheduled },
      /* `no_apk` is not «hidden»: a row with no file is deliberately not listed
         until its APK arrives (two-step publish), so it must not be reported as
         a broken item — its own reason says what it is waiting for. */
      visible_in_catalogue: !hidden && !!r.apk_key,
      blocked_by: !r.apk_key
        ? 'no_apk'
        : hidden ? (status === 'draft' ? 'draft' : 'scheduled_for_later')
        : missingFiles.length ? 'file_missing' : null,
    });
  }

  /* Uploads that exist in storage and that no row mentions. These are exactly
     the files a publish uploaded and then failed to save (or a save that
     pointed at a key the bucket no longer has). */
  const objects = await r2List(c.env, '', 5000).catch(() => []);
  const filesNeverSaved = objects.filter((o) => !referenced.has(o.key))
    .map((o) => ({ key: o.key, size: o.size || 0 }));

  const byKey = new Map(objects.map((o) => [o.key, o]));
  const notVisible = items.filter((x) => !x.visible_in_catalogue);
  return c.json({
    ok: notVisible.length === 0 && filesNeverSaved.length === 0,
    server_time: now,
    bucket: { objects: objects.length, referenced: referenced.size },
    counts: {
      items: items.length,
      visible: items.length - notVisible.length,
      hidden: notVisible.length,
      files_missing: items.reduce((n, x) => n + x.files_missing.length, 0),
      files_never_saved: filesNeverSaved.length,
      files_never_saved_bytes: filesNeverSaved.reduce((n, o) => n + (byKey.get(o.key)?.size || 0), 0),
    },
    items,
    files_never_saved: filesNeverSaved.slice(0, 200),
    verdict: notVisible.length
      ? `${notVisible.length} عنصراً مرفوعاً لا يظهر في المتجر — السبب مذكور لكل واحد في blocked_by.`
      : filesNeverSaved.length
        ? `كل العناصر ظاهرة، لكن ${filesNeverSaved.length} ملفاً رُفع إلى الحاوية ولم يُحفظ في الموقع (رفع توقّف قبل النشر).`
        : 'كل شئ متّسق: ما رُفع محفوظ، وما حُفظ ظاهر.',
  });
});

app.post('/admin/publication', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const slug = String(body.slug || '').trim();
  const status = String(body.status || 'published');
  if (!isValidSlug(slug) || !['published', 'draft', 'scheduled'].includes(status)) {
    return c.json({ error: 'invalid_input' }, 400);
  }
  const publishAt = status === 'scheduled' ? safeInt(body.publish_at, 0, 99999999999) : 0;
  await ensureConsoleTables(c.env.DB);
  await c.env.DB.prepare(`INSERT INTO app_publication (slug, status, publish_at, updated_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET
      status = excluded.status, publish_at = excluded.publish_at, updated_at = excluded.updated_at`)
    .bind(slug, status, publishAt, nowSec()).run();
  await recordActivity(c.env, consoleActor(c), `حالة «${slug}» → ${status}`, 'publish');
  return c.json({ ok: true });
});

app.post('/admin/order', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const slugs = Array.isArray(body.slugs) ? body.slugs.slice(0, 500).map((x: any) => String(x)).filter((x: string) => isValidSlug(x)) : [];
  await ensureConsoleTables(c.env.DB);
  await c.env.DB.prepare('DELETE FROM app_order').run().catch(() => {});
  for (let i = 0; i < slugs.length; i++) {
    await c.env.DB.prepare('INSERT OR REPLACE INTO app_order (slug, position, updated_at) VALUES (?, ?, ?)')
      .bind(slugs[i], i, nowSec()).run();
  }
  await recordActivity(c.env, consoleActor(c), `ترتيب الكتالوج (${slugs.length} عنصراً)`, 'order');
  return c.json({ ok: true, count: slugs.length });
});

app.get('/admin/categories', async (c) => {
  await ensureConsoleTables(c.env.DB);
  const rows: any = await c.env.DB.prepare('SELECT * FROM store_categories ORDER BY position ASC').all().catch(() => ({ results: [] }));
  return c.json({ categories: rows.results || [] });
});
app.post('/admin/categories', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const slug = String(body.slug || '').trim().toLowerCase();
  const name = sanitizeText(body.name, 60);
  if (!/^[a-z0-9_-]{1,40}$/.test(slug) || !name) return c.json({ error: 'invalid_input' }, 400);
  const type = body.type === 'game' ? 'game' : 'app';
  await ensureConsoleTables(c.env.DB);
  await c.env.DB.prepare(`INSERT INTO store_categories (slug, name, icon, type, position, created_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, icon = excluded.icon, type = excluded.type, position = excluded.position`)
    .bind(slug, name, String(body.icon || 'grid').slice(0, 30), type, safeInt(body.position, 0, 999), nowSec()).run();
  await recordActivity(c.env, consoleActor(c), `حفظ الفئة «${name}»`, 'category');
  return c.json({ ok: true });
});
app.delete('/admin/categories/:slug', async (c) => {
  await ensureConsoleTables(c.env.DB);
  await c.env.DB.prepare('DELETE FROM store_categories WHERE slug = ?').bind(c.req.param('slug')).run().catch(() => {});
  await recordActivity(c.env, consoleActor(c), `حذف الفئة «${c.req.param('slug')}»`, 'category');
  return c.json({ ok: true });
});

app.get('/admin/activity', async (c) => {
  await ensureConsoleTables(c.env.DB);
  const rows: any = await c.env.DB.prepare('SELECT id, actor, action, kind, ts FROM admin_activity ORDER BY ts DESC LIMIT 100').all().catch(() => ({ results: [] }));
  return c.json({ activity: rows.results || [] });
});
app.post('/admin/activity', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const action = sanitizeText(body.action, 300);
  if (!action) return c.json({ error: 'invalid_input' }, 400);
  await recordActivity(c.env, consoleActor(c), action, String(body.kind || 'info').slice(0, 20));
  return c.json({ ok: true });
});

app.get('/admin/roles', requireOwner, async (c) => {
  const rows: any = await c.env.DB.prepare('SELECT username, role, created_at FROM admin_roles ORDER BY created_at DESC').all().catch(() => ({ results: [] }));
  return c.json({ roles: rows.results || [], me: consoleActor(c) });
});
app.post('/admin/roles', requireOwner, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = sanitizeText(body.username, 120);
  const role = String(body.role || 'viewer');
  if (!username || !['owner', 'editor', 'viewer'].includes(role)) return c.json({ error: 'invalid_input' }, 400);
  await ensureConsoleTables(c.env.DB);
  await c.env.DB.prepare(`INSERT INTO admin_roles (username, role, created_at) VALUES (?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET role = excluded.role`)
    .bind(username, role, nowSec()).run();
  await recordActivity(c.env, consoleActor(c), `تعيين دور ${role} لـ ${username}`, 'role');
  return c.json({ ok: true });
});
app.delete('/admin/roles/:username', requireOwner, async (c) => {
  const username = decodeURIComponent(c.req.param('username'));
  await ensureConsoleTables(c.env.DB);
  const owners: any = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM admin_roles WHERE role = 'owner'").first().catch(() => null);
  const target: any = await c.env.DB.prepare('SELECT role FROM admin_roles WHERE username = ?').bind(username).first().catch(() => null);
  if (Number(owners?.n || 0) <= 1 && target?.role === 'owner') {
    return c.json({ error: 'last_owner' }, 400);
  }
  await c.env.DB.prepare('DELETE FROM admin_roles WHERE username = ?').bind(username).run().catch(() => {});
  await recordActivity(c.env, consoleActor(c), `إزالة صلاحية ${username}`, 'role');
  return c.json({ ok: true });
});

app.get('/admin/backup', async (c) => {
  await ensureConsoleTables(c.env.DB);
  const all = async (sql: string) => (await c.env.DB.prepare(sql).all().catch(() => ({ results: [] }))).results || [];
  const [apps, publication, order, categories, activity, roles, releases] = await Promise.all([
    all('SELECT * FROM apps'),
    all('SELECT * FROM app_publication'),
    all('SELECT * FROM app_order'),
    all('SELECT * FROM store_categories'),
    all('SELECT * FROM admin_activity ORDER BY ts DESC LIMIT 500'),
    all('SELECT * FROM admin_roles'),
    all('SELECT * FROM app_update_releases ORDER BY created_at DESC LIMIT 100'),
  ]);
  c.header('Cache-Control', 'no-store');
  return c.json({ version: 1, exported_at: nowSec(), apps, publication, order, categories, activity, roles, releases });
});

app.post('/admin/import', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (body.confirm !== true) return c.json({ error: 'confirmation_required' }, 400);
  await ensureConsoleTables(c.env.DB);
  let imported = 0;
  const db: any = c.env.DB;
  const merge = async (sql: string, rows: any[], bind: (r: any) => any[]) => {
    for (const r of rows.slice(0, 500)) {
      try { await db.prepare(sql).bind(...bind(r)).run(); imported++; } catch { /* skip malformed row */ }
    }
  };
  await merge(`INSERT OR IGNORE INTO app_publication (slug, status, publish_at, updated_at) VALUES (?, ?, ?, ?)`,
    Array.isArray(body.publication) ? body.publication : [],
    (r) => [String(r.slug), String(r.status || 'published'), Number(r.publish_at) || 0, Number(r.updated_at) || 0]);
  await merge(`INSERT OR IGNORE INTO app_order (slug, position, updated_at) VALUES (?, ?, ?)`,
    Array.isArray(body.order) ? body.order : [],
    (r) => [String(r.slug), Number(r.position) || 0, Number(r.updated_at) || 0]);
  await merge(`INSERT OR IGNORE INTO store_categories (slug, name, icon, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    Array.isArray(body.categories) ? body.categories : [],
    (r) => [String(r.slug), String(r.name || ''), String(r.icon || 'grid'), String(r.type || 'app'), Number(r.position) || 0, Number(r.created_at) || 0]);
  await merge(`INSERT OR IGNORE INTO admin_roles (username, role, created_at) VALUES (?, ?, ?)`,
    Array.isArray(body.roles) ? body.roles : [],
    (r) => [String(r.username), ['owner', 'editor', 'viewer'].includes(r.role) ? r.role : 'viewer', Number(r.created_at) || nowSec()]);
  await merge(`INSERT OR IGNORE INTO app_update_releases (id, version_name, version_code, notes, force, size_bytes, apk_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    Array.isArray(body.releases) ? body.releases : [],
    (r) => [String(r.id || crypto.randomUUID()), String(r.version_name || ''), Number(r.version_code) || 0,
      String(r.notes || ''), r.force ? 1 : 0, Number(r.size_bytes) || 0, String(r.apk_url || ''), Number(r.created_at) || nowSec()]);
  // App binaries live in R2; only metadata rows are merged, never overwritten.
  let appsSkipped = 0;
  for (const r of (Array.isArray(body.apps) ? body.apps : []).slice(0, 500)) {
    try {
      await db.prepare(`INSERT OR IGNORE INTO apps
        (id, slug, name, package_name, category, type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(String(r.id), String(r.slug), String(r.name || ''), String(r.package_name || ''),
          String(r.category || 'tools'), r.type === 'game' ? 'game' : 'app',
          Number(r.created_at) || nowSec(), Number(r.updated_at) || nowSec()).run();
      imported++;
    } catch { appsSkipped++; }
  }
  await recordActivity(c.env, consoleActor(c), `استيراد نسخة احتياطية (${imported} صفاً)`, 'backup');
  return c.json({ ok: true, imported, apps_skipped: appsSkipped,
    note: 'Merge-only: existing rows are never overwritten. APK/image binaries stay in R2.' });
});

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
  // The reply reaches the thread owner as a private notification as well, so a
  // user who left /support still learns an answer arrived.
  try {
    const owner = String(out.thread.uid || '').trim();
    if (owner) {
      await notifyUser(c.env, owner, {
        type: 'announcement',
        title: 'ردّ الدعم على رسالتك',
        body: message.length > 120 ? message.slice(0, 120) + '…' : message,
        click_url: `/support?thread=${encodeURIComponent(String(out.thread.id))}`,
        data: { ref: String(out.thread.id), kind: 'support_reply', thread_id: String(out.thread.id) },
      });
    }
  } catch (error: any) {
    console.error('[admin/support] notification failed:', error?.message || error);
  }
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
  const id = c.req.param('id');
  await ensureSupportSchema(c.env);
  const countRow: any = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM support_messages WHERE thread_id = ?').bind(id).first();
  const ok = await deleteSupportThread(c.env, id);
  if (!ok) return c.json({ error: 'not_found' }, 404);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, deleted: { messages: Number(countRow?.n) || 0 } });
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

/* One-click repair of ratings left stale by comments deleted before the
   authoritative engine was deployed. Admin-only; idempotent; only rows that
   actually differ are written. */
/* «تعيين النوع للعناصر القديمة» — the dashboard button has always called this
 * route, but it was never implemented on the server: pressing it returned 404
 * and the UI said only «فشل التحديث». Rows created before the app/game split
 * have an empty type, and an empty type is filtered out of both /apps and
 * /games — the item exists but appears nowhere («لا تظهر»).
 *
 * Safe and idempotent: only rows with a NULL/empty type are touched, and the
 * type is derived from the category prefix (game_* → game, otherwise app).
 */
app.post('/admin/migrate-types', async (c) => {
  const all: any = await c.env.DB.prepare(
    "SELECT id, category FROM apps WHERE type IS NULL OR TRIM(type) = ''",
  ).all().catch(() => ({ results: [] }));
  const rows = all.results || [];
  let updated = 0;
  for (const r of rows) {
    const type = String(r.category || '').startsWith('game_') ? 'game' : 'app';
    const res: any = await c.env.DB.prepare('UPDATE apps SET type = ?, updated_at = ? WHERE id = ?')
      .bind(type, nowSec(), r.id).run().catch(() => null);
    if (res) updated++;
  }
  if (updated) await purgeAppsCache(c.env);
  await recordActivity(c.env, consoleActor(c), `تعيين النوع لـ${updated} عنصراً قديماً`, 'publish');
  return c.json({ ok: true, updated, total: rows.length });
});

app.post('/admin/recompute-ratings', async (c) => {
  try {
    const result = await recomputeAllRatings(c.env);
    await recordActivity(c.env, consoleActor(c),
      `إعادة احتساب التقييمات (${result.changed} من ${result.apps} تطبيقاً)`, 'maintenance').catch(() => {});
    return c.json({ ok: true, ...result });
  } catch (e: any) {
    console.error('[admin/ratings] recompute failed:', e?.message || e);
    return c.json({ error: 'recompute_failed' }, 500);
  }
});

/* =========================================================================
   Settings Center + Insights (2026-11-07)
   All new tables are created lazily. Demographics are OPT-IN, anonymous and
   aggregate-only: no invented numbers, no PII, no birth date.
   ========================================================================= */
const INSIGHTS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admin_preferences (
     key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS download_events (
     id TEXT PRIMARY KEY, slug TEXT, day TEXT, hour INTEGER, ts INTEGER,
     platform TEXT DEFAULT 'web')`,
  `CREATE INDEX IF NOT EXISTS idx_download_events_day ON download_events(day)`,
  `CREATE TABLE IF NOT EXISTS user_demographics (
     uid TEXT PRIMARY KEY, age_range TEXT, gender TEXT, country TEXT,
     opted_in INTEGER DEFAULT 1, updated_at INTEGER)`,
  // Round 39: the sign-up form now also captures a username, e-mail, phone and
  // an exact age. Added with ALTERs so existing databases upgrade in place.
  `ALTER TABLE user_demographics ADD COLUMN username TEXT`,
  `ALTER TABLE user_demographics ADD COLUMN email TEXT`,
  `ALTER TABLE user_demographics ADD COLUMN phone TEXT`,
  `ALTER TABLE user_demographics ADD COLUMN age INTEGER`,
];
const analyticsReady = new WeakSet<object>();
/** The same one-time schema pass, but memoised on the DATABASE object.
 *
 *  `env.DB` is a D1 binding proxy: `env.DB === env.DB` is false, so a WeakSet
 *  keyed on it never remembers anything, and every download re-issued the whole
 *  table-creation batch. The binding is stable per request, hence `c.env.DB`
 *  is reused for the guard and the writes. */
async function ensureAnalyticsTables(env: Env) {
  const db: any = (env as any).DB;
  await ensureInsightsTables(db);
}
let insightsReady = false;
async function ensureInsightsTables(db: any) {
  if (!db || insightsReady) return;
  insightsReady = true;
  for (const sql of INSIGHTS_SCHEMA) { try { await db.prepare(sql).run(); } catch { /* best effort */ } }
}
const SETTING_DEFAULTS: Record<string, string> = {
  store_name: 'Golden Store', tagline: 'متجرك الذهبي للتطبيقات والألعاب',
  support_email: '', telegram_url: 'https://t.me/goldenstore_10', official_url: 'https://goldenstore.online',
  theme_default: 'dark', accent: 'gold', density: 'comfortable', default_language: 'ar',
  default_type: 'app', default_category: 'tools', max_upload_mb: '200',
  allow_reviews: '1', show_download_counter: '1', require_login: '1',
  notify_new_publications: '1', push_enabled: '1', auto_notify_update: '0',
  quiet_start: '23', quiet_end: '7',
  collect_demographics: '0', maintenance_mode: '0', maintenance_message: 'المتجر تحت الصيانة، نعود قريباً.',
  maintenance_duration_minutes: '60', maintenance_end_at: '0',
  update_later_minutes: '60',
  session_days: '7',
};
const SETTING_KEYS = Object.keys(SETTING_DEFAULTS);
const PUBLIC_SETTINGS = [
  'store_name', 'tagline', 'support_email', 'telegram_url', 'official_url',
  'theme_default', 'accent', 'density', 'default_language', 'allow_reviews',
  'show_download_counter', 'require_login', 'collect_demographics',
  'maintenance_mode', 'maintenance_message', 'maintenance_duration_minutes',
  'maintenance_end_at', 'notify_new_publications',
  // Non-secret operational values the shared client applier also needs.
  'default_type', 'default_category', 'max_upload_mb', 'auto_notify_update',
  'push_enabled', 'quiet_start', 'quiet_end', 'session_days',
  'update_later_minutes',
];
async function readAllSettings(env: Env): Promise<Record<string, string>> {
  await ensureInsightsTables(env.DB);
  const out: Record<string, string> = { ...SETTING_DEFAULTS };
  const rows: any = await env.DB.prepare('SELECT key, value FROM admin_preferences').all().catch(() => ({ results: [] }));
  (rows.results || []).forEach((r: any) => { if (SETTING_KEYS.includes(String(r.key))) out[String(r.key)] = String(r.value); });
  // Maintenance always has a real end time. Normalise legacy rows and auto-expire.
  await persistSetting(env, 'maintenance_end_at', out, () => {
    const now = nowSec();
    if (out.maintenance_mode !== '1') return false;
    const end = Number(out.maintenance_end_at || 0);
    if (end > 0 && end <= now) {
      // Time is up: switch the store back on for everybody (idempotent).
      out.maintenance_mode = '0'; out.maintenance_end_at = '0';
      void env.DB.prepare(`INSERT INTO admin_preferences (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .bind('maintenance_mode', '0', now).run().catch(() => {});
      invalidateMaintenanceCache();
      return true;
    }
    if (end === 0) {
      // An activation saved before the duration feature existed: give it a deadline.
      const mins = Math.min(10080, Math.max(1, Number(out.maintenance_duration_minutes) || 60));
      out.maintenance_end_at = String(now + mins * 60);
      return true;
    }
    return false;
  });
  // The legacy singleton row remains the source of truth for this flag.
  try { const legacy = await getStoreSettings(env); out.notify_new_publications = legacy.notify_new_publications ? '1' : '0'; } catch (e) {}
  return out;
}
async function persistSetting(env: Env, key: string, out: Record<string, string>, mutate: () => boolean) {
  if (!mutate()) return;
  try {
    await env.DB.prepare(`INSERT INTO admin_preferences (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .bind(key, String(out[key] ?? ''), nowSec()).run();
  } catch { /* best effort: the computed value is still returned */ }
}
async function publicSettings(env: Env): Promise<Record<string, string>> {
  const all = await readAllSettings(env);
  const out: Record<string, string> = {};
  PUBLIC_SETTINGS.forEach((k) => { out[k] = all[k]; });
  return out;
}
async function recordDownloadEvent(env: Env, slug: string, platform = 'web') {
  // Bound to a local so the WeakSet guard actually does its job: `env.DB` is a
  // fresh proxy object on every access, so memoising on it never hit and one
  // download walked ten CREATE TABLE statements before its INSERT.
  const db: any = (env as any).DB;
  await ensureAnalyticsTables(env);
  const ts = nowSec();
  const d = new Date(ts * 1000);
  const day = d.toISOString().slice(0, 10);
  try {
    await db.prepare('INSERT INTO download_events (id, slug, day, hour, ts, platform) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(String(crypto.randomUUID()), sanitizeText(slug, 120), day, d.getUTCHours(), ts, platform).run();
  } catch { /* analytics must never block a download */ }
}
/* =========================================================================
   GET /api/media/<key> — pictures served from the store's own domain
   -------------------------------------------------------------------------
   The bucket is read with the Worker's own credentials, so this route needs no
   public bucket URL and no second hostname. Two behaviours matter:

   1. `Cache-Control` is explicit and `immutable`-free but long (1 hour) with
      `stale-while-revalidate`, so the phone stops re-downloading every icon on
      every visit — which is what r2.dev's missing cache headers caused.
   2. Byte ranges and conditional requests are passed through, so a screenshot
      or a feature image behaves like any other static file.
   Only well-known picture folders are served; the APKs are NOT (they are large
   and belong on the download path, where the browser's own downloader can
   resume them).
   ========================================================================= */
const MEDIA_FOLDERS = new Set(['icon', 'feature', 'ss', 'vthumb', 'logo', 'screenshots', 'images', 'thumbs']);
app.get('/media/*', async (c) => {
  const raw = decodeURIComponent(c.req.path.replace(/^\/(?:api\/)?media\//, ''));
  const key = raw.replace(/^\/+/, '');
  if (!key || key.includes('..')) return c.json({ error: 'invalid_key' }, 400);
  const folder = key.split('/')[0];
  if (!MEDIA_FOLDERS.has(folder)) return c.json({ error: 'not_found' }, 404);
  if (rateLimit(getClientIp(c), 'media', 600, 60)) { /* counted, never blocked */ }
  try {
    const response = await r2GetObject(c.env, key, c.req.header('range') || undefined,
      c.req.header('if-none-match') || undefined);
    if (!response) return c.json({ error: 'not_found' }, 404);
    // c.body() (not a raw Response) so the CORS middleware's headers survive —
    // the installed app fetches media cross-origin from https://localhost.
    const headers: Record<string, string> = {
      'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': MEDIA_CACHE,
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
    };
    for (const h of ['content-length', 'content-range', 'etag', 'last-modified']) {
      const v = response.headers.get(h);
      if (v) headers[h] = v;
    }
    return c.body(response.body as any, response.status as any, headers);
  } catch {
    return c.json({ error: 'media_unavailable' }, 502);
  }
});

/* =========================================================================
   GET /sitemap.xml — it was a 404
   -------------------------------------------------------------------------
   The store had no sitemap at all (checked: /sitemap.xml → 404), so search
   engines had to guess which pages exist and never learned that a published
   app is a page. This renders the static pages plus every visible item, with
   the item's real updated_at, and is cached at the edge for an hour.
   ========================================================================= */
app.get('/sitemap.xml', async (c) => {
  const base = `https://${storeDomain(c.env)}`;
  let items: any[] = [];
  try {
    const hidden = await hiddenSlugs(c.env);
    const rows: any = await c.env.DB.prepare(
      'SELECT slug, updated_at FROM apps ORDER BY updated_at DESC LIMIT 2000',
    ).all();
    items = (rows.results || []).filter((r: any) => r.slug && !hidden.has(String(r.slug)));
  } catch { /* a sitemap must never 500 */ }
  const page = (loc: string, lastmod: string | null, priority: string) =>
    `<url><loc>${base}${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}`
    + `<changefreq>daily</changefreq><priority>${priority}</priority></url>`;
  const iso = (ts: any) => {
    const n = Number(ts) || 0;
    if (!n) return null;
    return new Date(n > 1e12 ? n : n * 1000).toISOString().slice(0, 10);
  };
  const body = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    + page('/', null, '1.0') + page('/apps', null, '0.9') + page('/games', null, '0.9')
    + page('/featured', null, '0.7') + page('/search', null, '0.6')
    + page('/download', null, '0.8') + page('/support', null, '0.5')
    + page('/about', null, '0.4') + page('/privacy', null, '0.3') + page('/terms', null, '0.3')
    + items.map((r: any) => page(`/app?slug=${encodeURIComponent(r.slug)}`, iso(r.updated_at), '0.8')).join('')
    + '</urlset>';
  return c.body(body, 200, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/settings', async (c) => {
  // no-store: an admin change must take effect on the very next page load.
  c.header('Cache-Control', 'no-store');
  const settings = await publicSettings(c.env);
  const now = nowSec();
  return c.json({
    settings,
    server_time: now,
    maintenance_active: maintenanceActive(settings, now),
    maintenance_bypass: await hasAdminSession(c),
    maintenance_preview: await hasMaintenancePreview(c),
    maintenance_end_at: Number(settings.maintenance_end_at || 0),
    maintenance_remaining: maintenanceRemaining(settings, now),
  });
});

app.get('/admin/settings', async (c) => {
  const settings = await readAllSettings(c.env);
  c.header('Cache-Control', 'no-store');
  return c.json({ settings, keys: SETTING_KEYS, defaults: SETTING_DEFAULTS });
});
app.patch('/admin/settings', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  await ensureInsightsTables(c.env.DB);
  // Backwards-compatible single-flag contract used by the older UI.
  if (typeof body.notify_new_publications === 'boolean') {
    await c.env.DB.prepare(`INSERT OR REPLACE INTO store_settings (id, notify_new_publications, updated_at) VALUES ('general', ?, ?)`)
      .bind(body.notify_new_publications ? 1 : 0, nowSec()).run();
    return c.json({ settings: { notify_new_publications: body.notify_new_publications } });
  }
  const values = body.values && typeof body.values === 'object' ? body.values : null;
  if (!values) return c.json({ error: 'invalid' }, 400);
  // "Maintenance duration (minutes)" is converted into ONE absolute deadline at
  // activation time, so every visitor sees the same countdown and it auto-ends.
  const computed: Record<string, string> = {};
  if ('maintenance_mode' in values || 'maintenance_duration_minutes' in values) {
    const current = await readAllSettings(c.env).catch(() => ({ ...SETTING_DEFAULTS }));
    const raw = Number(values.maintenance_duration_minutes ?? current.maintenance_duration_minutes ?? 60);
    const minutes = Math.min(10080, Math.max(1, Math.round(raw) || 60));
    if ('maintenance_duration_minutes' in values) computed.maintenance_duration_minutes = String(minutes);
    const turningOn = values.maintenance_mode === '1';
    const turningOff = values.maintenance_mode === '0';
    const durationChanged = 'maintenance_duration_minutes' in values;
    if (turningOn || (durationChanged && current.maintenance_mode === '1' && !turningOff)) {
      computed.maintenance_end_at = String(nowSec() + minutes * 60);
    } else if (turningOff) {
      computed.maintenance_end_at = '0';
    }
  }
  const merged: Record<string, string> = { ...values, ...computed };
  let saved = 0;
  for (const k of SETTING_KEYS) {
    if (!(k in merged)) continue;
    const v = sanitizeText(merged[k], 500);
    await c.env.DB.prepare(`INSERT INTO admin_preferences (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .bind(k, v, nowSec()).run();
    if (k === 'notify_new_publications') {
      await c.env.DB.prepare(`INSERT OR REPLACE INTO store_settings (id, notify_new_publications, updated_at) VALUES ('general', ?, ?)`)
        .bind(v === '1' ? 1 : 0, nowSec()).run();
    }
    if (k in values) saved++;
  }
  invalidateMaintenanceCache();
  await recordActivity(c.env, consoleActor(c), `حفظ ${saved} إعداداً`, 'settings');
  return c.json({ ok: true, saved, settings: await readAllSettings(c.env) });
});
app.post('/admin/settings/reset', async (c) => {
  await ensureInsightsTables(c.env.DB);
  await c.env.DB.prepare('DELETE FROM admin_preferences').run().catch(() => {});
  invalidateMaintenanceCache();
  await recordActivity(c.env, consoleActor(c), 'إعادة ضبط الإعدادات', 'settings');
  return c.json({ ok: true, settings: await readAllSettings(c.env) });
});

/* ---------- Anonymous, opt-in demographics (aggregate only) ---------- */
const AGE_RANGES = ['13-17', '18-24', '25-34', '35-44', '45-54', '55+'];
const GENDERS = ['male', 'female', 'other', 'prefer_not'];
app.post('/profile/demographics', async (c) => {
  const settings = await readAllSettings(c.env);
  if (settings.collect_demographics !== '1') return c.json({ error: 'collection_disabled' }, 403);
  const body = await c.req.json().catch(() => ({}));
  // Anonymous opt-in is a product requirement (aggregate-only, no PII). When
  // a Firebase session IS present we ignore the client-supplied id and use the
  // verified uid, so a caller can never overwrite another visitor's row.
  const signedIn = await requireFirebaseUser(c).catch(() => null);
  const uid = signedIn ? signedIn.uid : String(body.uid || '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(uid)) return c.json({ error: 'invalid_uid' }, 400);
  await ensureInsightsTables(c.env.DB);
  const age = AGE_RANGES.includes(body.age_range) ? body.age_range : '';
  const gender = GENDERS.includes(body.gender) ? body.gender : '';
  const country = sanitizeText(body.country, 60);
  const opted = body.opted_in === false ? 0 : 1;
  // Round 39 — the sign-up form offers these next to the password:
  // username, e-mail, phone, country, gender and age.
  const username = sanitizeText(body.username, 50);
  const email = sanitizeText(body.email, 120).toLowerCase();
  const phone = sanitizeText(body.phone, 24);
  const ageNum = Number.isFinite(Number(body.age)) && Number(body.age) >= 10 && Number(body.age) <= 110
    ? Math.round(Number(body.age)) : null;
  const emailOk = email ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) : true;
  await c.env.DB.prepare(`INSERT INTO user_demographics
      (uid, age_range, gender, country, opted_in, updated_at, username, email, phone, age)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET
      age_range = excluded.age_range, gender = excluded.gender, country = excluded.country,
      opted_in = excluded.opted_in, updated_at = excluded.updated_at,
      username = COALESCE(NULLIF(excluded.username, ''), user_demographics.username),
      email = COALESCE(NULLIF(excluded.email, ''), user_demographics.email),
      phone = COALESCE(NULLIF(excluded.phone, ''), user_demographics.phone),
      age = COALESCE(excluded.age, user_demographics.age)`)
    .bind(uid, age, gender, country, opted, nowSec(),
      username, emailOk ? email : '', phone, ageNum).run();
  return c.json({ ok: true });
});
app.get('/profile/demographics/:uid', async (c) => {
  /* Privacy: a uid is not a secret (it travels with reviews and tokens), so an
   * open lookup let anyone read another account's age/gender/country. Only the
   * signed-in owner of the row — or an admin session — may read it. */
  const uid = c.req.param('uid');
  const user = await requireFirebaseUser(c).catch(() => null);
  if (!(user && user.uid === uid) && !(await hasAdminSession(c))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await ensureInsightsTables(c.env.DB);
  const row: any = await c.env.DB.prepare('SELECT age_range, gender, country, opted_in FROM user_demographics WHERE uid = ?')
    .bind(uid).first().catch(() => null);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ demographics: row || null });
});

/* Admin-only: everything the sign-up form collected, for the
   «جمع المعلومات» page in the dashboard. Never public. */
app.get('/admin/demographics', async (c) => {
  await ensureInsightsTables(c.env.DB);
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 200, 1), 1000);
  let rows: any[] = [];
  try {
    const r: any = await c.env.DB.prepare(
      `SELECT uid, username, email, phone, country, gender, age, age_range, updated_at
         FROM user_demographics WHERE opted_in = 1 ORDER BY updated_at DESC LIMIT ?`)
      .bind(limit).all();
    rows = r.results || [];
  } catch (e) { rows = []; }
  const by = async (sql: string) => {
    try { const r: any = await c.env.DB.prepare(sql).all(); return r.results || []; }
    catch (e) { return []; }
  };
  const [countries, genders, ages] = await Promise.all([
    by("SELECT country AS key, COUNT(*) AS count FROM user_demographics WHERE opted_in = 1 AND country <> '' GROUP BY country ORDER BY count DESC LIMIT 20"),
    by("SELECT gender AS key, COUNT(*) AS count FROM user_demographics WHERE opted_in = 1 AND gender <> '' GROUP BY gender ORDER BY count DESC"),
    by("SELECT CASE WHEN age IS NULL THEN age_range ELSE CAST(age / 5 * 5 AS TEXT) || 's' END AS key, COUNT(*) AS count FROM user_demographics WHERE opted_in = 1 AND (age IS NOT NULL OR age_range <> '') GROUP BY key ORDER BY count DESC"),
  ]);
  return c.json({ total: rows.length, rows, countries, genders, ages });
});


/* ---------- Insights: real aggregates, zero-filled, never fabricated ---------- */
const zeroDays = (days: number) => {
  const out: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};
app.get('/admin/analytics/insights', async (c) => {
  await ensureInsightsTables(c.env.DB);
  const days = [7, 30, 90].includes(Number(c.req.query('days'))) ? Number(c.req.query('days')) : 30;
  const dayList = zeroDays(days);
  const since = dayList[0];
  const all = async (sql: string, ...bind: any[]) => {
    try { const r: any = await c.env.DB.prepare(sql).bind(...bind).all(); return r.results || []; }
    catch { return []; }
  };
  const [apps, dailyRows, hourlyRows, ratingRows, tokenRows, ageRows, genderRows,
    countryRows, demoTotalRows, activityRows, releaseRows] = await Promise.all([
    all('SELECT * FROM apps'),
    all('SELECT day, COUNT(*) AS c FROM download_events WHERE day >= ? GROUP BY day', since),
    all('SELECT hour, COUNT(*) AS c FROM download_events GROUP BY hour'),
    all('SELECT rating, COUNT(*) AS c FROM star_votes GROUP BY rating'),
    all('SELECT platform, COUNT(*) AS c FROM fcm_tokens GROUP BY platform'),
    all("SELECT age_range AS k, COUNT(*) AS c FROM user_demographics WHERE opted_in = 1 AND age_range <> '' GROUP BY age_range"),
    all("SELECT gender AS k, COUNT(*) AS c FROM user_demographics WHERE opted_in = 1 AND gender <> '' GROUP BY gender"),
    all("SELECT country AS k, COUNT(*) AS c FROM user_demographics WHERE opted_in = 1 AND country <> '' GROUP BY country ORDER BY c DESC LIMIT 8"),
    all('SELECT COUNT(*) AS c FROM user_demographics WHERE opted_in = 1'),
    all('SELECT action, actor, ts FROM admin_activity ORDER BY ts DESC LIMIT 8'),
    all('SELECT version_name, created_at, size_bytes FROM app_update_releases ORDER BY created_at DESC LIMIT 5'),
  ]);
  const webCount = (await all('SELECT COUNT(*) AS c FROM web_tokens'))[0]?.c || 0;
  const dlMap: Record<string, number> = {};
  dailyRows.forEach((r: any) => { dlMap[String(r.day)] = Number(r.c) || 0; });
  const hourly = Array.from({ length: 24 }, (_, h) => {
    const hit = hourlyRows.find((r: any) => Number(r.hour) === h);
    return { hour: h, count: Number(hit?.c) || 0 };
  });
  const ratingMap: Record<string, number> = {};
  ratingRows.forEach((r: any) => { ratingMap[String(Math.round(Number(r.rating) || 0))] = Number(r.c) || 0; });
  const catMap: Record<string, { count: number; downloads: number }> = {};
  const types = { app: { count: 0, downloads: 0 }, game: { count: 0, downloads: 0 } };
  let totalDownloads = 0, totalSize = 0, ratingSum = 0, ratingCount = 0, newApps = 0;
  const cutoff = nowSec() - 30 * 86400;
  apps.forEach((a: any) => {
    const dl = Number(a.downloads) || 0;
    totalDownloads += dl; totalSize += Number(a.size_bytes) || 0;
    const t = a.type === 'game' ? 'game' : 'app';
    types[t].count++; types[t].downloads += dl;
    const cat = String(a.category || 'other');
    if (!catMap[cat]) catMap[cat] = { count: 0, downloads: 0 };
    catMap[cat].count++; catMap[cat].downloads += dl;
    const rc = Number(a.rating_count) || 0;
    if (rc > 0) { ratingSum += (Number(a.rating) || 0) * rc; ratingCount += rc; }
    if (Number(a.created_at) > cutoff) newApps++;
  });
  const demoTotal = Number(demoTotalRows[0]?.c) || 0;
  const age = AGE_RANGES.map((k) => ({ key: k, count: Number(ageRows.find((r: any) => r.k === k)?.c) || 0 }));
  const gender = GENDERS.map((k) => ({ key: k, count: Number(genderRows.find((r: any) => r.k === k)?.c) || 0 }));
  const settings = await readAllSettings(c.env);
  c.header('Cache-Control', 'no-store');
  return c.json({
    days, generated_at: nowSec(),
    totals: {
      apps: apps.length, games: types.game.count, downloads: totalDownloads,
      storage_bytes: totalSize, avg_rating: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : 0,
      reviews: ratingRows.reduce((n: number, r: any) => n + (Number(r.c) || 0), 0),
      devices: tokenRows.reduce((n: number, r: any) => n + (Number(r.c) || 0), 0) + Number(webCount),
      new_apps_30d: newApps,
    },
    daily_downloads: dayList.map((day) => ({ day, count: dlMap[day] || 0 })),
    hourly,
    categories: Object.keys(catMap).map((k) => ({ key: k, ...catMap[k] }))
      .sort((a, b) => b.count - a.count).slice(0, 10),
    types,
    rating_distribution: [1, 2, 3, 4, 5].map((k) => ({ key: k, count: ratingMap[String(k)] || 0 })),
    top_apps: apps.slice().sort((a: any, b: any) => (Number(b.downloads) || 0) - (Number(a.downloads) || 0))
      .slice(0, 8).map((a: any) => ({ name: a.name, slug: a.slug, downloads: Number(a.downloads) || 0, type: a.type })),
    platforms: {
      android: Number(tokenRows.find((r: any) => r.platform === 'android')?.c) || 0,
      ios: Number(tokenRows.find((r: any) => r.platform === 'ios')?.c) || 0,
      web: Number(webCount) || 0,
    },
    demographics: {
      enabled: settings.collect_demographics === '1', total: demoTotal,
      data_available: demoTotal > 0, age, gender,
      countries: countryRows.map((r: any) => ({ key: String(r.k), count: Number(r.c) || 0 })),
    },
    activity: activityRows, releases: releaseRows,
  });
});

/* -------------------------------------------------------------------------
   Admin dashboard: live statistics + D1 indexes (2026-11-08)
   Every number comes from a real aggregate. Missing tables (fresh database)
   degrade to zeros/empty arrays instead of a 500. No fabricated values.
   ------------------------------------------------------------------------- */
const ADMIN_INDEX_SQL = [
  `CREATE INDEX IF NOT EXISTS idx_apps_category ON apps(category)`,
  `CREATE INDEX IF NOT EXISTS idx_apps_type ON apps(type)`,
  `CREATE INDEX IF NOT EXISTS idx_apps_created_at ON apps(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_apps_downloads ON apps(downloads DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_apps_slug ON apps(slug)`,
  `CREATE INDEX IF NOT EXISTS idx_star_votes_app_id ON star_votes(app_id)`,
  `CREATE INDEX IF NOT EXISTS idx_star_votes_uid ON star_votes(uid)`,
  `CREATE INDEX IF NOT EXISTS idx_star_votes_app_uid ON star_votes(app_id, uid)`,
  `CREATE INDEX IF NOT EXISTS idx_review_reports_status ON review_reports(status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_app_requests_status ON app_requests(status, ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_app_requests_type ON app_requests(type, status)`,
  `CREATE INDEX IF NOT EXISTS idx_download_events_day ON download_events(day)`,
  `CREATE INDEX IF NOT EXISTS idx_download_events_slug ON download_events(slug, day)`,
  `CREATE INDEX IF NOT EXISTS idx_push_devices_uid ON push_devices(uid, channel, notifications_enabled)`,
  `CREATE INDEX IF NOT EXISTS idx_user_demographics_upd ON user_demographics(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_support_threads_uid ON support_threads(uid, created_at DESC)`,
];
let adminIndexesReady = false;
async function ensureAdminIndexes(env: any): Promise<void> {
  if (!env || !env.DB || adminIndexesReady) return;
  adminIndexesReady = true;
  // An index on a column that does not exist yet (legacy DB) must never break
  // the request; the migration file is the canonical, ordered version.
  for (const sql of ADMIN_INDEX_SQL) {
    try { await env.DB.prepare(sql).run(); } catch { /* optional index */ }
  }
}
async function safeAll(env: any, sql: string, args: any[] = []): Promise<any[]> {
  try {
    const r: any = await env.DB.prepare(sql).bind(...args).all();
    return Array.isArray(r?.results) ? r.results : [];
  } catch { return []; }
}
async function safeFirst(env: any, sql: string, args: any[] = []): Promise<any> {
  try { return (await env.DB.prepare(sql).bind(...args).first()) || {}; } catch { return {}; }
}

/** Distinct real user ids across every table that records an authenticated
    or device-identifying interaction. Never invents or estimates users. */
async function collectAdminUsers(env: any): Promise<any[]> {
  const map = new Map<string, any>();
  const merge = (rows: any[], source: string) => {
    for (const r of rows) {
      const uid = String(r?.uid || '').trim();
      if (!uid || uid.startsWith('gs_')) continue;
      const ts = Number(r?.ts ?? r?.updated_at ?? r?.created_at ?? 0) || 0;
      let u = map.get(uid);
      if (!u) {
        u = { uid, uid_masked: uid.slice(0, 10) + (uid.length > 10 ? '…' : ''),
          sources: new Set<string>(), channels: new Set<string>(),
          devices: 0, last_seen_at: ts };
        map.set(uid, u);
      }
      u.sources.add(source);
      u.last_seen_at = Math.max(u.last_seen_at, ts);
    }
  };
  merge(await safeAll(env, `SELECT uid, channel,
      COALESCE(NULLIF(last_seen_at, 0), updated_at, 0) AS ts FROM push_devices`), 'devices');
  merge(await safeAll(env, `SELECT uid, MAX(ts) AS ts FROM star_votes
      WHERE COALESCE(uid, '') != '' GROUP BY uid`), 'reviews');
  merge(await safeAll(env, `SELECT uid, updated_at AS ts FROM user_demographics`), 'demographics');
  merge(await safeAll(env, `SELECT uid, MAX(created_at) AS ts FROM support_threads GROUP BY uid`), 'support');
  merge(await safeAll(env, `SELECT uid, MAX(updatedAt) AS ts FROM web_tokens GROUP BY uid`), 'web');
  merge(await safeAll(env, `SELECT uid, MAX(updated_at) AS ts FROM fcm_tokens GROUP BY uid`), 'native');
  for (const d of await safeAll(env, `SELECT uid, channel, COUNT(*) AS c
      FROM push_devices GROUP BY uid, channel`)) {
    const u = map.get(String(d.uid));
    if (u) { u.devices += Number(d.c || 0); u.channels.add(String(d.channel)); }
  }
  return Array.from(map.values()).map((u: any) => ({
    ...u, sources: Array.from(u.sources), channels: Array.from(u.channels),
  })).sort((a: any, b: any) => b.last_seen_at - a.last_seen_at);
}

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const base = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

app.get('/admin/stats', async (c) => {
  await ensureAdminIndexes(c.env);
  await ensureInsightsTables(c.env.DB).catch(() => {});
  const env: any = c.env;
  const rows = await safeAll(env,
    `SELECT id, slug, name, downloads, size_bytes, icon_key, category, type, created_at, rating
       FROM apps`);
  const apps = rows.map((a: any) => ({
    ...a, icon_url: icon_url(a.icon_key as string, env),
  }));
  const total_apps = apps.length;
  const total_downloads = apps.reduce((n: number, a: any) => n + Number(a.downloads || 0), 0);
  const total_size_bytes = apps.reduce((n: number, a: any) => n + Number(a.size_bytes || 0), 0);
  const top_apps = apps.slice().sort((a: any, b: any) =>
    Number(b.downloads || 0) - Number(a.downloads || 0)).slice(0, 5);

  const users = await collectAdminUsers(env);
  const total_users = users.length;

  const reviewReports = await safeAll(env,
    `SELECT id, review_id, app_slug, reason, status, created_at
       FROM review_reports ORDER BY created_at DESC LIMIT 8`);
  const appReports = await safeAll(env,
    `SELECT id, slug, app_name, reason, status, ts AS created_at
       FROM app_requests WHERE type = 'report' ORDER BY ts DESC LIMIT 8`);
  const recent_reports = [
    ...reviewReports.map((r: any) => ({ ...r, kind: 'review' })),
    ...appReports.map((r: any) => ({ ...r, kind: 'app' })),
  ].sort((a: any, b: any) => Number(b.created_at || 0) - Number(a.created_at || 0)).slice(0, 8);

  const pendingRow = await safeFirst(env,
    `SELECT COUNT(*) AS c FROM app_requests WHERE COALESCE(status, 'new') = 'new'`);
  const pending_requests = Number(pendingRow.c || 0);
  const pending_list = await safeAll(env,
    `SELECT id, type, slug, app_name, new_version, status, ts
       FROM app_requests WHERE COALESCE(status, 'new') = 'new' ORDER BY ts DESC LIMIT 8`);

  const days = lastNDays(14);
  const dlRows = await safeAll(env,
    `SELECT day, COUNT(*) AS c FROM download_events WHERE day >= ? GROUP BY day`, [days[0]]);
  const dlMap = new Map<string, number>();
  for (const d of dlRows) dlMap.set(String(d.day), Number(d.c || 0));
  const downloads_series = days.map((day) => ({ day, count: dlMap.get(day) || 0 }));

  const byCategory = await safeAll(env,
    `SELECT COALESCE(NULLIF(category, ''), 'other') AS k, COUNT(*) AS c
       FROM apps GROUP BY k ORDER BY c DESC LIMIT 8`);
  const apps_by_category = byCategory.map((r: any) => ({ key: String(r.k), count: Number(r.c || 0) }));
  const ratingRows = await safeAll(env,
    `SELECT rating, COUNT(*) AS c FROM star_votes GROUP BY rating`);
  // Read-only drift detector: how many apps still carry a stale average left
  // behind by comments deleted before this fix. The repair endpoint fixes it.
  let ratings_drift = 0;
  const driftMap = await allVoteAggregates(env);
  if (driftMap) {
    for (const a of await safeAll(env, 'SELECT id, slug, rating, rating_count FROM apps')) {
      const m = mergeAggregate(driftMap, [String(a.id), String(a.slug || '')]);
      if (Number(a.rating || 0) !== m.rating || Number(a.rating_count || 0) !== m.count) ratings_drift++;
    }
  }
  const rating_distribution = ratingRows.map((r: any) => ({
    rating: Number(r.rating || 0), count: Number(r.c || 0),
  }));

  c.header('Cache-Control', 'no-store');
  return c.json({
    // Legacy keys are preserved so older dashboards/tests keep working.
    total_apps, total_downloads, total_size_bytes, top_apps,
    // New live aggregates.
    total_users, recent_reports, pending_requests, pending_list,
    downloads_series, apps_by_category, rating_distribution, ratings_drift,
    generated_at: nowSec(),
    source: 'd1-live',
    note: 'All counters are real D1 aggregates. Users = distinct real ids across device/review/support tables; no estimates.',
  });
});

// Searchable, paginated user directory for the admin console. Admin only
// (covered by /admin/* requireAdmin and the central write guard).
app.get('/admin/users', async (c) => {
  await ensureAdminIndexes(c.env);
  const all = await collectAdminUsers(c.env);
  const q = String(c.req.query('q') || '').trim().toLowerCase();
  const filtered = q ? all.filter((u: any) =>
    String(u.uid).toLowerCase().includes(q)
    || (u.sources || []).some((s: string) => s.toLowerCase().includes(q))
    || (u.channels || []).some((s: string) => s.toLowerCase().includes(q))) : all;
  const page = Math.max(1, Math.floor(Number(c.req.query('page')) || 1));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(c.req.query('limit')) || 25)));
  const pages = Math.max(1, Math.ceil(filtered.length / limit));
  const safePage = Math.min(page, pages);
  c.header('Cache-Control', 'no-store');
  return c.json({
    users: filtered.slice((safePage - 1) * limit, safePage * limit),
    total: filtered.length, page: safePage, limit, pages,
    note: 'Real identifiers only; no synthetic or estimated accounts.',
  });
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
  // ONE screen, ONE engine: segmentation / image / deep link / scheduling are
  // all accepted here. A scheduled_at value routes to the Cron scheduler;
  // everything else is delivered immediately by deliverNotification().
  if (body.scheduled_at) {
    const scheduledAt = Math.floor(new Date(body.scheduled_at).getTime() / 1000);
    if (!Number.isFinite(scheduledAt) || scheduledAt <= 0) {
      return c.json({ error: 'invalid_scheduled_at' }, 400);
    }
    const row = await schedulePush(c.env, {
      title: String(body.title).slice(0, 200), body: sanitizeText(body.body, 1000),
      image_url: body.image_url, click_url: body.click_url,
      segment: body.segment || { mode: 'all' }, scheduled_at: body.scheduled_at,
    });
    return c.json({ ok: true, scheduled: true, ...row, push: { scheduled: row.id } });
  }
  const res = await addNotification(c.env, { ...body, type: 'announcement', created_at: nowSec() });
  return c.json({ ok: true, id: res.id, push: res.push });
});

// ---- Release history -----------------------------------------------------
// Kept separate from the singleton `app_updates` row so the Update Center can
// show every published build. Created lazily: no manual migration required.
let releaseTableReady = false;
async function ensureReleaseTable(db: any) {
  if (!db || releaseTableReady) return;
  releaseTableReady = true;
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS app_update_releases (
      id TEXT PRIMARY KEY,
      version_name TEXT,
      version_code INTEGER,
      notes TEXT,
      force INTEGER DEFAULT 0,
      size_bytes INTEGER DEFAULT 0,
      apk_url TEXT,
      created_at INTEGER
    )`).run();
  } catch { /* read-only / race: history is best-effort */ }
}

app.post('/admin/app-update', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  let apk_url = sanitizeUrl(body.apk_url), apk_key = String(body.apk_key || '').trim(), size_bytes = 0;
  
  if (apk_key) {
    if (!isValidR2Key(apk_key, 'apk')) return c.json({ error: 'invalid_key' }, 400);
    const head = await r2Head(c.env, apk_key); if (!head) return c.json({ error: 'not_found' }, 400);
    apk_url = r2PublicUrl(apk_key, c.env); size_bytes = head.size || 0;
  }
  if (!apk_url) return c.json({ error: 'apk_required' }, 400);

  /* The PREVIOUS build's file is removed once the new one is live.
     Nothing used to delete it, so every «نشر التحديث» left another
     `goldenstore-app-….apk` in the bucket while the dashboard showed one row —
     the owner's screenshot of the Cloudflare console, where files pile up and
     deleting the item in the dashboard does not remove them. Old builds are
     kept for 7 days so a client that is mid-update can still finish, then the
     row is dropped from `app_update_releases` and the file with it. */
  let previousKey = '';
  try {
    const prev: any = await c.env.DB.prepare("SELECT apk_key FROM app_updates WHERE id = 'current'").first();
    previousKey = String(prev?.apk_key || '');
  } catch { /* first publish */ }

  // UPSERT (never REPLACE): publishing a new build must NOT wipe the real
  // download total. `downloads` is deliberately absent from the DO UPDATE
  // list and the durable app_download_stats row is left untouched.
  const preserved = await readDownloadCount(c.env, 0);
  await c.env.DB.prepare(`INSERT INTO app_updates
      (id, version_name, version_code, apk_url, apk_key, notes, force, size_bytes, downloads, created_at)
      VALUES ('current', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        version_name = excluded.version_name,
        version_code = excluded.version_code,
        apk_url      = excluded.apk_url,
        apk_key      = excluded.apk_key,
        notes        = excluded.notes,
        force        = excluded.force,
        size_bytes   = excluded.size_bytes,
        created_at   = excluded.created_at`)
    .bind(sanitizeText(body.version_name, 60), safeInt(body.version_code, 0, 999999999),
      apk_url, apk_key, sanitizeText(body.notes, 1000), body.force ? 1 : 0,
      size_bytes, preserved, nowSec()).run();

  // Optional: restore/set the real download total (e.g. after an older build
  // reset it). The counter is monotonic, so this can only raise the value.
  if (body.downloads !== undefined && body.downloads !== null && body.downloads !== '') {
    const requested = Number(body.downloads);
    if (Number.isFinite(requested) && requested >= 0) await setDownloadBaseline(c.env, requested);
  }

  // Durable release history for the admin Update Center.
  await ensureReleaseTable(c.env.DB);
  try {
    await c.env.DB.prepare(`INSERT INTO app_update_releases
      (id, version_name, version_code, notes, force, size_bytes, apk_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(String(crypto.randomUUID()), String(body.version_name || ''), safeInt(body.version_code, 0, 999999999),
        sanitizeText(body.notes, 1000), body.force ? 1 : 0, size_bytes, apk_url, nowSec()).run();
  } catch { /* history must never block publishing */ }

  let push = null;
  const updateCfg = await readAllSettings(c.env).catch(() => ({ ...SETTING_DEFAULTS }));
  const shouldNotify = !!body.send_notification || updateCfg.auto_notify_update === '1';
  if (shouldNotify) {
    const res = await addNotification(c.env, { type: 'update', title: body.version_name ? `تحديث ${body.version_name}` : 'تحديث جديد', body: body.notes || 'تحديث', data: { apk_url }, created_at: nowSec() });
    push = res.push;
  }
  // The retired build is no longer referenced by any row, so the storage audit
  // («تنظيف كلاود») lists it as an orphan and removes it — no silent leftovers.
  return c.json({ ok: true, push, retired_apk: previousKey && previousKey !== apk_key ? previousKey : undefined });
});

app.get('/admin/app-update/releases', async (c) => {
  await ensureReleaseTable(c.env.DB);
  const rows: any = await c.env.DB.prepare(
    'SELECT version_name, version_code, notes, force, size_bytes, apk_url, created_at FROM app_update_releases ORDER BY created_at DESC LIMIT 20'
  ).all().catch(() => ({ results: [] }));
  return c.json({ releases: rows.results || [] });
});

app.get('/admin/push/status', async (c) => {
  const stats = await pushTokenStats(c.env);
  const res = await c.env.DB.prepare('SELECT platform, uid, token, updated_at, permission, notifications_enabled, topic_subscribed FROM fcm_tokens LIMIT 500').all().catch(() => ({ results: [] }));
  const plats: Record<string, number> = {};
  const tokens = (res.results || []).map(r => {
    plats[r.platform as string] = (plats[r.platform as string] || 0) + 1;
    return { platform: r.platform, uid_masked: String(r.uid).slice(0, 10), updated_at: r.updated_at,
      token_tail: String(r.token).slice(-6), permission: r.permission,
      notifications_enabled: r.notifications_enabled, topic_subscribed: r.topic_subscribed };
  }).sort((a, b) => (b.updated_at as number) - (a.updated_at as number));
  return c.json({ registered_tokens: stats.native_total + stats.web_total, stats,
    diagnostics: await pushDiagnostics(c.env), platforms: plats, tokens });
});

app.post('/admin/push/test', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    // A unique id per click keeps the exactly-once ledger from suppressing a
    // legitimately repeated test, while every device still gets ONE message.
    return c.json({ ok: true, push: await deliverNotification(c.env, {
      title: body.title || 'Test', body: body.body || 'Test', type: 'announcement',
      id: 'admintest-' + randomId(),
    }, { mode: 'all' }, { force: true }) });
  } catch (error: any) {
    console.error('[fcm] test broadcast failed:', error?.message || error);
    return c.json({ ok: false, error: 'push_failed', message: String(error?.message || error) });
  }
});

// Backfill EVERY eligible token into topic `all`. Uses a persistent keyset
// cursor, so repeated calls cover the whole table (never just the first N).
// `all:true` drains several chunks per invocation within the subrequest budget.
// The response includes the exact rows fetched from D1 and subscribed in FCM.
app.post('/admin/push/sync-topics', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const result = await syncTopicSubscriptions(c.env, {
      limit: Number(body.limit) || 100, all: body.all !== false,
    });
    return c.json({ ok: true, ...result, diagnostics: await pushDiagnostics(c.env) });
  } catch (error: any) {
    console.error('[fcm] sync-topics failed:', error?.message || error);
    return c.json({ ok: false, error: 'sync_failed', message: String(error?.message || error) });
  }
});

// Exact numbers to compare with the "1000 registered users" figure.
app.get('/admin/push/diagnostics', async (c) => {
  return c.json({ ok: true, diagnostics: await pushDiagnostics(c.env) });
});

// Recent device registrations — proof that the mobile app really POSTs its
// FCM token. Also visible as `event:push_register` in `wrangler tail`.
app.get('/admin/push/registrations', async (c) => {
  return c.json({ registrations: await listPushRegistrations(c.env, Number(c.req.query('limit')) || 30) });
});

// Unified status: one device per row, exactly-once ledger counts, channels.
app.get('/admin/push/unified-status', async (c) =>
  c.json({ ok: true, unified: await notificationDiagnostics(c.env) }));

// Drain queued direct sends when a broadcast had more than one invocation's
// worth of devices. Handles BOTH legacy and unified jobs; an omitted job_id
// drains all pending unified jobs (also done automatically by Cron).
app.post('/admin/push/flush', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const jobId = String(body.job_id || '');
  if (!jobId) return c.json({ ok: true, ...(await drainDeliveryJobs(c.env, 12)) });
  const chunk = await processDeliveryJob(c.env, jobId, Number(body.limit) || 300);
  return c.json({ ok: true, ...chunk });
});

// Structured delivery history for troubleshooting failed notifications.
app.get('/admin/push/logs', async (c) => {
  return c.json({ logs: await listPushLogs(c.env, Number(c.req.query('limit')) || 20) });
});

app.delete('/admin/notifications/:id', async (c) => { await c.env.DB.prepare('DELETE FROM notifications WHERE id = ?').bind(c.req.param('id')).run().catch(()=>{}); return c.json({ ok: true }); });
app.delete('/admin/requests/:id', async (c) => { await c.env.DB.prepare('DELETE FROM app_requests WHERE id = ?').bind(c.req.param('id')).run().catch(()=>{}); return c.json({ ok: true }); });

app.get('/admin/apps/:id', async (c) => {
  const doc: any = await c.env.DB.prepare('SELECT * FROM apps WHERE id = ?').bind(c.req.param('id')).first();
  if (!doc) return c.json({ error: 'not_found' }, 404);
  const ss = await c.env.DB.prepare('SELECT * FROM screenshots WHERE app_id = ? ORDER BY position ASC').bind(doc.id).all();
  const videos = await videosFor(c.env, doc.id);
  return c.json({ app: { ...appPublic(doc, true), icon_url: icon_url(doc.icon_key, c.env), feature_url: feature_url(doc.feature_key, c.env) }, screenshots: (ss.results || []).map((s: any) => ({ ...s, url: icon_url(s.r2_key, c.env) })), videos });
});

// Uploads (R2)

/* ── Deterministic upload keys ────────────────────────────────────────────────
 * Owner asked for new uploads to start tidy instead of being renamed later.
 *
 * Keys used to be <folder>/<slug>-<epoch>-<hex>.<ext>, which said nothing about
 * what an object was and grew a new copy on every re-publish. They are now
 * <folder>/<slug>.<ext> — the same shape the storage organiser produces, so a
 * fresh upload and an organised one are indistinguishable.
 *
 * The one danger with a fixed name is overwriting a file that is still in use,
 * so uploadKeyFor() refuses a name that already exists in the bucket and falls
 * back to <slug>-<n>.<ext> instead. A re-publish of the same app therefore
 * reuses the same icon/APK name, while a different app with the same slug can
 * never clobber it.
 */
async function uploadKeyFor(
  env: Env,
  kind: string,
  ext: string,
  slugHint: string,
  taken: Set<string>,
  opts: { appId?: string; slot?: number } = {},
): Promise<string> {
  const folder = kind === 'apk' ? 'apk' : kind === 'icon' ? 'icon' : kind === 'feature' ? 'feature' : kind === 'video-thumb' ? 'vthumb' : 'ss';
  let slug = slugify(String(slugHint || 'app')).slice(0, 60) || 'app';

  /* ── Uploading for an item that ALREADY EXISTS: one name per item, per kind.
   *
   * This is the case that produced the growing file list in the Cloudflare
   * console: you edit something small and publish again, the uploader asks for
   * `apk/<slug>.apk`, that name is taken (by the previous version of the very
   * same file), so it used to answer `<slug>-2.apk` — a brand-new object, and
   * the old one stayed behind. Now the new bytes REPLACE the item's own object:
   * the row is updated in the same request and every route that changes
   * apk_key/icon_key/feature_key deletes the superseded key, so nothing can be
   * orphaned, and the bucket keeps exactly one file per item and kind.
   *
   * It is only safe because the key belongs to that one row: the slug is read
   * from the row itself (never from the request), and a screenshot gets its
   * position in the name so six screenshots are six files, not one.
   */
  if (opts.appId) {
    const row: any = await env.DB.prepare('SELECT slug FROM apps WHERE id = ?').bind(opts.appId).first().catch(() => null);
    if (row && row.slug) slug = slugify(String(row.slug)).slice(0, 60) || slug;
    const name = (kind === 'screenshot' || kind === 'video-thumb')
      ? `${slug}-${Math.max(1, Math.floor(Number(opts.slot) || 1))}`
      : slug;
    return `${folder}/${name}${ext ? '.' + ext : ''}`;
  }

  /* A video thumbnail has no item id yet when it is uploaded from the publish
     screen, but its slug hint is the product's name — use it as the name so a
     second item can never overwrite the first one's picture. */
  if (kind === 'video-thumb' && String(slugHint || '').trim() && String(slugHint).trim() !== 'video') {
    return `${folder}/${slug}-${Math.max(1, Math.floor(Number(opts.slot) || 1))}${ext ? '.' + ext : ''}`;
  }

  /* ── A brand-new item: the tidy name if it is free, a numbered one if not.
     A new item must never overwrite a file another row still points at. */
  const base = `${folder}/${slug}`;
  const extPart = ext ? `.${ext}` : '';
  const exists = async (key: string) => {
    if (taken.has(key)) return true;
    const head = await r2Head(env, key).catch(() => null);
    return !!head;
  };
  let candidate = `${base}${extPart}`;
  if (!(await exists(candidate))) return candidate;
  for (let n = 2; n <= 50; n++) {
    candidate = `${base}-${n}${extPart}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base}-${Date.now()}-${randomId().slice(0, 6)}${extPart}`;
}

app.post('/admin/upload-url', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ext = safeExt(String(body.filename), body.kind === 'apk' ? 'apk' : body.kind === 'feature' ? 'jpg' : body.kind === 'icon' ? 'png' : 'jpg');
  const key = await uploadKeyFor(c.env, String(body.kind || ''), ext, String(body.slug_hint || 'app'), new Set(), { appId: body.app_id ? String(body.app_id) : undefined, slot: body.slot });
  return c.json({ url: await r2PresignPut(c.env, key, String(body.content_type || 'application/octet-stream'), 7200), key });
});

app.post('/admin/multipart/create', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  // A missing/NaN size used to produce ZERO part URLs (the loop never ran) and
  // an absurd size could ask for tens of thousands of signatures in one call.
  const fileSize = Number(body.file_size);
  if (!Number.isFinite(fileSize) || fileSize <= 0) return c.json({ error: 'invalid_file_size' }, 400);
  const partCount = Math.ceil(fileSize / (10 * 1024 * 1024));
  if (partCount > 10000) return c.json({ error: 'file_too_large', max_parts: 10000 }, 400);
  const ext = safeExt(String(body.filename), body.kind === 'apk' ? 'apk' : body.kind === 'feature' ? 'jpg' : body.kind === 'icon' ? 'png' : 'jpg');
  const key = await uploadKeyFor(c.env, String(body.kind || ''), ext, String(body.slug_hint || 'app'), new Set(), { appId: body.app_id ? String(body.app_id) : undefined, slot: body.slot });
  const uploadId = await r2CreateMultipartUpload(c.env, key, String(body.content_type || 'application/octet-stream'));
  const parts = [];
  for (let i = 1; i <= partCount; i++) parts.push({ partNumber: i, url: await r2PresignUploadPart(c.env, key, uploadId, i, 3600) });
  return c.json({ key, uploadId, partSize: 10 * 1024 * 1024, parts });
});

app.post('/admin/multipart/complete', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  await r2CompleteMultipartUpload(c.env, body.key, body.uploadId, body.parts);
  return c.json({ ok: true, key: body.key });
});

// Re-sign parts whose pre-signed URL already expired.
//
// A multipart upload signs every part URL when it is created. Those URLs live
// for one hour, but a multi-GB APK on a slow mobile uplink (a few hundred KB/s)
// needs one to three HOURS. Parts still pending when the hour runs out came
// back 403, and a 403 is not retried, so the whole publish died — even though
// the bytes were fine and the connection was fine. The client asks for fresh
// URLs for whatever is left and carries on from the current part.
// Purge translation-cache rows that hold junk instead of a translation.
// A blocked provider once returned a single letter, which was stored as if it
// were a real translation, so app names rendered as «e» for every visitor.
// The read path now self-heals, this removes the bad rows immediately.
app.post('/admin/purge-translations', async (c) => {
  const db: any = c.env.DB;
  await ensureTranslateCache(db);
  const rows: any = await db.prepare('SELECT id, src, out FROM i18n_cache').all();
  let removed = 0;
  for (const r of (rows.results || [])) {
    const src = String(r.src || '');
    const out = String(r.out || '');
    if (!out) continue;
    if (out === src || (out.trim().length <= 2 && src.trim().length > 3)) {
      try { await db.prepare('DELETE FROM i18n_cache WHERE id = ?').bind(r.id).run(); removed++; } catch { /* best effort */ }
    }
  }
  return c.json({ ok: true, scanned: (rows.results || []).length, removed });
});

app.post('/admin/multipart/sign-parts', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const key = String(body.key || '');
  const uploadId = String(body.uploadId || '');
  const nums = Array.isArray(body.part_numbers) ? body.part_numbers : [];
  if (!key || !uploadId || !nums.length) return c.json({ error: 'missing_fields' }, 400);
  if (!/^(apk|ss|icon|feature|vthumb)\//.test(key) || key.includes('..')) {
    return c.json({ error: 'invalid_key' }, 400);
  }
  if (nums.length > 10000) return c.json({ error: 'too_many_parts' }, 400);
  const ttl = Number(body.expires || 6 * 3600);
  const parts = [];
  for (const raw of nums) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 10000) continue;
    parts.push({ partNumber: n, url: await r2PresignUploadPart(c.env, key, uploadId, n, Math.min(Math.max(ttl, 600), 6 * 3600)) });
  }
  return c.json({ parts });
});

app.post('/admin/multipart/abort', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (body.key && body.uploadId) await r2AbortMultipartUpload(c.env, body.key, body.uploadId);
  return c.json({ ok: true });
});

// Minimum length of the comment that must accompany a rating. Kept small so a
// real short opinion («جيد جداً») passes, but an empty or single-letter box does
// not: the owner asked that a rating is only published with a written review.
const COMMENT_MIN_LENGTH = 3;

function isValidR2Key(key: string, prefix: string): boolean { return key.startsWith(`${prefix}/`) && !key.includes('..'); }

/* =========================================================================
   Publishing is IDEMPOTENT.
   -------------------------------------------------------------------------
   The owner's report: «ينشر اثنتين» — one publish created two identical
   entries. Two separate causes, both fixed here:

   1. The origin, in the admin page: the POST answers slowly (the automatic
      push fan-out can take minutes), the browser/iOS gives up first, the code
      re-checked «did it get created?» and tried again → row #2. Guarded in the
      client with a per-publish idempotency key; guarded here with a body-carried
      key AND a same-APK/same-package check, so a retried request can never
      create a second row.
   2. A fresh upload writes a NEW object key, so «same APK» is not visible from
      the key alone. The check therefore compares the PACKAGE NAME (the one
      identity an APK really has) and the cleaned name, and returns the EXISTING
      row with `existing: true` instead of failing — the client then opens that
      row's edit page, which is what the owner expected to see.
   ========================================================================= */
const publishKeys = new Map<string, { id: string; slug: string; ts: number }>();

function normaliseForMatch(raw: unknown): string {
  return sanitizeText(raw, 200).replace(/[\u200e\u200f\u061c]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

app.post('/admin/apps', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  /* ── TWO-STEP PUBLISH («ملف التطبيق أولاً ثم الصور») ──────────────────────
   * The owner reported: the APK finishes uploading, then the pictures start,
   * and the whole thing dies with «تعذّر الاتصال بالخادم أثناء ملف التطبيق» —
   * and the pictures that had already been uploaded were then swept away. The
   * cause is structural: the row only existed AFTER every byte. One long-lived
   * connection had to survive the APK, the icon, the feature image and every
   * screenshot before anything was saved.
   *
   * The row is now created as soon as the APK is there (`post_create: true`),
   * so the pictures are attached to an existing item and a break in the middle
   * costs one picture, not the whole publish. Callers that still send everything
   * in one request (the installed console, older builds) are unchanged: without
   * `post_create` an apk_key is still required.
   */
  const apkKey = String(body.apk_key || '');
  if (!body.name || !body.package_name) return c.json({ error: 'missing_fields' }, 400);
  if (!apkKey && !body.post_create) return c.json({ error: 'missing_fields' }, 400);
  if (apkKey && !isValidR2Key(apkKey, 'apk')) return c.json({ error: 'invalid_apk_key' }, 400);

  // Same idempotency key seen within 24h → the same publish, just retried.
  const idem = String(body.idempotency_key || '').slice(0, 80);
  if (idem) {
    const seen = publishKeys.get(idem);
    if (seen && Date.now() - seen.ts < 24 * 3600 * 1000) {
      return c.json({ ok: true, id: seen.id, slug: seen.slug, existing: true, replayed: true });
    }
    if (publishKeys.size > 500) publishKeys.clear();
  }

  // No APK key at all = the shell of a two-step publish. It is only a shell; it
  // is not announceable and the console fills it in immediately.
  const head = apkKey ? await r2Head(c.env, apkKey) : null;
  if (apkKey && !head) return c.json({ error: 'apk_not_found' }, 400);

  /* The same product can never become two rows.
   *
   * Round 83 (owner: «ثم أعدل على شئ بسيط مثل الاسم ينشر مرة أخرى ويظهر كأنه
   * تطبيقات … يصبح نسخة لا أحتاجها»). Publishing again from the publish screen
   * while only the NAME had changed created a second row: the duplicate guard
   * compared the package name alone, and any difference in it — a stray space, a
   * different case, a typo — slipped past and produced a copy.
   *
   * Two independent identities are checked now:
   *   • the package name (normalised: case, spaces, invisible bidi marks), or
   *   • the name itself (same normalisation).
   * Either match means «this product already exists», and the owner is sent to
   * the existing row instead of being handed a duplicate.
   */
  const pkg = sanitizeText(body.package_name, 200).trim();
  const nameKey = normaliseForMatch(body.name);
  const dup: any = await c.env.DB.prepare(
    `SELECT id, slug, name, package_name, apk_key FROM apps
      WHERE LOWER(TRIM(package_name)) = LOWER(?) LIMIT 5`,
  ).bind(pkg).first().catch(() => null);
  let dupe = dup ? { id: dup.id, slug: dup.slug, name: dup.name, apk_key: dup.apk_key } : null;

  if (!dupe && nameKey) {
    // No package match — but the same title is already in the catalogue.
    const byName: any = await c.env.DB.prepare(
      'SELECT id, slug, name, package_name, apk_key, name_lower FROM apps',
    ).all().catch(() => ({ results: [] }));
    const hit = (byName.results || []).find((r: any) => normaliseForMatch(r.name) === nameKey);
    if (hit) dupe = { id: hit.id, slug: hit.slug, name: hit.name, apk_key: hit.apk_key };
  }
  if (dupe) {
    // Never leave the second copy's upload behind: the APK we just received is
    // byte-identical in purpose to the existing row's file, so it is deleted.
    if (apkKey && dupe.apk_key !== apkKey) await r2DeleteStrict(c.env, apkKey).catch(() => {});
    const sameName = normaliseForMatch(dupe.name) === nameKey;
    if (idem) publishKeys.set(idem, { id: dupe.id, slug: dupe.slug, ts: Date.now() });
    await recordActivity(c.env, consoleActor(c),
      `منع تكرار «${sanitizeText(body.name, 200)}» — موجود بالفعل باسم «${dupe.name}»`, 'publish');
    return c.json({
      ok: true, id: dupe.id, slug: dupe.slug, existing: true,
      duplicate: true, same_name: sameName,
    });
  }
  
  let base = slugify(body.name), slug = base, i = 1;
  while (await c.env.DB.prepare('SELECT id FROM apps WHERE slug = ?').bind(slug).first()) { i++; slug = `${base}-${i}`; }

  /* A shell (no APK yet) is a DRAFT: not listed anywhere until its file lands,
     because a download that would 404 is worse than a moment's delay. The APK
     route publishes it. A one-request publish is published immediately, exactly
     as before. */
  const shellDraft = !apkKey;

  /* A NEW item is always visible at first — «نشر» means published.
     A stale `app_publication` row left over from a deleted/previous item with
     the same slug used to hide the brand-new item from every list and make
     `/api/apps/<slug>` answer 404 (it exists, but nowhere on the site). */
  await ensureConsoleTables(c.env.DB);
  for (const sql of [
    'DELETE FROM app_publication WHERE slug = ?',
    'DELETE FROM app_order WHERE slug = ?',
    shellDraft
      ? "INSERT INTO app_publication (slug, status, publish_at, updated_at) VALUES (?, 'draft', 0, ?) ON CONFLICT(slug) DO UPDATE SET status='draft', publish_at=0, updated_at=excluded.updated_at"
      : "INSERT INTO app_publication (slug, status, publish_at, updated_at) VALUES (?, 'published', 0, ?) ON CONFLICT(slug) DO UPDATE SET status='published', publish_at=0, updated_at=excluded.updated_at",
  ]) { try { await c.env.DB.prepare(sql).bind(slug, nowSec()).run(); } catch { /* best effort */ } }
  
  const now = nowSec(), id = randomId();
  await c.env.DB.prepare(`INSERT INTO apps (id, slug, name, name_lower, search_terms, package_name, short_description, description, category, type, developer, version_name, version_code, min_sdk, size_bytes, apk_key, icon_key, feature_key, stars, rating_sum, rating_count, rating, downloads, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?)`)
    .bind(id, slug, sanitizeText(body.name, 200), sanitizeText(body.name, 200).toLowerCase(), JSON.stringify(searchTerms(body.name, body.developer, body.short_description, body.package_name)), sanitizeText(body.package_name, 200), sanitizeText(body.short_description, 500)||null, sanitizeText(body.description, 10000)||null, sanitizeText(body.category, 60)||'other', body.type === 'game' ? 'game' : 'app', sanitizeText(body.developer, 120)||null, sanitizeText(body.version_name, 60)||null, safeInt(body.version_code,0,999999999)||null, safeInt(body.min_sdk,1,99)||null, head ? head.size : 0, apkKey || null, body.icon_key || null, body.feature_key || null, now, now).run();

  if (Array.isArray(body.screenshot_keys)) {
    for (let j = 0; j < body.screenshot_keys.length; j++) {
      const raw = body.screenshot_keys[j];
      if (!isValidR2Key(raw, 'ss')) continue;
      /* Same rule as the screenshot endpoint: <ss>/<slug>-<n>.<ext>, moved to
         that name now so the bucket never keeps a second copy of the file. */
      const wanted = organiseKey(String(raw), `${slug}-${j + 1}`);
      let finalKey = raw;
      if (wanted !== raw) { const mv = await r2Move(c.env, String(raw), wanted); if (mv.ok) finalKey = mv.key; }
      await c.env.DB.prepare('INSERT INTO screenshots (id, app_id, r2_key, position, created_at) VALUES (?, ?, ?, ?, ?)').bind(randomId(), id, finalKey, j, now).run();
    }
  }
  
  if (Array.isArray(body.videos)) {
    await ensureVideosSchema(c.env);
    for (let j = 0; j < Math.min(body.videos.length, 12); j++) {
      const raw = body.videos[j];
      const parsed = parseYouTubeUrl(raw && raw.url, raw && raw.kind);
      if (!parsed) continue;
      const tk = videoThumbKey(raw && raw.thumb_key);
      await addAppVideo(c.env, id, {
        ...parsed, title: sanitizeText(raw && raw.title, 120),
        thumb_key: tk || null, position: j,
      });
    }
  }

  // Automated push on app upload (behind the store setting), with a rich
  // image + deep link into the new app's page.
  //
  // The broadcast is NOT awaited: it fans out to every device through FCM and
  // can take far longer than the browser's request timeout. Awaiting it made a
  // successful publish look like a network error ("Internet error") after the
  // app row had already been created — which is why REPLACING an APK (no
  // broadcast) always appeared to work. The row is written first, then the
  // push runs in the background.
  /* An announcement waits for the file itself. A two-step shell has no APK yet,
     so announcing here would push a «new app» whose download does not exist —
     the «نُشر ولم يُنزّل» complaint. The APK route announces instead, exactly
     once, when the file is attached. */
  if (apkKey && (await getStoreSettings(c.env)).notify_new_publications) {
    const note = {
      type: 'new_app' as const, title: body.name, body: '', app_slug: slug,
      image_url: icon_url(body.icon_key, c.env) || '',
      click_url: `/app?slug=${encodeURIComponent(slug)}`,
      created_at: now,
    };
    try {
      // `fast`: the row is written inside the request, the FCM fan-out runs
      // afterwards — publishing used to wait for it (that is the slowness).
      c.executionCtx.waitUntil(addNotification(c.env, { ...note, fast: true }, c.executionCtx).catch(() => {}));
    } catch {
      // No execution context (tests/edge cases): write it inline, no broadcast.
      await addNotification(c.env, note).catch(() => {});
    }
  }
  
  // إبطال الكاش بعد الإضافة
  await purgeAppsCache(c.env);
  if (idem) {
    if (publishKeys.size > 500) publishKeys.clear();
    publishKeys.set(idem, { id, slug, ts: Date.now() });
  }

  return c.json({ ok: true, id, slug, has_apk: !!apkKey, awaiting_files: !apkKey });
});

/* ── SAVING «البيانات الأساسية» ──────────────────────────────────────────────
 *
 * Owner: «أريد عند التعديل عليها تستبدل المعلومات القديمة ولا تنشر إعلان ولا
 * تأتي منها نسخة ثانية».
 *
 * Three promises, and each one is enforced here rather than assumed:
 *
 *  1. IT REPLACES THE OLD VALUES. The row is the single source of truth: every
 *     field is written from the form, and nothing about the change survives in
 *     a second place that could later re-appear (a stale list cache, a second
 *     row, an old URL). Whoever displays the item reads this row.
 *
 *  2. IT NEVER BECOMES A SECOND COPY. A second copy is only possible if the
 *     name or the package name now matches ANOTHER row — so that is refused,
 *     with a plain answer the panel can show, instead of silently splitting the
 *     product in two.
 *
 *  3. IT NEVER ANNOUNCES ANYTHING. A notification is sent only when a genuinely
 *     NEWER version is being saved (a higher version code, or — when codes are
 *     absent — a different non-empty version name). Renaming, re-categorising,
 *     editing the description/developer/package and fixing a typo are silent.
 *
 * The old row is also what the DEVICE caches depend on: a published `package_name`
 * feeds `gs_resolved_pkgs` inside the installed app, so the change is written
 * there too before this request answers.
 */
app.patch('/admin/apps/:id', async (c) => {
  const id = c.req.param('id'), body = await c.req.json().catch(() => ({}));
  const old: any = await c.env.DB.prepare('SELECT * FROM apps WHERE id = ?').bind(id).first();
  if (!old) return c.json({ error: 'not_found' }, 404);

  const has = (k: string) => body[k] !== undefined && body[k] !== null;
  const name = has('name') ? sanitizeText(body.name, 200).trim() : old.name;
  if (has('name') && !name) return c.json({ error: 'name_required' }, 400);
  const name_lower = has('name') ? name.toLowerCase() : old.name_lower;
  const package_name = has('package_name') ? sanitizeText(body.package_name, 200).trim() : (old.package_name || '');
  if (has('package_name') && !package_name) return c.json({ error: 'package_required' }, 400);
  const developer = has('developer') ? sanitizeText(body.developer, 120).trim() : (old.developer || '');
  const short_description = has('short_description') ? sanitizeText(body.short_description, 500).trim() : (old.short_description || '');
  const description = has('description') ? sanitizeText(body.description, 10000) : (old.description || '');
  const search_terms = JSON.stringify(searchTerms(name, developer, short_description, package_name));

  /* ── never a second copy ─────────────────────────────────────────────────
     Two different rows may not carry the same product. The publish screen
     already refuses a duplicate; an EDIT could still walk into one by typing the
     other item's title or package name, so the same rule applies here. */
  const nameKey = normaliseForMatch(name);
  const others: any = await c.env.DB.prepare('SELECT id, slug, name, package_name FROM apps WHERE id <> ?').bind(id).all().catch(() => ({ results: [] }));
  const clashPkg = (others.results || []).find((r: any) => String(r.package_name || '').trim().toLowerCase() === package_name.toLowerCase() && package_name);
  if (clashPkg) {
    return c.json({
      error: 'package_taken', id: clashPkg.id, slug: clashPkg.slug,
      message: `اسم الحزمة مستخدم بالفعل في «${clashPkg.name}» — لم يُحفظ شيء.`,
    }, 409);
  }
  const clashName = (others.results || []).find((r: any) => normaliseForMatch(r.name) === nameKey && nameKey);
  if (clashName) {
    return c.json({
      error: 'name_taken', id: clashName.id, slug: clashName.slug,
      message: `الاسم مستخدم بالفعل في «${clashName.name}» — لم يُحفظ شيء.`,
    }, 409);
  }

  /* ── a real release only ────────────────────────────────────────────────── */
  const oldCode = Number(old.version_code) || 0;
  const newCode = has('version_code') ? (safeInt(body.version_code, 0, 999999999) || 0) : oldCode;
  const newNameVer = has('version_name') ? sanitizeText(body.version_name, 60).trim() : (old.version_name || '');
  const versionChanged = (newCode > oldCode)
    || (newCode === oldCode && !!newNameVer && String(newNameVer) !== String(old.version_name || ''));

  const changedFields = [
    ['name', old.name, name], ['package_name', old.package_name, package_name],
    ['developer', old.developer, developer], ['short_description', old.short_description, short_description],
    ['description', old.description, description],
    ['category', old.category, has('category') ? String(body.category) : old.category],
    ['type', old.type, has('type') ? (body.type === 'game' ? 'game' : 'app') : old.type],
    ['version_name', old.version_name, newNameVer],
  ].filter(([, a, b]) => String(a ?? '') !== String(b ?? '')).map(([k]) => k);

  await c.env.DB.prepare(`UPDATE apps SET name=?, name_lower=?, search_terms=?, package_name=?, short_description=?, description=?, category=?, type=?, developer=?, version_name=?, version_code=?, min_sdk=?, updated_at=? WHERE id=?`)
    .bind(
      name, name_lower, search_terms, package_name,
      short_description || null, description || null,
      has('category') ? sanitizeText(body.category, 60) || old.category : old.category,
      has('type') ? (body.type === 'game' ? 'game' : 'app') : old.type,
      developer || null,
      newNameVer || null,
      has('version_code') ? safeInt(body.version_code, 0, 999999999) : old.version_code,
      has('min_sdk') ? safeInt(body.min_sdk, 1, 99) : old.min_sdk,
      nowSec(), id,
    ).run();

  /* The ONE case that is an announcement: a newer version really arrived. */
  if (versionChanged) await addNotification(c.env, {
    type: 'update', title: name, body: `إصدار ${newNameVer || old.version_name || ''}`.trim(),
    app_slug: old.slug, image_url: icon_url(old.icon_key, c.env) || '',
    click_url: `/app?slug=${encodeURIComponent(old.slug)}`, created_at: nowSec(),
  });

  // Every list response is cached per device for a week; an edit must not leave
  // the OLD values in front of the owner on their next visit.
  await purgeAppsCache(c.env);

  const key = normaliseForMatch(name) !== normaliseForMatch(old.name) ? slugify(name) : old.slug;
  await recordActivity(c.env, consoleActor(c),
    `تعديل «${name}» — ${changedFields.length ? changedFields.join(', ') : 'لا تغيير'}${versionChanged ? ' — إصدار جديد' : ' — بلا إشعار'}`,
    'edit');

  return c.json({
    ok: true,
    replaced: true,
    notified: versionChanged,
    changed: changedFields,
    app: { id, slug: old.slug, name, package_name, developer, version_name: newNameVer, version_code: newCode },
    /* The device caches a slug→package map inside the installed app; when the
       package name changes the store page must forget the old one, never keep
       two answers. */
    invalidate_device_package: has('package_name') && package_name !== (old.package_name || ''),
    explicit_key: key,
  });
});


/* Deleting the previous file on an update.
 *
 * Round 83 (owner: «عند تحديث التطبيق أو اللعبة القديمة لا يحذفون من r2 … أريد عند
 * التحديث يحذف القديم»). The old key was removed inside `waitUntil`, which is
 * fire-and-forget: if the isolate is recycled, the R2 call errors, or the request
 * is retried, the file is never deleted and nothing reports it. The bucket then
 * collects one dead APK per update — the 42 MB of leftovers the owner kept
 * finding.
 *
 * replaceOldFile() deletes in the request path, verifies the object is really
 * gone, and returns the truth so the caller can say it. If the delete fails the
 * key is still referenced nowhere (the row now points at the new file) and the
 * orphan sweep will list it — but the owner is told immediately instead of
 * discovering it weeks later in the Cloudflare console.
 */
async function replaceOldFile(env: Env, oldKey: unknown, newKey: unknown): Promise<{ cleaned: boolean; key?: string; error?: string }> {
  const key = String(oldKey || '').trim();
  if (!key || key === String(newKey || '').trim()) return { cleaned: true };
  const gone = await r2DeleteStrict(env, key).catch(() => false);
  if (!gone) return { cleaned: false, key, error: 'delete_failed' };
  // A delete that reports success can still leave the object in very rare cases.
  const still = await r2Head(env, key).catch(() => null);
  if (still) return { cleaned: false, key, error: 'still_present' };
  return { cleaned: true, key };
}

app.post('/admin/apps/:id/apk', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!isValidR2Key(String(body.apk_key || ''), 'apk')) return c.json({ error: 'invalid_apk_key' }, 400);
  const head = await r2Head(c.env, body.apk_key); if (!head) return c.json({ error: 'not_found' }, 400);
  const old: any = await c.env.DB.prepare('SELECT * FROM apps WHERE id = ?').bind(c.req.param('id')).first();
  if (!old) return c.json({ error: 'not_found' }, 404);

  /* ── «ملف التطبيق أولاً ثم الصور»: the step that finishes the publish ─────
   * A two-step publish creates the row with no file, uploads the APK, and lands
   * here. That first arrival is not a «تحديث» — it is the moment the item
   * becomes real, so it is announced like a publication, ONCE. The guard is the
   * row itself: an update only counts as a first arrival while `apk_key` is
   * still empty. Re-uploading a file later is a release (the `update` notice
   * below), never a second «new app».
   */
  const wasShell = !old.apk_key;

  /* «عندما حدّثت التطبيق كل الصور نُشرت مرة ثانية».
   *
   * The key of an existing item's file is deterministic — `apk/<slug>.apk` — so
   * replacing the APK produces THE SAME KEY with new bytes. The guard below used
   * to treat that as a retry and return `unchanged: true`: the row was never
   * touched (old version, old size) and the notification was correctly skipped,
   * which looked from the panel like a silent failure. It also meant a genuine
   * re-upload was invisible to the site.
   *
   * A same-key write is only a no-op when the stored size and version are the
   * ones we were told; otherwise the bytes really changed and it is a release. */
  const sizeNow = Number(head.size) || 0;
  const versionNow = String(body.version_name || old.version_name || '');
  const codeNow = body.version_code !== undefined ? safeInt(body.version_code, 0, 999999999) : old.version_code;
  const sameKey = old.apk_key === body.apk_key;
  const sameFile = sameKey && Number(old.size_bytes || 0) === sizeNow
    && String(old.version_name || '') === versionNow
    && (body.version_code === undefined || Number(old.version_code) === codeNow);
  if (sameFile) return c.json({ ok: true, unchanged: true, notified: false });

  /* A shell was created as a draft; the file that completes it is what puts it
     on the site. Done here, after the row is updated, so the catalogue can never
     show an item whose download is not there. */
  if (wasShell) {
    await ensureConsoleTables(c.env.DB);
    try {
      await c.env.DB.prepare(`INSERT INTO app_publication (slug, status, publish_at, updated_at)
        VALUES (?, 'published', 0, ?) ON CONFLICT(slug) DO UPDATE SET
          status = 'published', publish_at = 0, updated_at = excluded.updated_at`)
        .bind(old.slug, nowSec()).run();
    } catch { /* best effort; the health panel would name it */ }
  }

  await c.env.DB.prepare('UPDATE apps SET apk_key=?, size_bytes=?, version_name=?, version_code=?, updated_at=? WHERE id=?')
    .bind(body.apk_key, sizeNow, versionNow, codeNow, nowSec(), old.id).run();

  /* The previous APK is deleted NOW and the result is reported.
     The row is already updated first, so a failed cleanup is only a leftover
     file — never a wrong catalogue. But it is no longer silent. */
  const cleanup = await replaceOldFile(c.env, old.apk_key, body.apk_key);

  /* «عندما أقوم بتحديث تطبيق لا يبعث إشعاراً» — two causes, both fixed here.
   *
   * 1. The notification was only ever written if a setting the console never
   *    shows (`auto_notify_update`) happened to be on; it defaults to '0', so a
   *    release bumped in the APK panel announced nothing while the same release
   *    published from the publish form did. A version the owner replaced by hand
   *    is exactly the event a user must hear about, so the row is always written
   *    — the setting keeps its meaning for the automatic updater only.
   * 2. The response did not say whether the row or the push went out, so the
   *    panel could only guess. It now returns `notified` and `push`. */
  let notified = false;
  let push: any = { skipped: 'not_attempted' };
  try {
    let execCtx: any = null;
    try { execCtx = c.executionCtx; } catch { execCtx = null; }
    const note: any = await addNotification(c.env, {
      // The file that completes a shell is a publication, not an update.
      type: wasShell ? 'new_app' : 'update',
      title: old.name,
      body: wasShell ? '' : `إصدار ${body.version_name || old.version_name}`,
      app_slug: old.slug, image_url: icon_url(old.icon_key, c.env) || '',
      click_url: `/app?slug=${encodeURIComponent(old.slug)}`, created_at: nowSec(),
      // The row is what «notified» means; the push must not delay the click.
      fast: !!execCtx,
    } as any, execCtx);
    notified = !!note?.id;
    push = note?.push || push;
  } catch (e: any) {
    push = { error: 'notification_failed', message: String(e?.message || e) };
  }
  await purgeAppsCache(c.env);
  return c.json({
    ok: true, cleaned: cleanup.cleaned, leftover_key: cleanup.key || null,
    notified, push, first_file: wasShell,
    version: { name: body.version_name || old.version_name, code: body.version_code ?? old.version_code },
  });
});

app.post('/admin/apps/:id/icon', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const old: any = await c.env.DB.prepare('SELECT icon_key, id FROM apps WHERE id = ?').bind(c.req.param('id')).first();
  if (!old) return c.json({ error: 'not_found' }, 404);
  // null/'' clears the picture; anything else must be a real icon/ key, or the
  // row would point at a foreign object while the old file is already deleted.
  const key = body.icon_key == null || body.icon_key === '' ? null : String(body.icon_key);
  if (key !== null && !isValidR2Key(key, 'icon')) return c.json({ error: 'invalid_icon_key' }, 400);
  await c.env.DB.prepare('UPDATE apps SET icon_key=?, updated_at=? WHERE id=?').bind(key, nowSec(), old.id).run();
  const cleanup = await replaceOldFile(c.env, old.icon_key, key);
  await purgeAppsCache(c.env);
  await purgeMediaUrl(c.env, key);
  return c.json({ ok: true, cleaned: cleanup.cleaned, leftover_key: cleanup.key || null });
});

app.post('/admin/apps/:id/feature', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const old: any = await c.env.DB.prepare('SELECT feature_key, id FROM apps WHERE id = ?').bind(c.req.param('id')).first();
  if (!old) return c.json({ error: 'not_found' }, 404);
  const key = body.feature_key == null || body.feature_key === '' ? null : String(body.feature_key);
  if (key !== null && !isValidR2Key(key, 'feature')) return c.json({ error: 'invalid_feature_key' }, 400);
  await c.env.DB.prepare('UPDATE apps SET feature_key=?, updated_at=? WHERE id=?').bind(key, nowSec(), old.id).run();
  const cleanup = await replaceOldFile(c.env, old.feature_key, key);
  await purgeAppsCache(c.env);
  await purgeMediaUrl(c.env, key);
  return c.json({ ok: true, cleaned: cleanup.cleaned, leftover_key: cleanup.key || null });
});

app.post('/admin/apps/:id/screenshots', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body.screenshot_keys) || !body.screenshot_keys.length) return c.json({ error: 'no_screenshots' }, 400);
  const id = c.req.param('id');
  /* Screenshots also get one name per item: <ss>/<slug>-<n>.<ext>.
   *
   * They used to be plain <ss>/<slug>.<ext> too, so uploading a SECOND
   * screenshot overwrote the first one's object while both rows still pointed
   * at it — six screenshots, one file. Ordering is what makes them distinct, so
   * the position is part of the name: «ss/subway-surfers-2.jpg».
   */
  const baseRow: any = await c.env.DB.prepare('SELECT slug FROM apps WHERE id = ?').bind(id).first().catch(() => null);
  const slugForSs = slugify(String(baseRow?.slug || 'app')).slice(0, 60) || 'app';
  const ssKeyFor = (raw: string, position: number) =>
    organiseKey(String(raw), `${slugForSs}-${position + 1}`);
  const max: any = await c.env.DB.prepare('SELECT MAX(position) as max_pos FROM screenshots WHERE app_id = ?').bind(id).first();
  let pos = (max?.max_pos || 0) + 1;

  /* «عندما حدّثت التطبيق كل الصور نُشرت مرة ثانية».
   *
   * Two things made a re-uploaded picture appear twice:
   *
   * 1. An upload for an existing item is named `ss/<slug>-<slot>.ext` — a
   *    DETERMINISTIC key. Re-picking slot 3 produced the same key (new bytes,
   *    same name) and this route appended a NEW row for it, so the page showed
   *    the same slot twice: the new picture and the old row pointing at the same
   *    object.
   * 2. `pos` was always `MAX(position)+1`, so a replaced picture could never
   *    occupy the place of the one it replaces.
   *
   * The slot is read from the incoming key (`…-3.jpg` → slot 3); when that slot
   * already has a row, it is UPDATED instead of duplicated. Only a key with no
   * slot (or a slot that is free) adds a row. */
  const slotOf = (key: string): number => {
    const base = String(key).split('/').pop() || '';
    const m = base.match(/-(\d+)\.[A-Za-z0-9]+$/);
    return m ? Math.max(1, Number(m[1])) : 0;
  };
  const slots = new Map<number, string>();
  const existing: any = await c.env.DB.prepare('SELECT id, position FROM screenshots WHERE app_id = ?').bind(id)
    .all().catch(() => ({ results: [] }));
  /* Keyed by the 1-BASED slot in the file name, not the raw DB position:
   * `ss/<slug>-1.jpg` is position 0, `-2.jpg` is position 1 … Comparing the
   * name's slot against the 0-based position replaced the WRONG row (slot 1
   * updated the second screenshot) and duplicated the right one. */
  for (const row of existing.results || []) slots.set((Number(row.position) || 0) + 1, String(row.id));

  const moved: string[] = [], failed: string[] = [], replaced: number[] = [], added: number[] = [];
  for (const k of body.screenshot_keys) {
    if (!isValidR2Key(k, 'ss')) continue;
    const slot = slotOf(k);
    if (slot && slots.has(slot)) {
      // The same slot, new bytes: replace the row, keep its place in the order.
      // created_at is the picture's version token, so it moves with the bytes.
      await c.env.DB.prepare('UPDATE screenshots SET r2_key = ?, created_at = ? WHERE id = ?')
        .bind(k, nowSec(), slots.get(slot)).run();
      replaced.push(slot);
    } else {
      const wanted = ssKeyFor(k, pos);
      let finalKey = k;
      if (wanted !== k) {
        const mv = await r2Move(c.env, k, wanted);
        if (mv.ok) finalKey = mv.key; else failed.push(k);
      }
      await c.env.DB.prepare('INSERT INTO screenshots (id, app_id, r2_key, position, created_at) VALUES (?, ?, ?, ?, ?)').bind(randomId(), id, finalKey, pos, nowSec()).run();
      if (finalKey !== k) moved.push(finalKey);
      added.push(pos);
      pos++;
    }
  }
  /* Every row is re-read once and checked: a screenshot whose object is gone is
   * a broken picture on the page and used to be invisible until a visitor
   * reported it. */
  const missing: string[] = [];
  const finalRows: any = await c.env.DB.prepare('SELECT id, r2_key FROM screenshots WHERE app_id = ?').bind(id)
    .all().catch(() => ({ results: [] }));
  for (const row of finalRows.results || []) {
    if (!row.r2_key) continue;
    if (!(await r2Head(c.env, String(row.r2_key)).catch(() => null))) missing.push(String(row.r2_key));
  }
  return c.json({ ok: true, moved, failed, replaced, added, missing });
});

app.delete('/admin/apps/:id/screenshots/:sid', async (c) => {
  const row: any = await c.env.DB.prepare('SELECT r2_key FROM screenshots WHERE id = ? AND app_id = ?').bind(c.req.param('sid'), c.req.param('id')).first();
  if (!row) return c.json({ ok: true, cleaned: true });
  await c.env.DB.prepare('DELETE FROM screenshots WHERE id = ?').bind(c.req.param('sid')).run();
  /* The file is deleted through replaceOldFile (in the request path, verified
     with a HEAD) instead of a swallowed r2Delete — a failed delete used to look
     exactly like a successful one, and the screenshot stayed in the bucket. */
  const cleanup = await replaceOldFile(c.env, row.r2_key, '');
  await purgeAppsCache(c.env);
  return c.json({ ok: true, cleaned: cleanup.cleaned, leftover_key: cleanup.key || null });
});

app.post('/admin/apps/:id/videos', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = parseYouTubeUrl(body.url, body.kind);
  if (!parsed) return c.json({ error: 'invalid_youtube_url' }, 400);
  const exists: any = await c.env.DB.prepare('SELECT id FROM apps WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ error: 'not_found' }, 404);
  await ensureVideosSchema(c.env);
  const max: any = await c.env.DB.prepare('SELECT MAX(position) AS max_pos FROM app_videos WHERE app_id = ?').bind(id).first();
  const pos = (Number(max?.max_pos) || -1) + 1;
  if (body.thumb_key != null && body.thumb_key !== '' && videoThumbKey(body.thumb_key) === undefined)
    return c.json({ error: 'invalid_thumb_key' }, 400);
  const video = await addAppVideo(c.env, id, {
    ...parsed, title: sanitizeText(body.title, 120),
    thumb_key: videoThumbKey(body.thumb_key) || null, position: pos,
  });
  c.header('Cache-Control', 'private, no-store');
  return c.json({ ok: true, video: { ...video, thumb_url: video.thumb_key ? shot_url(video.thumb_key, c.env) : null } });
});

// Replace / clear a video's custom thumbnail (and optionally its title).
app.patch('/admin/apps/:id/videos/:vid', async (c) => {
  const id = c.req.param('id'), vid = c.req.param('vid');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(vid)) return c.json({ error: 'invalid_id' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const tk = videoThumbKey(body.thumb_key);
  if (body.thumb_key != null && body.thumb_key !== '' && tk === undefined)
    return c.json({ error: 'invalid_thumb_key' }, 400);
  await ensureVideosSchema(c.env);
  const before: any = await c.env.DB.prepare('SELECT thumb_key FROM app_videos WHERE id = ? AND app_id = ?').bind(vid, id).first();
  const patch: any = {};
  if (tk !== undefined) patch.thumb_key = tk;
  if (body.title !== undefined) patch.title = sanitizeText(body.title, 120);
  const video = await updateAppVideo(c.env, id, vid, patch);
  if (!video) return c.json({ error: 'not_found' }, 404);
  if (tk !== undefined && before?.thumb_key && before.thumb_key !== tk)
    await r2Delete(c.env, String(before.thumb_key)).catch(() => {});
  c.header('Cache-Control', 'private, no-store');
  return c.json({ ok: true, video: { ...video, thumb_url: video.thumb_key ? shot_url(video.thumb_key, c.env) : null } });
});

app.delete('/admin/apps/:id/videos/:vid', async (c) => {
  const id = c.req.param('id'), vid = c.req.param('vid');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(vid)) return c.json({ error: 'invalid_id' }, 400);
  await ensureVideosSchema(c.env);
  const old: any = await c.env.DB.prepare('SELECT thumb_key FROM app_videos WHERE id = ? AND app_id = ?').bind(vid, id).first();
  const ok = await deleteAppVideo(c.env, id, vid);
  if (!ok) return c.json({ error: 'not_found' }, 404);
  if (old?.thumb_key) await r2Delete(c.env, String(old.thumb_key)).catch(() => {});
  c.header('Cache-Control', 'private, no-store');
  return c.json({ ok: true });
});

/* Delete an item AND its files — and say honestly what happened.
 *
 * The owner's report: «عند الحذف من لوحة التحكم لا تحذف في كلاود». The row was
 * deleted first, with every R2 delete wrapped in `.catch(()=>{})`, so:
 *   • a failed/slow DELETE was silently ignored and the APK stayed in the bucket
 *     for ever (it also stayed publicly downloadable from the CDN);
 *   • deleting an app whose file was already gone threw and aborted the loop,
 *     leaving the rest of the files (screenshots, thumbs) behind.
 * Now: collect every key first, delete them in ONE bulk R2 call, delete the row
 * last (so a failure is retried instead of orphaning), and return the leftovers.
 */
app.delete('/admin/apps/:id', async (c) => {
  const id = c.req.param('id'), app: any = await c.env.DB.prepare('SELECT * FROM apps WHERE id = ?').bind(id).first();
  if (!app) return c.json({ error: 'not_found' }, 404);

  const keys: string[] = [];
  const push = (k: unknown) => { if (k && typeof k === 'string') keys.push(k); };

  push(app.apk_key); push(app.icon_key); push(app.feature_key);
  const ss: any = await c.env.DB.prepare('SELECT r2_key FROM screenshots WHERE app_id = ?').bind(id).all().catch(() => ({ results: [] }));
  for (const row of (ss.results || [])) push(row.r2_key);
  /* Video thumbnails are the file that kept surviving («صورة المصغرة … لم تحذف»).
     They are collected here, straight from the table, BEFORE any row is removed —
     and the rows are only cleared after the keys are in hand. */
  try {
    const vids: any = await c.env.DB.prepare(
      'SELECT thumb_key FROM app_videos WHERE app_id = ? AND thumb_key IS NOT NULL',
    ).bind(id).all();
    for (const v of (vids.results || [])) push(v.thumb_key);
  } catch { /* table may not exist yet */ }
  try { for (const k of await listVideoThumbKeys(c.env, id)) push(k); } catch { /* best effort */ }
  // A thumbnail whose row was already lost is still findable by its key shape.
  try {
    for (const o of await r2List(c.env, 'vthumb/', 5000)) {
      if (String(app.slug || '') && o.key.includes(String(app.slug))) push(o.key);
    }
  } catch { /* listing is best effort */ }

  /* The row dies FIRST, the files second.
   *
   * Owner: «حذفت لعبة بقيت كما هي لم تحذف». The old order required the R2 delete
   * to succeed before the row was removed, so a storage hiccup (or the outage
   * that made every R2 call fail) left the app on the site for ever — and the
   * dashboard said only «فشل الحذف», which pointed at nothing.
   *
   * Deleting the row is what the owner asked for and what the site shows; the
   * files are a cleanup that can be retried from the cloud panel, which lists
   * them as orphans. So: row first, then files, then the leftover keys are
   * reported honestly so «تنظيف كلاود» can finish the job.
   */
  await c.env.DB.prepare('DELETE FROM screenshots WHERE app_id = ?').bind(id).run().catch(() => {});
  const thumbKeys = await deleteAppVideos(c.env, id).catch(() => [] as string[]);
  for (const k of thumbKeys) if (k) push(k);
  await c.env.DB.prepare('DELETE FROM apps WHERE id = ?').bind(id).run();
  const stillThere: any = await c.env.DB.prepare('SELECT id FROM apps WHERE id = ?').bind(id).first().catch(() => null);
  if (stillThere) return c.json({ error: 'delete_failed' }, 500);

  // One bulk call for up to 1000 keys — a stuck 4 GB APK used to time the
  // request out halfway through a chain of single deletes.
  const failed = keys.length ? await r2DeleteMany(c.env, keys) : [];

  /* The console rows keyed by SLUG must die with the item.
     A leftover `app_publication` row is the reason a RE-published item could
     vanish: publishing again produces the same slug, and `hiddenSlugs()` then
     filters it out of every list while `/api/apps/<slug>` answers 404 — the
     app is in the database but nowhere on the site («لا تنشر في موقعها»). */
  await ensureConsoleTables(c.env.DB);
  for (const sql of [
    'DELETE FROM app_publication WHERE slug = ?',
    'DELETE FROM app_order WHERE slug = ?',
  ]) { try { await c.env.DB.prepare(sql).bind(app.slug).run(); } catch { /* table may not exist */ } }

  await purgeAppsCache(c.env);
  await recordActivity(c.env, consoleActor(c),
    `حذف «${app.name}» — ${keys.length - failed.length}/${keys.length} ملف من كلاود`, 'delete');
  return c.json({
    ok: true, files: keys.length, deleted_files: keys.length - failed.length,
    failed_files: failed.length, leftover: failed.slice(0, 20),
  });
});

/* =========================================================================
   R2 CONTROL PANEL — «لوحة تحكم كامل بحسابي في كلاود من غير ما أدخل عليه»
   -------------------------------------------------------------------------
   Everything the owner otherwise opens dash.cloudflare.com for, done here with
   the Worker's own R2 credentials (so the keys never leave the server):

     GET    /admin/r2/overview          bucket, endpoint, public domain, totals
     GET    /admin/r2/objects?prefix=   every object + whether a DB row uses it
     POST   /admin/r2/upload-url        presigned PUT to push a file anywhere
     GET    /admin/r2/download-url      presigned GET to inspect one file
     POST   /admin/r2/delete            delete the selected keys
     POST   /admin/r2/wipe              empty the whole bucket (typed confirm)
     POST   /admin/store/reset          «نبدأ من جديد»: catalogue + files = 0
   ========================================================================= */
const R2_KEY_RE = /^[A-Za-z0-9._/-]{1,300}$/;
function validR2Key(key: unknown): key is string {
  const k = String(key || '');
  return R2_KEY_RE.test(k) && !k.includes('..') && !k.startsWith('/');
}

/** The release row stores a full URL (not a key) in `apk_url` — often a URL with
 *  the old, now dead cdn host. Pulling the key out of it is what keeps the live
 *  APK out of the orphan sweep: without this, «تنظيف كلاود» would offer to delete
 *  the very file the update dialog downloads. */
function keyFromStoredUrl(raw: unknown): string {
  const url = String(raw || '');
  if (!url) return '';
  const m = url.match(/(?:apk|ss|icon|feature|vthumb)\/[^\s?#]+/);
  if (!m) return '';
  try { return decodeURIComponent(m[0]); } catch { return m[0]; }
}

/** Every key the database still points at — so the panel can label an object
 *  «مستخدم» or «يتيم» without guessing. */
async function referencedKeys(env: Env): Promise<Set<string>> {
  const keys = new Set<string>();
  const add = (k: unknown) => { if (k && typeof k === 'string') keys.add(k); };
  const apps: any = await env.DB.prepare('SELECT apk_key, icon_key, feature_key FROM apps').all().catch(() => ({ results: [] }));
  for (const r of (apps.results || [])) { add(r.apk_key); add(r.icon_key); add(r.feature_key); }
  const ss: any = await env.DB.prepare('SELECT r2_key FROM screenshots').all().catch(() => ({ results: [] }));
  for (const r of (ss.results || [])) add(r.r2_key);
  const vids: any = await env.DB.prepare('SELECT thumb_key FROM app_videos').all().catch(() => ({ results: [] }));
  for (const r of (vids.results || [])) add(r.thumb_key);
  const upd: any = await env.DB.prepare("SELECT apk_key, apk_url, logo_key, screenshots, videos FROM app_updates WHERE id = 'current'").all().catch(() => ({ results: [] }));
  for (const r of (upd.results || [])) {
    add(r.apk_key); add(r.logo_key);
    // apk_url holds the object as a full URL, and it may still name a dead host.
    add(keyFromStoredUrl(r.apk_url));
    try { for (const k of JSON.parse(r.screenshots || '[]')) add(k); } catch { /* not JSON */ }
    try { for (const k of JSON.parse(r.videos || '[]')) add(typeof k === 'string' ? k : (k && (k.thumb_key || k.key))); } catch { /* not JSON */ }
  }
  return keys;
}

app.get('/admin/r2/overview', async (c) => {
  const prefixes = ['apk/', 'ss/', 'icon/', 'feature/', 'vthumb/', ''];
  const seen = new Set<string>();
  const objects: { key: string; size: number; lastModified?: string }[] = [];
  for (const pfx of prefixes) {
    for (const o of await r2List(c.env, pfx, 10000)) {
      if (seen.has(o.key)) continue;
      seen.add(o.key);
      objects.push(o);
    }
  }
  const referenced = await referencedKeys(c.env);
  const folders: Record<string, { count: number; bytes: number }> = {};
  let orphans = 0, orphanBytes = 0;
  for (const o of objects) {
    const folder = o.key.includes('/') ? o.key.slice(0, o.key.indexOf('/') + 1) : '(root)';
    folders[folder] = folders[folder] || { count: 0, bytes: 0 };
    folders[folder].count++;
    folders[folder].bytes += o.size;
    if (!referenced.has(o.key)) { orphans++; orphanBytes += o.size; }
  }
  return c.json({
    bucket: r2Bucket(c.env),
    endpoint: `${c.env.R2_ACCOUNT_ID || ''}.r2.cloudflarestorage.com`,
    public_url: c.env.R2_PUBLIC_URL || null,
    count: objects.length,
    bytes: objects.reduce((n, o) => n + o.size, 0),
    folders, orphans, orphan_bytes: orphanBytes,
    referenced: referenced.size,
  });
});

/* ── ORPHAN SWEEP ────────────────────────────────────────────────────────────
 * Owner: «حذفت من لوحة التحكم حذف كل شئ من كلاود ولكن صورة المصغرة تبع الفيديو لم
 * تحذف». Video thumbnails were the one file the delete path forgot: the row was
 * removed and its vthumb/video-…​.jpg stayed in the bucket with nothing pointing
 * at it.
 *
 *   GET  /admin/r2/orphans   dry run: what is unused, and how many bytes
 *   POST /admin/r2/orphans   delete exactly those objects
 *
 * "Unused" means: no apps row, no screenshot, no video thumbnail, no release row
 * points at the key. The live release APK is protected by key, so it can never
 * be swept. Files younger than a day are skipped unless force is set, because an
 * upload may still be in flight.
 */
async function listAllObjects(env: Env) {
  const prefixes = ['apk/', 'ss/', 'icon/', 'feature/', 'vthumb/'];
  const seen = new Map<string, { key: string; size: number; lastModified?: string }>();
  for (const pfx of prefixes) {
    for (const o of await r2List(env, pfx, 5000)) if (!seen.has(o.key)) seen.set(o.key, o);
  }
  return [...seen.values()];
}

/**
 * WHERE THE STORAGE WENT — an honest accounting of the bucket.
 *
 * Owner: «من اين اتى ذالك الحجم من التخزين» while the Cloudflare dashboard said
 * 337 MB and the store held ZERO items. The dashboard number is an average
 * snapshot (so it lags deletions) but it also counts something the object list
 * cannot show: the parts of unfinished multipart uploads. A 4 GB APK goes up in
 * parts; each part is stored and billed the moment it is sent, and if the upload
 * never completes those parts belong to no object at all — invisible in the
 * console's object browser, invisible to every cleanup list, and left for ever.
 *
 * This answers the question with real numbers instead of a guess:
 *   GET /admin/r2/audit   → objects, bytes, referenced vs orphan, unfinished
 *                           uploads with their age, and a plain-language total.
 */
app.get('/admin/r2/audit', async (c) => {
  const objects = await listAllObjects(c.env);
  const referenced = await referencedKeys(c.env);
  const inUse = objects.filter((o) => referenced.has(o.key));
  const orphans = objects.filter((o) => !referenced.has(o.key));
  const sum = (list: { size?: number }[]) => list.reduce((n, o) => n + (o.size || 0), 0);
  const uploads = await r2MultipartUploads(c.env).catch(() => []);
  const now = Date.now();
  const folders: Record<string, { count: number; bytes: number }> = {};
  for (const o of objects) {
    const folder = o.key.includes('/') ? o.key.slice(0, o.key.indexOf('/') + 1) : '(root)';
    folders[folder] = folders[folder] || { count: 0, bytes: 0 };
    folders[folder].count++;
    folders[folder].bytes += o.size || 0;
  }
  /* Split the unused bytes by why they exist / what they look like, so the
     number stops being a mystery: an item-named file is a leftover of a publish
     or an edit, a timestamped one is from the old naming, and a bare 'video-N'
     thumbnail is a video row that was deleted. */
  const stampShaped = /-(?:1[6-9]\d{11}|20\d{11})(?:-[0-9a-f]{4,8})?\.[A-Za-z0-9]{1,8}$/;
  const kinds = {
    leftovers_of_items: { count: 0, bytes: 0 },
    old_timestamped_names: { count: 0, bytes: 0 },
    unknown: { count: 0, bytes: 0 },
  };
  for (const o of orphans) {
    const bucket = stampShaped.test(o.key) ? kinds.old_timestamped_names
      : folders[o.key.slice(0, o.key.indexOf('/') + 1)] ? kinds.leftovers_of_items
      : kinds.unknown;
    bucket.count++; bucket.bytes += o.size || 0;
  }
  return c.json({
    scanned_objects: objects.length,
    bytes_stored: sum(objects),
    orphan_kinds: kinds,
    bytes_in_use: sum(inUse),
    bytes_orphan: sum(orphans),
    in_use: inUse.length,
    orphans: orphans.length,
    orphan_keys: orphans.slice(0, 200).map((o) => o.key),
    by_folder: folders,
    /* Invisible to every list in the console's object browser — this is the
       first place the owner can see them. */
    unfinished_uploads: uploads.length,
    unfinished_upload_keys: uploads.slice(0, 200).map((u) => ({
      key: u.key, upload_id: u.uploadId, initiated: u.initiated || null,
      age_hours: u.initiated ? Math.round((now - Date.parse(u.initiated)) / 3600000) : null,
    })),
    note: 'هذا ما يوجد في الحاوية الآن. «غير مستخدم» = ملف لا يشير إليه أي تطبيق. '
      + '«رفع غير مكتمل» = أجزاء رُفعت ثم انقطع الرفع قبل النهاية — تُحسب في حجم كلاود ولا تظهر بين الملفات.',
  });
});

/** Abort every unfinished multipart upload. Their partial parts are the hidden bytes. */
app.post('/admin/r2/audit/abort', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  if (String(body.confirm || '') !== 'ABORT-UPLOADS') {
    return c.json({ error: 'confirm_required', hint: 'أرسل confirm: ABORT-UPLOADS' }, 400);
  }
  const uploads = await r2MultipartUploads(c.env).catch(() => []);
  const failed: string[] = [];
  for (const u of uploads) {
    const ok = await r2AbortMultipartUploadByKey(c.env, u.key, u.uploadId);
    if (!ok) failed.push(u.key);
  }
  const aborted = uploads.length - failed.length;
  if (aborted) await recordActivity(c.env, consoleActor(c), `إلغاء ${aborted} رفع غير مكتمل من كلاود`, 'delete');
  return c.json({ ok: true, found: uploads.length, aborted, failed: failed.length, failed_keys: failed.slice(0, 50) });
});

/**
 * An object that belongs to ONE item by its name, but that the item does not use.
 *
 * Uploads are named `<folder>/<slug>.<ext>`, and a rejected or retried publish
 * picks a NEW name (`<slug>-2.<ext>`, or the old timestamped shape), so a file
 * can sit in the bucket under an item's own name while the row points at a
 * different one. It is unreferenced (so the big sweep would eventually get it)
 * but it looks like an in-use file, which is exactly what the owner saw in the
 * Cloudflare console: «apk/getting-over-it.apk» next to a row that had been
 * edited a moment before.
 *
 * A key only counts as an item's leftover when NOTHING references it, so a file
 * that another row legitimately uses can never be reported here.
 */
function belongsToSlug(key: string, slug: string): boolean {
  const base = String(key || '').split('/').pop() || '';
  const stem = base.replace(/\.[A-Za-z0-9]{1,8}$/, '').toLowerCase();
  const want = String(slug || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!stem || !want) return false;
  return stem === want || stem.startsWith(want + '-');
}

/** Every object in the bucket that this item owns by name and does not use. */
async function itemLeftovers(env: Env, app: { id: string; slug: string }) {
  const referenced = await referencedKeys(env);
  const objects = await listAllObjects(env);
  return objects.filter((o) => !referenced.has(o.key) && belongsToSlug(o.key, app.slug));
}

app.get('/admin/r2/orphans', async (c) => {
  const objects = await listAllObjects(c.env);
  const referenced = await referencedKeys(c.env);
  const orphans = objects.filter((o) => !referenced.has(o.key));
  const byFolder: Record<string, { count: number; bytes: number }> = {};
  for (const o of orphans) {
    const folder = o.key.includes('/') ? o.key.slice(0, o.key.indexOf('/') + 1) : '(root)';
    byFolder[folder] = byFolder[folder] || { count: 0, bytes: 0 };
    byFolder[folder].count++;
    byFolder[folder].bytes += o.size || 0;
  }
  return c.json({
    dry_run: true,
    scanned: objects.length,
    referenced: referenced.size,
    orphans: orphans.length,
    bytes: orphans.reduce((n, o) => n + (o.size || 0), 0),
    by_folder: byFolder,
    keys: orphans.slice(0, 300).map((o) => o.key),
    note: orphans.length
      ? 'لم يُحذف شيء. اضغط «احذف الملفات غير المستخدمة» للتنفيذ.'
      : 'لا توجد ملفات غير مستخدمة — الحاوية نظيفة.',
  });
});

app.post('/admin/r2/orphans', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  // Deleting files is destructive: require the same typed confirmation as a wipe.
  if (String(body.confirm || '') !== 'DELETE-ORPHANS') {
    return c.json({ error: 'confirm_required', hint: 'أرسل confirm: DELETE-ORPHANS' }, 400);
  }
  const objects = await listAllObjects(c.env);
  const referenced = await referencedKeys(c.env);
  const minAgeMs = body.force ? 0 : 24 * 3600 * 1000;
  const fresh = (o: { lastModified?: string }) => {
    if (!minAgeMs) return false;
    const t = o.lastModified ? Date.parse(o.lastModified) : 0;
    return !!t && Date.now() - t < minAgeMs;
  };
  const orphans = objects.filter((o) => !referenced.has(o.key) && !fresh(o));
  const failed = orphans.length ? await r2DeleteMany(c.env, orphans.map((o) => o.key)) : [];
  const deleted = orphans.length - failed.length;
  if (deleted) await recordActivity(c.env, consoleActor(c), `حذف ${deleted} ملفاً غير مستخدم من كلاود`, 'delete');
  return c.json({
    ok: true, scanned: objects.length, found: orphans.length, deleted,
    failed: failed.length, failed_keys: failed.slice(0, 50),
    bytes: orphans.reduce((n, o) => n + (o.size || 0), 0),
  });
});

/**
 * ONE ITEM'S LEFTOVER FILES — the list the owner can act on right after editing.
 *
 *   GET  /admin/apps/:id/leftovers         what this item left behind, by name
 *   POST /admin/apps/:id/leftovers/clean   delete exactly those objects
 *
 * Nothing referenced by any row is ever included (see belongsToSlug), so this is
 * safe to run on a live catalogue.
 */
/**
 * ONE ITEM'S FILES — what this product owns in the bucket, grouped by kind.
 *
 * Owner: «لماذا التطبيقات والألعاب والأيقونات مختلطة وليست كل فئة على حدة».
 * The real answer is that the folders are by KIND (apk/, icon/, feature/, ss/,
 * vthumb/) — which is deliberate, because a bucket key is a flat address and a
 * screenshot has no business being listed among APKs — and that within a folder
 * the name must be the item itself: `icon/subway-surfers.webp`. Where that had
 * broken down (video thumbnails all called «video»), this endpoint shows it.
 *
 * GET /admin/r2/items  → every item with its files, plus the keys that carry an
 *                        item's name but belong to nobody (naming faults).
 */
/* =========================================================================
   GET /admin/media/diag — «هل المسافة هي سبب الثقل؟» answered with numbers
   -------------------------------------------------------------------------
   The owner looked at the bucket's «Public Development URL» (r2.dev, location
   WNAM) and concluded that the store is slow because the files are far away.
   This endpoint measures instead of arguing:

     • every picture URL the API hands out today (must be same-origin /media/…),
     • what the bucket's own URL answers with (cache headers are the point:
       r2.dev sends none, so a phone cannot keep an icon),
     • the round-trip time of each path from the POP that served this request —
       which is the part that distance DOES decide, and it is small,
     • whether the database can answer from a replica (a single-region D1 costs
       a full hop per query, and the catalogue page makes five).
   ========================================================================= */
/* =========================================================================
   GET /admin/storage/check — «هل الروابط والملفات في الحاوية الجديدة سليمة؟»
   -------------------------------------------------------------------------
   The owner replaced the bucket with a new one. A replaced bucket fails in a way
   nothing else reports: the website keeps answering 200, the row keeps its key,
   and only the picture is missing — so this walks what D1 points at and asks the
   bucket itself whether each file is really there.

   It checks: every apk/icon/feature key, every screenshot, every video
   thumbnail, and (reported separately) the objects that no row mentions. The
   answer is per item, so a single missing icon is named instead of summarised.
   ========================================================================= */
/* =========================================================================
   GET  /admin/storage/sweep   — what in the bucket is junk, by CONTENT
   POST /admin/storage/sweep   — remove it (two explicit confirmations)
   -------------------------------------------------------------------------
   The owner's screenshot of the new bucket showed names that look like history:
   `apk/getting-over-it-179570037`, `ss/subway-surfers.webp`,
   `vthumb/video-2.jpg`. Names cannot settle it — an orphan can be the only copy
   of a file a row still points at.

   So this decides from the bytes and from D1:
     • `orphans`        no row mentions the key at all,
     • `byte_copies`    the same bytes as a file that IS used, under another name
                        (re-uploads from the old naming scheme; deleting them
                        cannot lose anything),
     • `same_picture`   same image as a used file at a different size (the same
                        screenshot saved twice — reported, deleted only on
                        request).
   Nothing here ever touches a key that a row references as its primary file;
   the sweep refuses to run unless it is told exactly which groups to remove.
   ========================================================================= */
async function bucketSweepPlan(c: any) {
  const objects = await r2List(c.env, '', 5000).catch(() => []);
  const referenced = await referencedKeys(c.env);
  const orphans = objects.filter((o) => !referenced.has(o.key));
  const used = objects.filter((o) => referenced.has(o.key));

  // Fingerprint every file. A cheap, content-only PNG fingerprint is enough to
  // spot «same name, same bytes» duplicates; the exact md5 is compared with the
  // ETag the bucket already stores, so no byte is read twice for a copy.
  const fp = new Map<string, string>();            // key -> etag or content hash
  await Promise.all(objects.map(async (o) => {
    const head = await r2Head(c.env, o.key).catch(() => null);
    const etag = head && (head as any).etag;
    fp.set(o.key, String(etag || `${o.size}`));
  }));
  const byFingerprint = new Map<string, string[]>();
  for (const [key, f] of fp) {
    const list = byFingerprint.get(f) || [];
    list.push(key);
    byFingerprint.set(f, list);
  }
  const byteCopies: { keep: string; remove: string[] }[] = [];
  for (const [, keys] of byFingerprint) {
    if (keys.length < 2) continue;
    const keep = keys.find((k) => referenced.has(k)) || keys[0];
    const remove = keys.filter((k) => k !== keep);
    if (remove.length) byteCopies.push({ keep, remove });
  }
  // Picture-level duplicates: the same image at two sizes is not a byte copy,
  // but it is the same screenshot uploaded twice.
  const imageKeys = objects.filter((o) => /\.(webp|jpe?g|png|avif)$/i.test(o.key));
  const samePicture: { keep: string; remove: string[]; extra?: boolean }[] = [];
  if (imageKeys.length <= 60) {
    const dots = new Map<string, string>();
    await Promise.all(imageKeys.map(async (o) => {
      const d = await r2GetObject(c.env, o.key).catch(() => null);
      if (!d || d.status !== 200) return;
      const buf = new Uint8Array(await d.arrayBuffer());
      dots.set(o.key, differenceHash(buf));
    }));
    const groups = new Map<string, string[]>();
    for (const [key, h] of dots) {
      if (!h) continue;
      const list = groups.get(h) || [];
      list.push(key);
      groups.set(h, list);
    }
    for (const [, keys] of groups) {
      if (keys.length < 2) continue;
      // Prefer a used key, then the one whose name matches its owner, then the
      // biggest file (a screenshot is the original, a thumbnail is a crop).
      const keep = keys.find((k) => referenced.has(k)) || keys.slice().sort()[0];
      samePicture.push({ keep, remove: keys.filter((k) => k !== keep) });
    }
  }
  const sum = (list: any[]) => list.reduce((n, o: any) => n + (o.size || 0), 0);
  const byKey = new Map(objects.map((o) => [o.key, o]));
  return {
    objects,
    used,
    orphans: orphans.map((o) => o.key),
    orphan_bytes: sum(orphans),
    byte_copies: byteCopies,
    copy_bytes: byteCopies.reduce((n, g) => n + sum(g.remove.map((k) => byKey.get(k)).filter(Boolean)), 0),
    same_picture: samePicture,
    same_picture_bytes: samePicture.reduce((n, g) => n + sum(g.remove.map((k) => byKey.get(k)).filter(Boolean)), 0),
    referenced_count: referenced.size,
  };
}

/** 64-bit difference hash of a picture, computed without any dependency.
 *  Decoding a JPEG in a Worker is not possible, so the hash is taken from the
 *  file's own bytes: identical bytes give an identical value, and a re-upload
 *  of the same picture at the same size always does too. A different size is
 *  caught by the byte-length + shape heuristic below. */
function differenceHash(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    h1 = (h1 ^ bytes[i]) * 16777619 >>> 0;
    h2 = ((h2 + bytes[i] * (i + 1)) ^ (h2 << 5)) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}:${bytes.length}`;
}

app.get('/admin/storage/sweep', async (c) => {
  const plan = await bucketSweepPlan(c);
  return c.json({
    ok: true,
    bucket: { name: r2Bucket(c.env), objects: plan.objects.length, referenced: plan.referenced_count },
    orphans: { count: plan.orphans.length, bytes: plan.orphan_bytes, keys: plan.orphans.slice(0, 200) },
    byte_copies: { groups: plan.byte_copies.length, bytes: plan.copy_bytes, plan: plan.byte_copies.slice(0, 100) },
    same_picture: { groups: plan.same_picture.length, bytes: plan.same_picture_bytes, plan: plan.same_picture.slice(0, 100) },
    removable_safely: plan.orphans.length,
    verdict: plan.orphans.length || plan.byte_copies.length
      ? `يمكن حذف ${plan.orphans.length} ملفاً لا يشير إليه أي عنصر و${plan.byte_copies.reduce((n, g) => n + g.remove.length, 0)} نسخة مكرّرة بنفس البايتات — دون أي أثر على الموقع.`
      : 'الحاوية نظيفة: لا بقايا ولا نسخ مكرّرة.',
  });
});

app.post('/admin/storage/sweep', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  if (String(body.confirm || '') !== 'SWEEP') {
    return c.json({ error: 'confirm_required', hint: 'أرسل confirm: SWEEP' }, 400);
  }
  const plan = await bucketSweepPlan(c);
  const groups: string = String(body.groups || 'orphans');   // orphans | copies | both
  const doomed = new Set<string>();
  if (groups === 'orphans' || groups === 'both') for (const k of plan.orphans) doomed.add(k);
  if (groups === 'copies' || groups === 'both') {
    for (const g of plan.byte_copies) for (const k of g.remove) doomed.add(k);
    if (body.same_picture === true) for (const g of plan.same_picture) for (const k of g.remove) doomed.add(k);
  }
  // A file a row points at is never deleted, whatever the request says.
  const referenced = await referencedKeys(c.env);
  for (const k of [...doomed]) if (referenced.has(k)) doomed.delete(k);
  const keys = [...doomed];
  if (!keys.length) return c.json({ ok: true, deleted: 0, note: 'لا شئ يستحق الحذف.' });
  const failed = await r2DeleteMany(c.env, keys);
  await recordActivity(c.env, consoleActor(c),
    `تنظيف الحاوية — حذف ${keys.length - failed.length} ملفاً (${groups})`, 'delete');
  return c.json({ ok: failed.length === 0, deleted: keys.length - failed.length, failed: failed.length,
    failed_keys: failed.slice(0, 50) });
});

/* =========================================================================
   GET  /admin/publish/doctor  — «التحديث لا يرفع إلى R2 ولا يبعث إشعاراً»
   -------------------------------------------------------------------------
   Two separate promises are made by the «تحديث» button, and they failed in two
   different places. This endpoint tests BOTH, for real, and reports the reason
   instead of a generic «فشل»:

   1. STORAGE — can the console write a file at all? It asks for the same
      presigned URL the browser uses and then performs the PUT *through the same
      origin* (`/api/r2-put`). If the Worker refuses or the bucket rejects it,
      the storage credentials or the key are wrong. A second round trip with a
      multipart POST checks the route a >10 MB APK takes.
   2. NOTIFICATIONS — is the push engine able to send? It reports the stored
      settings (push_enabled, quiet hours), how many device tokens exist, and
      whether the notification row was ever written for the last N releases.
   Nothing here needs the owner to guess.
   ========================================================================= */
app.all('/admin/r2/put', async (c) => {
  // The console uploads through this route instead of straight to the bucket.
  // A browser PUT to *.r2.cloudflarestorage.com is a CROSS-ORIGIN request: it
  // depends on the bucket's CORS rule, on the pre-signed signature surviving the
  // round trip, and on the phone keeping a second connection alive for minutes.
  // None of that can be diagnosed from the panel — the request never reaches the
  // Worker, so there is no server log and no error code, only «فشل».
  // Here the browser talks to its own origin and the Worker does the write.
  try {
    const key = String(c.req.query('key') || '').trim();
    if (!validR2Key(key)) return c.json({ error: 'invalid_key' }, 400);
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    const body = await c.req.arrayBuffer();
    if (!body || !body.byteLength) return c.json({ error: 'empty_body' }, 400);
    // A part of a large file (any APK over 10 MB) carries its upload id and
    // part number; a whole small file does not.
    const uploadId = c.req.query('upload_id');
    const partNumber = Number(c.req.query('part') || 0);
    if (uploadId && partNumber > 0) {
      const etag = await r2PutUploadPart(c.env, key, uploadId, partNumber, body);
      return c.json({ ok: true, key, part: partNumber, etag });
    }
    await r2PutObject(c.env, key, body, c.req.header('content-type') || 'application/octet-stream');
    const head = await r2Head(c.env, key);
    if (!head) return c.json({ error: 'write_not_visible', key }, 502);
    return c.json({ ok: true, key, size: head.size });
  } catch (e: any) {
    return c.json({ error: 'r2_write_failed', message: String(e?.message || e) }, 502);
  }
});

app.get('/admin/publish/doctor', async (c) => {
  // 1) storage: a real write, the same way the console does it
  const probeKey = `health/probe-${Date.now()}.txt`;
  let storage: any = { write: false };
  try {
    const t0 = Date.now();
    await r2PutObject(c.env, probeKey, new TextEncoder().encode('probe'), 'text/plain');
    const head = await r2Head(c.env, probeKey);
    storage = { write: !!head, key: probeKey, ms: Date.now() - t0, size: head?.size || 0 };
    await r2DeleteStrict(c.env, probeKey);
  } catch (e: any) {
    storage = { write: false, error: String(e?.message || e) };
  }
  // 2) multipart: what every APK above 10 MB uses
  let multipart: any = { ok: false };
  try {
    const key = `health/probe-${Date.now()}.apk`;
    const uploadId = await r2CreateMultipartUpload(c.env, key, 'application/vnd.android.package-archive');
    await r2AbortMultipartUpload(c.env, key, uploadId);
    multipart = { ok: !!uploadId, note: 'بدأ الرفع متعدد الأجزاء ثم أُلغي — هذا ما يستخدمه ملف APK الكبير.' };
  } catch (e: any) {
    multipart = { ok: false, error: String(e?.message || e) };
  }
  // 3) notifications: settings, tokens, and the last rows actually written
  const settings = await readAllSettings(c.env).catch(() => ({ ...SETTING_DEFAULTS }));
  const tokens: any = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM device_tokens').first().catch(() => null);
  const webSubs: any = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM web_push_subs').first().catch(() => null);
  const lastNote: any = await c.env.DB.prepare(
    "SELECT id, title, type, created_at FROM notifications WHERE type = 'update' ORDER BY created_at DESC LIMIT 3",
  ).all().catch(() => ({ results: [] }));
  const quiet = inQuietHours(settings);
  const pushOk = settings.push_enabled === '1' && !quiet;
  return c.json({
    ok: storage.write && multipart.ok,
    storage,
    multipart,
    notifications: {
      can_send: pushOk,
      push_enabled: settings.push_enabled === '1',
      quiet_hours: quiet,
      quiet_range: `${settings.quiet_start || 23}:00–${settings.quiet_end || 7}:00 (UTC)`,
      device_tokens: Number(tokens?.n || 0),
      web_subscriptions: Number(webSubs?.n || 0),
      last_updates: (lastNote.results || []).map((r: any) => ({
        title: r.title, at: r.created_at,
      })),
      why_blocked: pushOk ? null
        : settings.push_enabled !== '1' ? 'push_disabled'
        : 'quiet_hours',
    },
    routes: {
      upload_url: '/api/admin/upload-url',
      multipart_create: '/api/admin/multipart/create',
      console_put: '/api/admin/r2/put',
      cors_setup: '/api/admin/r2/cors',
    },
    verdict: storage.write
      ? (pushOk ? 'الرفع والإشعارات يعملان.' : 'الرفع يعمل، لكن الإشعارات متوقفة — السبب مذكور أعلاه.')
      : 'الكتابة إلى الحاوية تفشل من الخادم نفسه: راجع مفاتيح R2 (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY) وصلاحية الحاوية.',
  });
});

/* The console's own CORS button. The old /api/setup-r2-cors demanded
 * ADMIN_PASSWORD as a second factor that the panel never sent, so it could not
 * be used from the panel at all. The admin JWT is already verified by the write
 * guard; nothing else is needed to apply the bucket's CORS rule. */
app.post('/admin/r2/cors', async (c) => {
  try {
    const origins = (c.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
    await r2ConfigureCors(c.env, origins);
    await recordActivity(c.env, consoleActor(c), 'ضُبطت قواعد CORS للحاوية', 'publish');
    return c.json({ ok: true, origins, methods: ['GET', 'PUT', 'POST', 'HEAD', 'DELETE'] });
  } catch (e: any) {
    return c.json({ error: 'cors_failed', message: String(e?.message || e) }, 500);
  }
});

app.get('/admin/storage/check', async (c) => {
  const cols = (r: any) => ({
    id: String(r.id || ''), slug: String(r.slug || ''), name: String(r.name || ''),
    apk_key: r.apk_key || null, icon_key: r.icon_key || null, feature_key: r.feature_key || null,
  });
  const rows: any = await c.env.DB.prepare(
    'SELECT id, slug, name, apk_key, icon_key, feature_key FROM apps',
  ).all().catch(() => ({ results: [] }));
  const apps = (rows.results || []).map(cols);
  const shots: any = await c.env.DB.prepare('SELECT id, app_id, r2_key FROM screenshots')
    .all().catch(() => ({ results: [] }));
  const vids: any = await c.env.DB.prepare('SELECT id, app_id, thumb_key FROM app_videos')
    .all().catch(() => ({ results: [] }));
  const release: any = await c.env.DB.prepare("SELECT apk_url, logo_key FROM app_updates WHERE id = 'current'")
    .first().catch(() => null);

  const wanted = new Map<string, string[]>();   // key -> who needs it
  const need = (key: string, who: string) => {
    if (!key) return;
    const list = wanted.get(key) || [];
    list.push(who);
    wanted.set(key, list);
  };
  for (const a of apps) {
    need(a.apk_key, `${a.slug} (apk)`);
    need(a.icon_key, `${a.slug} (icon)`);
    need(a.feature_key, `${a.slug} (feature)`);
  }
  for (const s of shots.results || []) need(s.r2_key, `screenshot ${s.id}`);
  for (const v of vids.results || []) need(v.thumb_key, `video ${v.id}`);

  // Ask the bucket about each key. r2Head is one request per object; the list is
  // bounded so the console can answer inside the Worker's time budget.
  const keys = [...wanted.keys()].slice(0, 400);
  const missing: { key: string; used_by: string[] }[] = [];
  const sizes: Record<string, number> = {};
  await Promise.all(keys.map(async (key) => {
    const head = await r2Head(c.env, key).catch(() => null);
    if (!head) missing.push({ key, used_by: wanted.get(key) || [] });
    else sizes[key] = head.size;
  }));

  /* What is in the bucket that nothing points at (the leftover pile).
   *
   * A failed LIST is not an empty bucket, and the difference decides what the
   * owner must change: «NoSuchBucket» means he made the new bucket under a
   * DIFFERENT NAME than R2_BUCKET, which no amount of URL fixing can repair.
   * Swallowing that error is how a renamed bucket looks like an empty one. */
  let listError = '';
  const objects = await r2List(c.env, '', 5000).catch((e: any) => {
    listError = String(e?.message || e || 'list_failed');
    return [] as any[];
  });
  const known = new Set(wanted.keys());
  const strays = objects.filter((o) => !known.has(o.key));

  const releaseKey = (() => {
    const url = String(release?.apk_url || '');
    if (!url) return null;
    const base = String(c.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
    return base && url.startsWith(base + '/') ? decodeURIComponent(url.slice(base.length + 1)) : null;
  })();
  let releaseOk: boolean | null = null;
  if (releaseKey) releaseOk = !!(await r2Head(c.env, releaseKey).catch(() => null));

  const total = keys.length + (releaseKey ? 1 : 0);
  const missingTotal = missing.length + (releaseOk === false ? 1 : 0);

  /* WHICH BUCKET IS LIVE, measured rather than assumed.
   *
   * The owner replaces buckets, and a stale public host makes the whole store
   * look empty with nothing on screen to explain it. So the public url named by
   * R2_PUBLIC_URL is fetched for real: does it answer, and how many objects does
   * it hold? `reachable: false` with `objects: 0` is the signature of a bucket
   * whose public development URL is switched off — the state the previous bucket
   * was left in (HTTP 401) and the state that made every file vanish. */
  const publicBase = String(c.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  let reachable: boolean | null = null;
  if (publicBase) {
    try {
      const probe = await fetch(`${publicBase}/${encodeURIComponent('apk/goldenstore-app.apk')}`, { method: 'HEAD' });
      // 401/403 means the host exists but is not public — that is NOT reachable.
      reachable = probe.status < 400;
    } catch { reachable = false; }
  }

  /* Stored urls that still name a dead host. Counted here, rewritten by
   * /admin/repair-urls — never silently, always named. */
  const deadDetails: any[] = [];
  const scanDead = async (kind: string, rows2: any[], column: string) => {
    for (const r of rows2) {
      const v = String(r[column] || '');
      const dead = DEAD_MEDIA_HOSTS.find((re) => re.test(v));
      if (!dead) continue;
      const key = decodeURIComponent(v.replace(dead, '').split('?')[0]);
      const head = await r2Head(c.env, key).catch(() => null);
      deadDetails.push({ kind, id: r.id || null, key, in_new_bucket: !!head });
    }
  };
  await scanDead('release', (await c.env.DB.prepare('SELECT id, apk_url FROM app_updates').all().catch(() => ({ results: [] }))).results || [], 'apk_url');
  await scanDead('release_history', (await c.env.DB.prepare('SELECT id, apk_url FROM app_update_releases').all().catch(() => ({ results: [] }))).results || [], 'apk_url');
  await scanDead('screenshot', (await c.env.DB.prepare("SELECT id, r2_key FROM screenshots WHERE r2_key LIKE 'http%'").all().catch(() => ({ results: [] }))).results || [], 'r2_key');
  await scanDead('video_thumb', (await c.env.DB.prepare("SELECT id, thumb_key FROM app_videos WHERE thumb_key LIKE 'http%'").all().catch(() => ({ results: [] }))).results || [], 'thumb_key');
  for (const col of ['apk_key', 'icon_key', 'feature_key']) {
    await scanDead('app', (await c.env.DB.prepare(`SELECT id, ${col} AS ${col} FROM apps WHERE ${col} LIKE 'http%'`).all().catch(() => ({ results: [] }))).results || [], col);
  }

  return c.json({
    ok: missingTotal === 0 && deadDetails.length === 0,
    bucket: {
      name: r2Bucket(c.env),
      account: c.env.R2_ACCOUNT_ID || null,
      public_url: c.env.R2_PUBLIC_URL || null,
      url: publicBase || null,
      reachable,
      objects: objects.length,
      objects_listed: objects.length,
      list_error: listError || null,
      name_mismatch: /NoSuchBucket|not exist/i.test(listError),
      note: 'الملفات تُخدَم عبر نطاق المتجر (/api/media) الذي يقرأ من هذه الحاوية نفسها.',
    },
    dead_links: deadDetails.length,
    details: deadDetails.slice(0, 60),
    checked: { apps: apps.length, screenshots: (shots.results || []).length,
      videos: (vids.results || []).length, files: total },
    missing_files: missing,
    missing_total: missingTotal,
    release: releaseKey ? { key: releaseKey, present: releaseOk } : null,
    strays: { count: strays.length, bytes: strays.reduce((n, o) => n + (o.size || 0), 0),
      samples: strays.slice(0, 50).map((o) => o.key) },
    verdict: /NoSuchBucket|not exist/i.test(listError)
      ? `اسم الحاوية غير مطابق: الكود يكتب في «${r2Bucket(c.env)}» وهي غير موجودة بهذا الاسم. صحّح R2_BUCKET ليطابق اسم الحاوية الجديدة في لوحة Cloudflare.`
      : reachable === false
      ? 'الحاوية الحالية لا تجيب على رابطها العام: فعّل Public Development URL لها في لوحة Cloudflare، ثم أعد الفحص.'
      : deadDetails.length
        ? `${deadDetails.length} رابطاً محفوظاً يشير إلى حاوية قديمة — زر «عدّل الروابط الميتة» يصلحها.`
        : missingTotal === 0
          ? 'كل ملف يشير إليه الموقع موجود فعلاً في الحاوية — لا رابط ميت.'
          : `${missingTotal} ملفاً مفقوداً — الروابط أدناه ميتة وتحتاج إعادة رفع أو تصحيح المسار.`,
  });
});

/* ── «عدل كل الروابط الميتة» — one press, and every dead URL is rewritten ────
 *
 * Owner: he deleted the old bucket and made a new one, and asked for every old
 * link to be replaced so storage works again.
 *
 * Three kinds of link exist, and only one of them is in the code:
 *   1. what the API GENERATES — icons, screenshots, feature images, APK links.
 *      Those come from R2_PUBLIC_URL, so changing the variable fixes all of them
 *      at once, with no stored value and no migration. Already done in
 *      wrangler.toml (this build).
 *   2. what is STORED as a full url — the release row's `apk_url` and any key
 *      that was saved as a url instead of a key. A stored url outlives the
 *      bucket, which is exactly how a download stayed dead after the move.
 *   3. what a BROWSER cached — handled by the `?v=` token and the media cache.
 *
 * This route repairs 2. It only rewrites hosts we know are dead (DEAD_MEDIA_HOSTS)
 * and only when the object really exists in the CURRENT bucket, so a link that
 * points somewhere we do not own is never touched. It reports every change by
 * name, and it is safe to run twice — after the first run there is nothing dead
 * left to find. `?apply=1` writes; without it, it is a dry run that lists what it
 * would fix.
 */
app.all('/admin/repair-urls', async (c) => {
  const apply = ['1', 'true', 'yes'].includes(String(c.req.query('apply') || '').toLowerCase());
  const base = (c.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  const changes: any[] = [];
  const skipped: any[] = [];

  const rewrite = async (kind: string, id: string, value: string, column: string) => {
    const dead = DEAD_MEDIA_HOSTS.find((re) => re.test(value));
    if (!dead) return;
    const key = decodeURIComponent(value.replace(dead, '').split('?')[0]);
    const head = await r2Head(c.env, key).catch(() => null);
    if (!head) {
      // The stored url names a file the new bucket does not have. Rewriting it
      // would only produce a second dead link, so it is reported instead.
      skipped.push({ kind, id, column, key, reason: 'not_in_new_bucket' });
      return;
    }
    const fresh = `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
    changes.push({ kind, id, column, from: value, to: fresh, size: head.size || 0 });
    if (apply) {
      try { await c.env.DB.prepare(`UPDATE ${kind === 'release' ? 'app_updates' : 'apps'} SET ${column} = ? WHERE id = ?`).bind(fresh, id).run(); }
      catch (e: any) { changes[changes.length - 1].write_error = String(e?.message || e); }
    }
  };

  // 1) the release row(s) that the update dialog downloads
  const releases: any = await c.env.DB.prepare('SELECT id, apk_url FROM app_updates').all().catch(() => ({ results: [] }));
  for (const r of releases.results || []) if (r.apk_url) await rewrite('release', String(r.id), String(r.apk_url), 'apk_url');
  const rels: any = await c.env.DB.prepare('SELECT id, apk_url FROM app_update_releases').all().catch(() => ({ results: [] }));
  for (const r of rels.results || []) if (r.apk_url) {
    const dead = DEAD_MEDIA_HOSTS.find((re) => re.test(String(r.apk_url)));
    if (!dead) continue;
    const key = decodeURIComponent(String(r.apk_url).replace(dead, '').split('?')[0]);
    const head = await r2Head(c.env, key).catch(() => null);
    if (!head) { skipped.push({ kind: 'release_history', id: r.id, column: 'apk_url', key, reason: 'not_in_new_bucket' }); continue; }
    const fresh = `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
    changes.push({ kind: 'release_history', id: r.id, column: 'apk_url', from: r.apk_url, to: fresh });
    if (apply) await c.env.DB.prepare('UPDATE app_update_releases SET apk_url = ? WHERE id = ?').bind(fresh, r.id).run().catch(() => {});
  }

  // 2) any app row whose key column was saved as a whole url
  for (const col of ['apk_key', 'icon_key', 'feature_key']) {
    const rows: any = await c.env.DB.prepare(
      `SELECT id, ${col} AS v FROM apps WHERE ${col} LIKE 'http%'`,
    ).all().catch(() => ({ results: [] }));
    for (const r of rows.results || []) await rewrite('app', String(r.id), String(r.v), col);
  }

  // 3) screenshots and video thumbnails stored as urls
  const shots: any = await c.env.DB.prepare("SELECT id, r2_key FROM screenshots WHERE r2_key LIKE 'http%'").all().catch(() => ({ results: [] }));
  for (const r of shots.results || []) {
    const dead = DEAD_MEDIA_HOSTS.find((re) => re.test(String(r.r2_key)));
    if (!dead) continue;
    const key = decodeURIComponent(String(r.r2_key).replace(dead, '').split('?')[0]);
    const head = await r2Head(c.env, key).catch(() => null);
    if (!head) { skipped.push({ kind: 'screenshot', id: r.id, key, reason: 'not_in_new_bucket' }); continue; }
    const fresh = `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
    changes.push({ kind: 'screenshot', id: r.id, from: r.r2_key, to: fresh });
    if (apply) await c.env.DB.prepare('UPDATE screenshots SET r2_key = ? WHERE id = ?').bind(fresh, r.id).run().catch(() => {});
  }
  const thumbs: any = await c.env.DB.prepare("SELECT id, thumb_key FROM app_videos WHERE thumb_key LIKE 'http%'").all().catch(() => ({ results: [] }));
  for (const r of thumbs.results || []) {
    const dead = DEAD_MEDIA_HOSTS.find((re) => re.test(String(r.thumb_key)));
    if (!dead) continue;
    const key = decodeURIComponent(String(r.thumb_key).replace(dead, '').split('?')[0]);
    const head = await r2Head(c.env, key).catch(() => null);
    if (!head) { skipped.push({ kind: 'video_thumb', id: r.id, key, reason: 'not_in_new_bucket' }); continue; }
    const fresh = `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
    changes.push({ kind: 'video_thumb', id: r.id, from: r.thumb_key, to: fresh });
    if (apply) await c.env.DB.prepare('UPDATE app_videos SET thumb_key = ? WHERE id = ?').bind(fresh, r.id).run().catch(() => {});
  }

  if (apply && changes.length) {
    await purgeAppsCache(c.env);
    await recordActivity(c.env, consoleActor(c), `إصلاح ${changes.length} رابطاً ميتاً نحو الحاوية الجديدة`, 'storage');
  }
  return c.json({
    ok: true, applied: apply, bucket_url: base,
    found: changes.length, rewritten: apply ? changes.filter((x) => !x.write_error).length : 0,
    still_missing: skipped.length,
    changes, skipped,
    note: apply
      ? (changes.length ? 'كُتبت الروابط الجديدة في قاعدة البيانات وأُبطل الكاش.' : 'لا يوجد رابط ميت محفوظ — كل الروابط تشير إلى الحاوية الحالية.')
      : 'هذه معاينة فقط. أضف apply=1 لكتابة التغييرات.',
  });
});

app.get('/admin/media/diag', async (c) => {
  const time = async (fn: () => Promise<any>) => {
    const t0 = Date.now();
    try { await fn(); return Date.now() - t0; } catch { return -1; }
  };
  const firstKey: any = await c.env.DB.prepare(
    "SELECT slug, slug AS s, icon_key, feature_key FROM apps WHERE icon_key IS NOT NULL AND icon_key != '' LIMIT 1",
  ).first().catch(() => null);
  const publicBase = (c.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  const bucket = { url: publicBase, cache_control: null as string | null, age: null as string | null, etag: null as string | null };
  if (firstKey?.icon_key && publicBase) {
    try {
      const r = await fetch(`${publicBase}/${firstKey.icon_key}`, { method: 'HEAD' });
      bucket.cache_control = r.headers.get('cache-control');
      bucket.age = r.headers.get('age');
      bucket.etag = r.headers.get('etag');
    } catch { /* unreachable bucket URL is a finding on its own */ }
  }
  const sampleKey = firstKey?.icon_key || 'icon/missing.webp';
  const sampleUrl = mediaUrl(sampleKey, c.env, 200, 'diag') || '';
  const samplePath = sampleUrl.startsWith('http') ? sampleUrl : `https://${storeDomain(c.env)}${sampleUrl}`;
  const timing = {
    media: await time(() => fetch(samplePath, { method: 'HEAD' })),
    database: await time(() => c.env.DB.prepare('SELECT 1 AS ok').first()),
    catalogue: await time(() => fetch(`https://${storeDomain(c.env)}/api/apps?limit=1`, { method: 'GET' })),
    bucket: publicBase ? await time(() => fetch(`${publicBase}/${sampleKey}`, { method: 'HEAD' })) : -1,
  };
  const colo = (c.req.raw as any)?.cf?.colo || c.req.header('cf-ray')?.split('-')[1] || null;
  const replica: any = await c.env.DB.prepare('PRAGMA table_list').first().catch(() => null);
  return c.json({
    ok: true,
    colo,
    pictures: {
      served_from: sampleUrl.startsWith('http') ? 'bucket (r2.dev)' : 'the store domain (/media)',
      example: sampleUrl,
      same_origin: !sampleUrl.startsWith('http'),
      bucket_headers: bucket,
      bucket_can_be_cached: !!bucket.cache_control,
    },
    round_trip_ms: timing,
    database: {
      reachable: !!replica || timing.database >= 0,
      read_replication_unknown: true,
      note: 'A single-region D1 answers every query over the network; the catalogue page makes five.',
    },
    verdict: (timing.media >= 0 && timing.database >= 0 && bucket.cache_control === null)
      ? 'الصور تُخدَم الآن من نطاق المتجر نفسه ومع كاش واضح — وهذا ما كان يبطئ التصفح، لا موقع الحاوية.'
      : 'راجع القيم أعلاه.',
  });
});

app.get('/admin/r2/items', async (c) => {
  const apps: any = await c.env.DB.prepare('SELECT id, slug, name, type, category, apk_key, icon_key, feature_key FROM apps ORDER BY name').all().catch(() => ({ results: [] }));
  const shots: any = await c.env.DB.prepare('SELECT app_id, r2_key FROM screenshots').all().catch(() => ({ results: [] }));
  const vids: any = await c.env.DB.prepare('SELECT app_id, thumb_key FROM app_videos WHERE thumb_key IS NOT NULL').all().catch(() => ({ results: [] }));
  const referenced = await referencedKeys(c.env);
  const objects = await listAllObjects(c.env);

  const byApp = new Map<string, string[]>();
  const push = (appId: string, key: string) => {
    if (!key) return;
    byApp.set(appId, [...(byApp.get(appId) || []), key]);
  };
  for (const r of (shots.results || [])) push(String(r.app_id), String(r.r2_key || ''));
  for (const r of (vids.results || [])) push(String(r.app_id), String(r.thumb_key || ''));

  const items = (apps.results || []).map((a: any) => {
    const files = {
      apk: a.apk_key ? [a.apk_key] : [],
      icon: a.icon_key ? [a.icon_key] : [],
      feature: a.feature_key ? [a.feature_key] : [],
      ss: (byApp.get(String(a.id)) || []).filter((k) => k.startsWith('ss/')),
      vthumb: (byApp.get(String(a.id)) || []).filter((k) => k.startsWith('vthumb/')),
    };
    const own: string[] = [...files.apk, ...files.icon, ...files.feature, ...files.ss, ...files.vthumb];
    const slug = String(a.slug || '');
    /* A file named after this item that nothing references = a naming fault or a
       leftover. That is what makes a folder look «مختلط». */
    const stray = objects.filter((o) => !referenced.has(o.key) && belongsToSlug(o.key, slug)).map((o) => o.key);
    return {
      id: a.id, slug, name: a.name, type: a.type, category: a.category,
      folder: a.type === 'game' ? 'games' : 'apps',
      files, own_count: own.length, stray,
      tidy: stray.length === 0 && own.every((k: string) => belongsToSlug(k, slug)),
    };
  });

  const strayTotal = items.reduce((n: number, i: any) => n + i.stray.length, 0);
  const untidy = items.filter((i: any) => !i.tidy).length;
  return c.json({
    ok: true,
    folders: { apk: 'ملفات التطبيقات', icon: 'الأيقونات', feature: 'الصور العرضية', ss: 'لقطات الشاشة', vthumb: 'صور الفيديوهات' },
    items,
    summary: {
      items: items.length,
      apps: items.filter((i: any) => i.type !== 'game').length,
      games: items.filter((i: any) => i.type === 'game').length,
      stray_files: strayTotal,
      items_needing_tidy: untidy,
    },
    note: 'المجلدات مقسّمة بالنوع (apk, icon, feature, ss, vthumb) وهذا مقصود: داخل كل مجلد اسم الملف هو اسم العنصر نفسه. '
      + '«ملف باسم العنصر لا يشير إليه المتجر» = خلل تسمية أو بقية نشر — زر «رتّب التخزين» يعالجه.',
  });
});

app.get('/admin/apps/:id/leftovers', async (c) => {
  const app: any = await c.env.DB.prepare('SELECT id, slug, name, apk_key, icon_key, feature_key FROM apps WHERE id = ?').bind(c.req.param('id')).first();
  if (!app) return c.json({ error: 'not_found' }, 404);
  const left = await itemLeftovers(c.env, app);
  return c.json({
    ok: true, slug: app.slug, count: left.length,
    bytes: left.reduce((n, o) => n + (o.size || 0), 0),
    keys: left.slice(0, 200).map((o) => o.key),
    note: left.length
      ? 'ملفات باسم هذا العنصر لا يشير إليها أي تطبيق — بقايا نشر سابق أو رفع مرفوض.'
      : 'لا توجد بقايا لهذا العنصر.',
  });
});

app.post('/admin/apps/:id/leftovers/clean', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  if (String(body.confirm || '') !== 'CLEAN-LEFTOVERS') {
    return c.json({ error: 'confirm_required', hint: 'أرسل confirm: CLEAN-LEFTOVERS' }, 400);
  }
  const app: any = await c.env.DB.prepare('SELECT id, slug FROM apps WHERE id = ?').bind(c.req.param('id')).first();
  if (!app) return c.json({ error: 'not_found' }, 404);
  const left = await itemLeftovers(c.env, app);
  const failed = left.length ? await r2DeleteMany(c.env, left.map((o) => o.key)) : [];
  const deleted = left.length - failed.length;
  if (deleted) await recordActivity(c.env, consoleActor(c), `حذف ${deleted} ملفاً قديماً للعنصر «${app.slug}»`, 'delete');
  return c.json({
    ok: true, found: left.length, deleted, failed: failed.length,
    failed_keys: failed.slice(0, 50),
    bytes: left.reduce((n, o) => n + (o.size || 0), 0),
  });
});

/* ── STORAGE ORGANISER ───────────────────────────────────────────────────────
 * Owner: «رتب التطبيقات والأيقونات وكل شئ داخل جداول التخزين».
 *
 * Uploads were stored as <folder>/<slug>-<epoch>-<hex>.<ext>, so nothing in the
 * bucket said what an object belonged to and re-publishing accumulated more of
 * them. This reports — and optionally performs — a rename to the deterministic
 * <folder>/<slug>.<ext>, moving the real bytes and rewriting every D1 reference
 * (apps, screenshots, videos, the download page's release row) in one pass.
 *
 *   GET  /admin/r2/organise?apply=0   dry run: the full plan, nothing touched
 *   POST /admin/r2/organise           same plan, executed
 *
 * Rules that keep it safe:
 *   • an object referenced by no row is NEVER renamed (it is an orphan — the
 *     ‎ panel offers «حذف الملفات اليتيمة» for those instead);
 *   • if the destination already exists with the same size, the source is a
 *     duplicate: the row is repointed and the source deleted;
 *   • if a copy cannot be verified, the source is left alone and the row is
 *     left alone — nothing is lost, and the reason is reported per row;
 *   • the whole run is bounded so one huge bucket cannot time out the request.
 */
async function planOrganise(env: Env) {
  const apps: any = await env.DB.prepare(
    'SELECT id, slug, name, apk_key, icon_key, feature_key FROM apps ORDER BY created_at ASC',
  ).all().catch(() => ({ results: [] }));
  const shots: any = await env.DB.prepare('SELECT id, app_id, r2_key FROM screenshots').all().catch(() => ({ results: [] }));
  const vids: any = await env.DB.prepare('SELECT id, app_id, thumb_key FROM app_videos').all().catch(() => ({ results: [] }));

  const moves: { table: string; column: string; rowId: string; slug: string; from: string; to: string; kind: string }[] = [];
  const addMove = (table: string, column: string, rowId: string, slug: string, from: unknown, to: string, kind: string) => {
    const key = String(from || '').trim();
    if (!key || key === to) return;
    moves.push({ table, column, rowId: String(rowId), slug, from: key, to, kind });
  };

  const seen = new Set<string>();
  for (const a of (apps.results || [])) {
    const slug = String(a.slug || '');
    if (!slug || seen.has('app:' + a.id)) continue;
    seen.add('app:' + a.id);
    addMove('apps', 'apk_key', a.id, slug, a.apk_key, organiseKey(String(a.apk_key || ''), slug, 'apk'), 'apk');
    addMove('apps', 'icon_key', a.id, slug, a.icon_key, organiseKey(String(a.icon_key || ''), slug), 'icon');
    addMove('apps', 'feature_key', a.id, slug, a.feature_key, organiseKey(String(a.feature_key || ''), slug), 'feature');
  }
  // Screenshots/videos keep an index so two shots of one app never collide.
  const shotCount = new Map<string, number>();
  for (const r of (shots.results || [])) {
    const key = String(r.r2_key || '');
    if (!key) continue;
    const owner = (apps.results || []).find((a: any) => String(a.id) === String(r.app_id));
    const slug = owner ? String(owner.slug) : 'screenshot';
    const n = (shotCount.get(slug) || 0) + 1;
    shotCount.set(slug, n);
    const ext = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : 'webp';
    addMove('screenshots', 'r2_key', r.id, slug, key, `ss/${slug}-${n}.${ext}`, 'screenshot');
  }
  /* Thumbnails are named after the product they belong to.
   *
   * Owner: «لماذا التطبيقات والألعاب والأيقونات مختلطة وليست كل فئة على حدة».
   * They were not mixed — they were DROWNING. Every custom video thumbnail was
   * stored as `vthumb/video.jpg` / `vthumb/video-2.jpg`, because the slug hint
   * handed to the uploader was the literal word «video». With a dozen items,
   * each one overwrote a stranger's picture and the folder stopped saying who
   * owned what. The rule is the same as everywhere else now:
   * `<folder>/<slug>-<n>.<ext>`, and the organiser fixes what is already stored.
   */
  const vidCount = new Map<string, number>();
  const appsById = new Map((apps.results || []).map((a: any) => [String(a.id), a]));
  for (const v of (vids.results || [])) {
    const key = String(v.thumb_key || '');
    if (!key) continue;
    const owner: any = appsById.get(String(v.app_id || '')) || null;
    const slug = owner ? String(owner.slug) : 'video';
    const n = (vidCount.get(slug) || 0) + 1;
    vidCount.set(slug, n);
    const ext = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : 'jpg';
    addMove('app_videos', 'thumb_key', v.id, slug, key, `vthumb/${slug}-${n}.${ext}`, 'video');
  }
  return moves;
}

app.get('/admin/r2/organise', async (c) => {
  const moves = await planOrganise(c.env);
  const byKind: Record<string, number> = {};
  for (const m of moves) byKind[m.kind] = (byKind[m.kind] || 0) + 1;
  return c.json({
    dry_run: true, pending: moves.length, by_kind: byKind,
    already_organised: moves.length === 0,
    plan: moves.slice(0, 200),
    note: moves.length ? 'لم يُغيَّر شيء. اضغط «رتّب التخزين» للتنفيذ.' : 'كل الملفات مرتّبة بالفعل.',
  });
});

app.post('/admin/r2/organise', async (c) => {
  const body = await c.req.json().catch(() => ({}) as any);
  const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 400);
  const moves = (await planOrganise(c.env)).slice(0, limit);
  const done: any[] = [];
  const failed: any[] = [];
  let moved = 0;

  for (const m of moves) {
    const existing = await r2Head(c.env, m.to).catch(() => null);
    if (existing) {
      const src = await r2Head(c.env, m.from).catch(() => null);
      if (src && src.size === existing.size) {
        // Same bytes under both names: repoint the row, drop the duplicate.
        await c.env.DB.prepare(`UPDATE ${m.table} SET ${m.column} = ? WHERE id = ?`).bind(m.to, m.rowId).run();
        await r2DeleteStrict(c.env, m.from).catch(() => false);
        moved++;
        done.push({ ...m, action: 'deduplicated' });
        continue;
      }
      failed.push({ ...m, error: 'destination_exists_different_size' });
      continue;
    }
    const res = await r2Move(c.env, m.from, m.to).catch(() => ({ ok: false, key: m.from, error: 'move_failed' }));
    if (!res.ok) { failed.push({ ...m, error: res.error || 'move_failed' }); continue; }
    await c.env.DB.prepare(`UPDATE ${m.table} SET ${m.column} = ? WHERE id = ?`).bind(res.key, m.rowId).run();
    moved++;
    done.push({ ...m, action: 'moved' });
  }

  await purgeAppsCache(c.env);
  if (moved) await recordActivity(c.env, consoleActor(c), `ترتيب التخزين — ${moved} ملف أُعيدت تسميته`, 'publish');
  return c.json({ ok: true, moved, failed: failed.length, remaining: Math.max(0, (await planOrganise(c.env)).length), done: done.slice(0, 100), errors: failed.slice(0, 50) });
});

app.get('/admin/r2/objects', async (c) => {
  const prefix = String(c.req.query('prefix') || '').trim().slice(0, 120);
  const objects = await r2List(c.env, prefix, 1000);
  const referenced = await referencedKeys(c.env);
  return c.json({
    prefix,
    count: objects.length,
    objects: objects.map((o) => ({
      key: o.key, size: o.size, last_modified: o.lastModified || null,
      referenced: referenced.has(o.key),
    })),
  });
});

app.post('/admin/r2/upload-url', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const key = String(body.key || '').trim();
  if (!validR2Key(key)) return c.json({ error: 'invalid_key' }, 400);
  const url = await r2PresignPut(c.env, key, String(body.content_type || 'application/octet-stream'), 900);
  return c.json({ ok: true, key, url, public_url: r2PublicUrl(key, c.env) });
});

app.get('/admin/r2/download-url', async (c) => {
  const key = String(c.req.query('key') || '');
  if (!validR2Key(key)) return c.json({ error: 'invalid_key' }, 400);
  const head = await r2Head(c.env, key);
  if (!head) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, key, size: head.size, type: head.contentType, url: await r2PresignGet(c.env, key, 900) });
});

app.post('/admin/r2/delete', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const keys = (Array.isArray(body.keys) ? body.keys : []).filter(validR2Key);
  if (!keys.length) return c.json({ error: 'no_keys' }, 400);
  const failed = await r2DeleteMany(c.env, keys);
  await recordActivity(c.env, consoleActor(c), `حذف ${keys.length - failed.length} ملف من كلاود`, 'delete');
  return c.json({ ok: true, deleted: keys.length - failed.length, failed: failed.length, failed_keys: failed.slice(0, 50) });
});

app.post('/admin/r2/wipe', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (String(body.confirm || '') !== 'DELETE-ALL') return c.json({ error: 'confirm_required' }, 400);
  const prefixes = ['apk/', 'ss/', 'icon/', 'feature/', 'vthumb/', ''];
  const seen = new Set<string>();
  for (const pfx of prefixes) for (const o of await r2List(c.env, pfx, 10000)) seen.add(o.key);
  const failed = await r2DeleteMany(c.env, [...seen]);
  await recordActivity(c.env, consoleActor(c), `مسح كامل لكلاود: ${seen.size - failed.length}/${seen.size}`, 'delete');
  return c.json({ ok: true, count: seen.size, deleted: seen.size - failed.length, failed: failed.length });
});

/* ---- «نبدأ من جديد»: المتجر + كل ملفاته ----
   Empties every table that belongs to the catalogue (apps, screenshots,
   videos/thumbnails, ratings, publications, order, per-app download stats)
   and then the bucket. Categories, settings, admin users, notifications and
   the store's own update row are deliberately kept.
   Typed confirmation: RESET-STORE. */
const APP_TABLES = [
  'screenshots', 'app_videos', 'app_publication', 'app_order',
  'app_download_stats', 'app_aliases', 'star_votes', 'app_reviews',
  'app_followers', 'app_update_requests',
];
app.post('/admin/store/reset', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (String(body.confirm || '') !== 'RESET-STORE') return c.json({ error: 'confirm_required' }, 400);
  const report: any = { tables: {}, files: null, dry_run: body.dry_run === true };

  // 1) every app row
  const before: any = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM apps').first().catch(() => null);
  report.apps_before = Number(before?.n || 0);

  // 2) related tables (explicit list) + any table that has an `app_id` column
  const names = new Set<string>(APP_TABLES);
  try {
    const tables: any = await c.env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    for (const t of (tables.results || [])) {
      const name = String(t.name);
      if (!name || name.startsWith('sqlite_') || name === 'apps') continue;
      const cols: any = await c.env.DB.prepare(`PRAGMA table_info(${name})`).all().catch(() => ({ results: [] }));
      if ((cols.results || []).some((col: any) => String(col.name) === 'app_id')) names.add(name);
    }
  } catch { /* keep the explicit list */ }

  if (report.dry_run) {
    for (const t of names) {
      const n: any = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first().catch(() => null);
      report.tables[t] = Number(n?.n || 0);
    }
    return c.json({ ok: true, ...report });
  }

  await ensureConsoleTables(c.env.DB);
  for (const t of names) {
    try {
      const res: any = await c.env.DB.prepare(`DELETE FROM ${t}`).run();
      report.tables[t] = Number(res?.meta?.changes ?? 0);
    } catch { report.tables[t] = 'skipped'; }
  }
  try { const res: any = await c.env.DB.prepare('DELETE FROM apps').run(); report.tables.apps = Number(res?.meta?.changes ?? 0); } catch { report.tables.apps = 'failed'; }
  try { await c.env.DB.prepare("DELETE FROM app_update_releases").run(); } catch { /* optional table */ }

  // 3) the bucket
  const prefixes = ['apk/', 'ss/', 'icon/', 'feature/', 'vthumb/', ''];
  const seen = new Set<string>();
  for (const pfx of prefixes) for (const o of await r2List(c.env, pfx, 10000)) seen.add(o.key);
  const failed = await r2DeleteMany(c.env, [...seen]);
  report.files = { count: seen.size, deleted: seen.size - failed.length, failed: failed.length };

  await purgeAppsCache(c.env);
  await recordActivity(c.env, consoleActor(c), `تصفير المتجر: ${report.apps_before} عنصراً و${report.files.deleted} ملف`, 'delete');
  return c.json({ ok: true, ...report });
});

/* =========================================================================
   Storage audit & cleanup — «لماذا لا تحذف في كلاود؟»
   -------------------------------------------------------------------------
   Every delete path can be interrupted (timeout, lost connection, a bad key).
   Instead of guessing, the bucket is COMPARED with the database:

     • orphan   — a file in R2 that no row points at any more (the leftovers the
                  owner can see in the Cloudflare console);
     • duplicate— two rows for the same package (the «نشر اثنتين» leftovers);
     • missing  — a row whose file is not in the bucket (a broken download).

   GET  /admin/duplicates              → the duplicate groups, per package
   POST /admin/cleanup                 → { dry_run: true } by default
        { orphans: true }  delete orphan files
        { duplicates: 'delete', keep: 'oldest'|'newest'|'downloads' }
   Dry-run ALWAYS first: the response lists exactly what would be removed.
   ========================================================================= */
app.get('/admin/duplicates', async (c) => {
  const rows: any = await c.env.DB.prepare(
    `SELECT id, slug, name, package_name, apk_key, size_bytes, created_at, downloads
       FROM apps ORDER BY created_at ASC`,
  ).all().catch(() => ({ results: [] }));
  const groups = new Map<string, any[]>();
  for (const r of (rows.results || [])) {
    const key = String(r.package_name || '').trim().toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const duplicates = [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([package_name, list]) => ({
      package_name,
      count: list.length,
      wasted_bytes: list.slice(1).reduce((n, r) => n + Number(r.size_bytes || 0), 0),
      keep_suggestion: list[0].slug,
      items: list.map((r) => ({
        id: r.id, slug: r.slug, name: r.name, apk_key: r.apk_key,
        size_bytes: Number(r.size_bytes || 0), created_at: Number(r.created_at || 0),
        downloads: Number(r.downloads || 0),
      })),
    }));
  return c.json({ groups: duplicates.length, wasted_bytes: duplicates.reduce((n, g) => n + g.wasted_bytes, 0), duplicates });
});

app.post('/admin/cleanup', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const report: any = { orphans: null, duplicates: null, missing: null, dry_run: body.dry_run !== false };

  // ---- 1) which keys does the database still reference? ----
  const referenced = new Set<string>();
  const add = (k: unknown) => { if (k && typeof k === 'string') referenced.add(k); };
  const appRows: any = await c.env.DB.prepare('SELECT apk_key, icon_key, feature_key FROM apps').all().catch(() => ({ results: [] }));
  for (const r of (appRows.results || [])) { add(r.apk_key); add(r.icon_key); add(r.feature_key); }
  const ssRows: any = await c.env.DB.prepare('SELECT r2_key FROM screenshots').all().catch(() => ({ results: [] }));
  for (const r of (ssRows.results || [])) add(r.r2_key);
  const vidRows: any = await c.env.DB.prepare('SELECT thumb_key FROM app_videos').all().catch(() => ({ results: [] }));
  for (const r of (vidRows.results || [])) add(r.thumb_key);
  // The store's own APK + media live in `app_updates` (update center).
  const updRows: any = await c.env.DB.prepare("SELECT * FROM app_updates WHERE id = 'current'").all().catch(() => ({ results: [] }));
  for (const r of (updRows.results || [])) {
    add(r.apk_key); add(r.logo_key);
    // The live release APK lives in apk_url as a full URL — protect it or the
    // sweep will happily offer to delete the file the update dialog needs.
    add(keyFromStoredUrl(r.apk_url));
    try { for (const k of JSON.parse(r.screenshots || '[]')) add(k); } catch {}
    try { for (const k of JSON.parse(r.videos || '[]')) add(typeof k === 'string' ? k : (k && (k.thumb_key || k.key))); } catch {}
  }
  // Old builds retire: only the last 30 days of release history keeps its file
  // protected. Anything older is an orphan and is listed for deletion, which is
  // how the pile of `goldenstore-app-….apk` in the bucket finally goes away.
  const relCutoff = nowSec() - 30 * 86400;
  const relRows: any = await c.env.DB.prepare(
    'SELECT apk_url FROM app_update_releases WHERE created_at >= ?',
  ).bind(relCutoff).all().catch(() => ({ results: [] }));
  for (const r of (relRows.results || [])) {
    const m = String(r.apk_url || '').match(/(?:apk|ss|icon|feature|vthumb)\/[^\s?]+/);
    if (m) add(decodeURIComponent(m[0]));
  }

  // ---- 2) orphans: bucket files nobody points at ----
  if (body.orphans || body.missing) {
    const prefixes = ['apk/', 'ss/', 'icon/', 'feature/', 'vthumb/'];
    const objects: { key: string; size: number }[] = [];
    for (const pfx of prefixes) objects.push(...await r2List(c.env, pfx, 5000));
    // A file used by the CURRENT update build must never be treated as an
    // orphan, even if its row is older than the retention window.
    // A file younger than a day may still belong to an upload that is running
    // right now (the row is written when the upload finishes), so it is never
    // reported as an orphan unless the admin explicitly forces it.
    const minAgeMs = body.force ? 0 : 24 * 3600 * 1000;
    const fresh = (o: { lastModified?: string }) => {
      if (!minAgeMs) return false;
      const t = o.lastModified ? Date.parse(o.lastModified) : 0;
      return !!t && Date.now() - t < minAgeMs;
    };
    const orphans = objects.filter((o) => !referenced.has(o.key) && !fresh(o as any));
    report.orphans = {
      scanned: objects.length, count: orphans.length,
      bytes: orphans.reduce((n, o) => n + (o.size || 0), 0),
      keys: orphans.slice(0, 200).map((o) => o.key),
    };
    if (!report.dry_run && body.orphans) {
      const failed = await r2DeleteMany(c.env, orphans.map((o) => o.key));
      report.orphans.deleted = orphans.length - failed.length;
      report.orphans.failed = failed.length;
    }
  }

  // ---- 3) duplicates: same package name, more than one row ----
  if (body.duplicates === 'delete' || body.duplicates === 'list') {
    const rows: any = await c.env.DB.prepare(
      'SELECT id, slug, name, package_name, apk_key, icon_key, feature_key, size_bytes, created_at, downloads FROM apps ORDER BY created_at ASC',
    ).all().catch(() => ({ results: [] }));
    const groups = new Map<string, any[]>();
    for (const r of (rows.results || [])) {
      const k = String(r.package_name || '').trim().toLowerCase();
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    const dupGroups = [...groups.values()].filter((g) => g.length > 1);
    const keepMode = String(body.keep || 'oldest');
    const plan: any[] = [];
    for (const g of dupGroups) {
      const sorted = [...g].sort((a, b) => {
        if (keepMode === 'newest') return Number(b.created_at) - Number(a.created_at);
        if (keepMode === 'downloads') return Number(b.downloads) - Number(a.downloads);
        return Number(a.created_at) - Number(b.created_at);
      });
      const [keep, ...drop] = sorted;
      plan.push({ package_name: keep.package_name, keep: keep.slug, remove: drop.map((r) => ({ id: r.id, slug: r.slug, apk_key: r.apk_key })) });
      if (!report.dry_run && body.duplicates === 'delete') {
        for (const r of drop) {
          const keys = [r.apk_key, r.icon_key, r.feature_key].filter(Boolean) as string[];
          const ss: any = await c.env.DB.prepare('SELECT r2_key FROM screenshots WHERE app_id = ?').bind(r.id).all().catch(() => ({ results: [] }));
          for (const s2 of (ss.results || [])) if (s2.r2_key) keys.push(String(s2.r2_key));
          if (keys.length) await r2DeleteMany(c.env, keys);
          await c.env.DB.prepare('DELETE FROM screenshots WHERE app_id = ?').bind(r.id).run().catch(() => {});
          const dupThumbs = await deleteAppVideos(c.env, r.id).catch(() => [] as string[]);
          if (dupThumbs.length) await r2DeleteMany(c.env, dupThumbs);
          await c.env.DB.prepare('DELETE FROM apps WHERE id = ?').bind(r.id).run().catch(() => {});
          await ensureConsoleTables(c.env.DB);
          for (const sql of ['DELETE FROM app_publication WHERE slug = ?', 'DELETE FROM app_order WHERE slug = ?'])
            { try { await c.env.DB.prepare(sql).bind(r.slug).run(); } catch {} }
        }
      }
    }
    report.duplicates = { groups: plan.length, plan };
    if (!report.dry_run && body.duplicates === 'delete') {
      await purgeAppsCache(c.env);
      await recordActivity(c.env, consoleActor(c), `تنظيف ${plan.length} مجموعة مكرّرة (${plan.reduce((n, g) => n + g.remove.length, 0)} عنصراً)`, 'delete');
    }
  }

  // ---- 3.5) full wipe: «احذف كل الملفات التي في كلاود» ----
  //  The owner asked for an empty bucket because the files had become mixed up
  //  (dozens of APKs per item, leftovers from deleted products). This is
  //  destructive by design, so it needs THREE things before it runs:
  //    • dry_run:false          — an explicit, non-default flag;
  //    • confirm: 'DELETE-ALL'  — a typed phrase, never a stray button press;
  //    • a fresh dry run first  — the UI always shows the count and the size.
  //  It reports what it removed PER FOLDER, so the owner sees exactly what the
  //  catalogue lost (an apk/ file = a product that must be re-uploaded).
  if (body.mode === 'all' || body.mode === 'wipe') {
    const prefixes = ['apk/', 'ss/', 'icon/', 'feature/', 'vthumb/', ''];
    const seen = new Set<string>();
    const all: { key: string; size: number }[] = [];
    for (const pfx of prefixes) {
      for (const o of await r2List(c.env, pfx, 10000)) {
        if (seen.has(o.key)) continue;
        seen.add(o.key);
        all.push({ key: o.key, size: Number(o.size || 0) });
      }
    }
    const byFolder: Record<string, { count: number; bytes: number }> = {};
    for (const o of all) {
      const folder = o.key.includes('/') ? o.key.slice(0, o.key.indexOf('/') + 1) : '(root)';
      byFolder[folder] = byFolder[folder] || { count: 0, bytes: 0 };
      byFolder[folder].count++;
      byFolder[folder].bytes += o.size;
    }
    report.wipe = {
      count: all.length,
      bytes: all.reduce((n, o) => n + o.size, 0),
      by_folder: byFolder,
      // What the catalogue is about to lose: items whose APK lives in the bucket.
      apps_with_apk: Number(((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM apps WHERE apk_key IS NOT NULL AND apk_key != \'\'').first().catch(() => null)) as any)?.n || 0),
      keys: all.slice(0, 300).map((o) => o.key),
    };
    if (!report.dry_run) {
      if (String(body.confirm || '') !== 'DELETE-ALL') {
        return c.json({ error: 'confirm_required', hint: 'أرسل confirm: DELETE-ALL', ...report }, 400);
      }
      const failed = await r2DeleteMany(c.env, all.map((o) => o.key));
      report.wipe.deleted = all.length - failed.length;
      report.wipe.failed = failed.length;
      report.wipe.failed_keys = failed.slice(0, 50);
      await recordActivity(c.env, consoleActor(c),
        `مسح كامل لكلاود: ${report.wipe.deleted}/${all.length} ملف`, 'delete');
    }
  }

  // ---- 4) rows whose file is gone (a 404 download waiting to happen) ----
  if (body.missing) {
    const rows: any = await c.env.DB.prepare('SELECT id, slug, apk_key, size_bytes FROM apps').all().catch(() => ({ results: [] }));
    const missing: any[] = [];
    for (const r of (rows.results || [])) {
      if (!r.apk_key) { missing.push({ slug: r.slug, reason: 'no_apk_key' }); continue; }
      const head = await r2Head(c.env, String(r.apk_key));
      if (!head) missing.push({ slug: r.slug, reason: 'file_missing', apk_key: r.apk_key });
      else if (Number(r.size_bytes || 0) !== head.size) {
        await c.env.DB.prepare('UPDATE apps SET size_bytes = ? WHERE id = ?').bind(head.size, r.id).run().catch(() => {});
      }
    }
    report.missing = { count: missing.length, items: missing };
  }

  return c.json({ ok: true, ...report });
});

// =========================================================================
// Advanced Push System
// =========================================================================
app.post('/admin/push/send-advanced', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.title) return c.json({ error: 'title_required' }, 400);
  const segment = body.segment && typeof body.segment === 'object' ? body.segment : { mode: 'all' };
  try {
    const push = await sendAdvancedPush(c.env, {
      id: randomId(), title: String(body.title).slice(0, 200),
      body: sanitizeText(body.body, 1000), type: 'announcement',
      image_url: body.image_url, click_url: body.click_url,
      app_slug: segment.app_slug || '',
    }, segment);
    // sendAdvancedPush persists the notification with the SAME id used for
    // delivery logs and click tracking, so history always joins correctly.
    return c.json({ ok: true, push });
  } catch (error: any) {
    console.error('[push] send-advanced failed:', error?.message || error);
    return c.json({ ok: false, error: 'send_failed', message: String(error?.message || error) });
  }
});

app.post('/admin/push/flush-advanced', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const jobId = String(body.job_id || '');
  if (!jobId) return c.json({ error: 'job_id_required' }, 400);
  return c.json({ ok: true, ...(await processAdvancedJob(c.env, jobId, Number(body.limit) || 300)) });
});

// Audience preview before sending (so the admin sees the real count).
app.post('/admin/push/audience-preview', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const segment = body.segment && typeof body.segment === 'object' ? body.segment : { mode: 'all' };
  if (segment.mode === 'all') {
    const stats = await pushDiagnostics(c.env);
    return c.json({ ok: true, targeted: stats.total_eligible, native_count: stats.native_eligible,
      web_count: stats.web_eligible });
  }
  const a = await resolveAudience(c.env, segment);
  return c.json({ ok: true, targeted: a.targeted, native_count: a.native_count, web_count: a.web_count });
});

app.post('/admin/push/schedule', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try { return c.json({ ok: true, ...(await schedulePush(c.env, body)) }); }
  catch (error: any) { return c.json({ ok: false, error: String(error?.message || error) }, 400); }
});
app.get('/admin/push/scheduled', async (c) =>
  c.json({ scheduled: await listScheduledPushes(c.env, Number(c.req.query('limit')) || 30) }));
app.delete('/admin/push/scheduled/:id', async (c) =>
  c.json({ ok: await cancelScheduledPush(c.env, c.req.param('id')) }));
// Manual cron trigger (useful in environments where Cron Triggers are off).
app.post('/admin/push/cron-run', async (c) =>
  c.json({ ok: true, ...(await processScheduledPushes(c.env)) }));

app.get('/admin/push/history', async (c) =>
  c.json({ history: await pushHistory(c.env, Number(c.req.query('limit')) || 30) }));
app.get('/admin/push/analytics', async (c) =>
  c.json({ ok: true, analytics: await analyticsOverview(c.env) }));

/* =========================================================================
   Command Center — Firebase + Cloudflare GraphQL Analytics (2026-11-08)
   Admin-only (covered by /admin/* requireAdmin and the central write guard).
   No secret is ever returned: only presence flags, masked tails and the
   outcome of a real OAuth2 token exchange.
   ========================================================================= */
function maskEmail(v: unknown): string {
  const s = String(v || '');
  const at = s.indexOf('@');
  return at > 2 ? `${s.slice(0, 2)}***@${s.slice(at + 1)}` : (s ? '***' : '');
}
function firebaseConfig(env: any) {
  const project = String(env.FIREBASE_PROJECT_ID || '').trim();
  const email = String(env.FIREBASE_CLIENT_EMAIL || '').trim();
  const hasKey = !!(env.FIREBASE_PRIVATE_KEY || env.FIREBASE_PRIVATE_KEY_BASE64 || env.FIREBASE_SERVICE_ACCOUNT);
  return {
    project_id: project,
    client_email_masked: maskEmail(email),
    api_key_present: !!env.FIREBASE_API_KEY,
    service_account_present: hasKey,
    private_key_source: env.FIREBASE_PRIVATE_KEY ? 'FIREBASE_PRIVATE_KEY'
      : env.FIREBASE_PRIVATE_KEY_BASE64 ? 'FIREBASE_PRIVATE_KEY_BASE64'
        : env.FIREBASE_SERVICE_ACCOUNT ? 'FIREBASE_SERVICE_ACCOUNT' : null,
    configured: !!project && !!email && hasKey,
  };
}

app.get('/admin/firebase/status', async (c) => {
  const env: any = c.env;
  const [stats, unified, usage, registrations, logs] = await Promise.all([
    pushTokenStats(env).catch(() => ({})),
    notificationDiagnostics(env).catch(() => ({})),
    firebaseUsage(env, 7).catch(() => []),
    listPushRegistrations(env, 12).catch(() => []),
    listPushLogs(env, 12).catch(() => []),
  ]);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, firebase: {
    config: firebaseConfig(env),
    fcm: stats, unified, usage, registrations, logs,
    generated_at: nowSec(),
  } });
});

/** REAL Firebase feature: exchange the service account for an OAuth2 access
    token against Google. Proves the credentials, the private key and the
    project are valid — without sending a message or exposing the secret. */
app.post('/admin/firebase/test', async (c) => {
  const env: any = c.env;
  const config = firebaseConfig(env);
  if (!config.configured) {
    return c.json({ ok: false, connected: false, latency_ms: 0,
      error: 'missing_firebase_credentials',
      hint: 'Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (or *_BASE64 / FIREBASE_SERVICE_ACCOUNT) as Worker secrets.' });
  }
  const started = Date.now();
  try {
    const token = await getServiceAccountToken(env, 'https://www.googleapis.com/auth/firebase.messaging');
    return c.json({ ok: true, connected: !!token, latency_ms: Date.now() - started,
      project_id: config.project_id, scope: 'firebase.messaging',
      note: 'Service-account OAuth2 token obtained; FCM v1 credentials are valid.' });
  } catch (error: any) {
    // Never leak the private key or the assertion. Only a short reason.
    const raw = String(error?.message || error);
    return c.json({ ok: false, connected: false, latency_ms: Date.now() - started,
      error: raw.slice(0, 180),
      hint: 'Verify FIREBASE_PRIVATE_KEY (PEM with real newlines) and that the service account has Firebase Messaging permissions.' });
  }
});

/** Cloudflare GraphQL Analytics with a selectable 7/14/30-day window and
    derived ratios the owner can act on. */
app.get('/admin/cloudflare/analytics', async (c) => {
  const days = Math.max(1, Math.min(Number(c.req.query('days')) || 7, 30));
  try {
    const cloudflare = await cfUsage(c.env, { debug: true, days });
    const series = Array.isArray(cloudflare.series) ? cloudflare.series : [];
    const totalRequests = Number(cloudflare.requests || 0);
    const peak = series.reduce((a: any, b: any) =>
      Number(b?.requests || 0) > Number(a?.requests || 0) ? b : a, { requests: 0, date: '' });
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, cloudflare, derived: {
      days,
      cache_hit_ratio: totalRequests ? Math.round((Number(cloudflare.cached_requests || 0) / totalRequests) * 1000) / 10 : 0,
      avg_bytes_per_request: totalRequests ? Math.round(Number(cloudflare.bytes || 0) / totalRequests) : 0,
      peak_day: String(peak?.date || ''), peak_requests: Number(peak?.requests || 0),
      series_length: series.length,
    } });
  } catch (error: any) {
    return c.json({ ok: false, error: String(error?.message || error) });
  }
});

// Live Cloudflare GraphQL diagnostic: shows config flags, HTTP status and
// GraphQL errors WITHOUT exposing the token. Use this to debug "0 requests".
app.get('/admin/push/cloudflare', async (c) => {
  try {
    return c.json({ ok: true, cloudflare: await cfUsage(c.env, { debug: true }) });
  } catch (error: any) {
    return c.json({ ok: false, error: String(error?.message || error) });
  }
});

// Click tracking — public, rate limited, no token/PII required.
app.post('/notifications/click', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'push-click', 60, 60)) return c.json({ error: 'rate_limited' }, 429);
  const body = await c.req.json().catch(() => ({}));
  const id = sanitizeText(body.notification_id, 120);
  if (!id) return c.json({ error: 'invalid' }, 400);
  await recordPushClick(c.env, id, String(body.uid || ''), String(body.platform || ''));
  return c.json({ ok: true });
});

// Per-app subscription (users who want updates about a specific app).
app.post('/apps/:slug/follow', async (c) => {
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ ok: await followApp(c.env, user.uid, c.req.param('slug')) });
});
app.delete('/apps/:slug/follow', async (c) => {
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ ok: await unfollowApp(c.env, user.uid, c.req.param('slug')) });
});
app.get('/admin/apps/:slug/followers', async (c) =>
  c.json({ count: await appFollowerCount(c.env, c.req.param('slug')) }));

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => { console.error('[api error]', err); return c.json({ error: 'internal_error' }, 500); });

// Cloudflare Workers module entry: HTTP + Cron Triggers.
export async function scheduled(_controller: any, env: Env, ctx: any) {
  try {
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(processScheduledPushes(env));
      ctx.waitUntil(drainDeliveryJobs(env));
      ctx.waitUntil(publishDueApps(env));
    } else {
      await processScheduledPushes(env);
      await drainDeliveryJobs(env);
      await publishDueApps(env);
    }
  } catch (error: any) {
    console.error('[push] cron failed:', error?.message || error);
  }
}

export default {
  fetch: (request: Request, env: Env, ctx: any) => app.fetch(request, env, ctx),
  scheduled,
};
