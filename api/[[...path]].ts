import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { verifyFirebaseToken, getAuthAdmin } from '../lib/firebase.js';
import {
  broadcastPush, sendDirectPush, buildPushPayload, registerPushToken, setPushPreference,
  unregisterPushToken, ensurePushSchema, processPushJob, syncTopicSubscriptions,
  pushTokenStats, pushDiagnostics, listPushLogs, listPushRegistrations,
} from '../lib/push.js';
import {
  sendAdvancedPush, processAdvancedJob, schedulePush, listScheduledPushes,
  cancelScheduledPush, processScheduledPushes, recordPushClick, pushHistory,
  followApp, unfollowApp, appFollowerCount, analyticsOverview, resolveAudience,
} from '../lib/advanced-push.js';
import { cloudflareUsage as cfUsage } from '../lib/usage.js';
import {
  listApps, getAppBySlug, listScreenshots, listReviews, countReviews,
  getRatingDistribution, listNotifications, getStoreSettings,
  getReviewById, toggleReviewLike, reportReview, getAllReports, deleteReport, deleteReview,
  searchApps, suggestApps,
  createSupportThread, listUserSupportThreads, listAdminSupportThreads, getSupportThread,
  addSupportMessage, setSupportThreadStatus, markSupportThreadRead, deleteSupportThread,
  ensureSupportSchema,
  ensureVideosSchema, listAppVideos, addAppVideo, updateAppVideo,
  deleteAppVideo, deleteAppVideos, listVideoThumbKeys,
} from '../lib/d1.js';
import {
  r2PresignPut, r2PresignGet, r2PublicUrl, r2Delete, r2Head,
  r2CreateMultipartUpload, r2PresignUploadPart, r2CompleteMultipartUpload,
  r2AbortMultipartUpload, r2ConfigureCors,
} from '../lib/r2.js';
import { COOKIE_NAME, constantTimeEqual, signJwt, verifyJwt } from '../lib/auth.js';
import { nowSec, randomId, safeExt, searchTerms, slugify, sanitizeText, sanitizeUrl, safeInt, sha1Hex, sha256Hex, parseYouTubeUrl } from '../lib/utils.js';
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

// Body size limit: all endpoints keep the 1 MB cap (attachments were removed).
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
const consoleReady = new WeakSet<object>();
async function ensureConsoleTables(db: any) {
  if (!db || consoleReady.has(db)) return;
  consoleReady.add(db);
  for (const sql of CONSOLE_SCHEMA) { try { await db.prepare(sql).run(); } catch { /* best effort */ } }
}
async function hiddenSlugs(env: Env): Promise<Set<string>> {
  await ensureConsoleTables(env.DB);
  const rows: any = await env.DB.prepare(
    "SELECT slug FROM app_publication WHERE status = 'draft' OR (status = 'scheduled' AND publish_at > ?)"
  ).bind(nowSec()).all().catch(() => ({ results: [] }));
  return new Set((rows.results || []).map((r: any) => String(r.slug)));
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
  
  // The notification row is already persisted. An FCM outage must never make
  // the admin publish request fail — report the delivery result instead.
  const rich = {
    title, body, type, app_slug, id, image,
    image_url: data.image_url || image,
    click_url: data.click_url || (app_slug ? `/app?slug=${encodeURIComponent(app_slug)}` : ''),
    data: data.data,
  };
  const settings = await readAllSettings(env).catch(() => ({ ...SETTING_DEFAULTS }));
  let push: any;
  if (settings.push_enabled !== '1') {
    push = { skipped: 'push_disabled', targeted: 0, success: 0, failure: 0 };
  } else if (inQuietHours(settings)) {
    push = { skipped: 'quiet_hours', targeted: 0, success: 0, failure: 0 };
  } else {
    try {
      push = data.segment && data.segment.mode && data.segment.mode !== 'all'
        ? await sendAdvancedPush(env, rich, data.segment)
        : await broadcastPush(env, rich);
    } catch (error: any) {
      console.error('[fcm] broadcast failed but notification was saved:', error?.message || error);
      push = { error: 'push_failed', message: String(error?.message || error), targeted: 0, success: 0, failure: 0 };
    }
  }
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
const downloadStatsReady = new WeakSet<object>();
async function ensureDownloadStatsSchema(env: Env): Promise<void> {
  const db: any = env.DB;
  if (downloadStatsReady.has(db)) return;
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
  downloadStatsReady.add(db);
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
  const sr: any = await env.DB.prepare("SELECT downloads FROM app_download_stats WHERE id = 'current'").first();
  const durable = Number(sr?.downloads) || 0;
  const total = Math.max(legacy, durable) + 1;
  await env.DB.prepare(`INSERT INTO app_download_stats (id, downloads, restored) VALUES ('current', ?, 1)
    ON CONFLICT(id) DO UPDATE SET downloads = excluded.downloads, restored = 1`).bind(total).run();
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

app.get('/app-update', async (c) => {
  // Never let a CDN/browser serve a stale total.
  c.header('Cache-Control', 'no-store');
  let row: any = null;
  try { row = await c.env.DB.prepare("SELECT * FROM app_updates WHERE id = 'current'").first(); } catch {}
  const legacy = Number(row?.downloads) || 0;
  const downloads = await readDownloadCount(c.env, legacy);
  const apkUrl = row?.apk_url || CURRENT_RELEASE.apk_url;
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
  return c.json({ ...out, update: { ...out } });
});

app.get('/app-update/download', async (c) => {
  c.header('Cache-Control', 'no-store');
  let apkUrl = CURRENT_RELEASE.apk_url;
  try {
    const row: any = await c.env.DB.prepare("SELECT apk_url FROM app_updates WHERE id = 'current'").first();
    if (row?.apk_url) apkUrl = row.apk_url;
  } catch {}
  if (!apkUrl) return c.json({ error: 'apk_not_available' }, 404);
  await bumpDownloadCount(c.env).catch(() => {});
  await recordDownloadEvent(c.env, 'app-update', 'web');
  return c.redirect(apkUrl, 302);
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
  // Android 13+ POST_NOTIFICATIONS: the token is ALWAYS stored; consent is
  // a separate field used only when building the broadcast audience.
  const res = await registerPushToken(c.env, {
    token, uid: user.uid, platform: String(body.platform || 'android'),
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
    token, uid: user.uid, web: true,
    permission: String(body.permission || 'granted'),
    enabled: body.notifications_enabled !== false,
    userAgent: String(c.req.header('user-agent') || ''),
  });
  return c.json(res);
});

app.post('/notifications/unregister-token', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (body.token) await unregisterPushToken(c.env, String(body.token));
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
  const snaps = await c.env.DB.prepare('SELECT token FROM fcm_tokens WHERE uid = ?').bind(user.uid).all();
  const tokens = (snaps.results || []).map(r => r.token as string).filter(Boolean);
  if (!tokens.length) return c.json({ error: 'no_registered_devices' }, 400);
  const note = { title: 'إشعار تجريبي', body: 'يعمل ✓', type: 'announcement', id: 'test' };
  const push = await sendDirectPush(c.env, tokens, buildPushPayload(c.env, note));
  return c.json({ ok: true, push });
});

// ---- Translation helpers -------------------------------------------------
// Google's gtx endpoint answers Cloudflare Worker IPs with an HTML "Sorry..."
// bot-block page. The old route mistook that failure for a valid translation
// and cached the unchanged Arabic source forever, so any string missing from
// the curated dictionary could never be translated.
const translateReady = new WeakSet<object>();
async function ensureTranslateCache(db: any) {
  if (!db || translateReady.has(db)) return;
  translateReady.add(db);
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

// Primary: dict-chrome-ex is a different Google host and is not bot-blocked.
async function chromeTranslate(text: string, target: string): Promise<TrResult> {
  try {
    const res = await fetch(
      `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=ar&tl=${target}&q=${encodeURIComponent(text)}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; GoldenStore/1.0)' } },
    );
    const raw = await res.text();
    if (!raw || raw.charAt(0) !== '[') return { tr: null, why: `html/${res.status}` };
    const tr = pickTranslation(JSON.parse(raw), text);
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
    const tr = pickTranslation(JSON.parse(raw), text);
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

async function translateOne(text: string, target: string, steps?: string[]): Promise<string | null> {
  const providers = [chromeTranslate, gtxTranslate, memoryTranslate];
  for (const p of providers) {
    const r = await p(text, target);
    if (steps) steps.push(`${p.name}=${r.tr ? 'ok' : r.why}`);
    if (r.tr) return r.tr;
  }
  return null;
}

app.post('/translate', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const target = String(body.target || '').toLowerCase();
  const q = Array.isArray(body.q) ? body.q.slice(0, 60).map((x: any) => String(x||'')) : [];
  if (!['en','fr','es'].includes(target) || !q.length) return c.json({ t: q });
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
    const id = await sha1Hex(target + '::' + q[i]);
    let cached: string | null = null;
    try {
      const row: any = await db.prepare('SELECT out FROM i18n_cache WHERE id = ?').bind(id).first();
      // Self-heal rows poisoned by the old code (out === source text).
      if (row && row.out && row.out !== q[i]) cached = String(row.out);
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
      const tr = await translateOne(item.text, target, debug ? steps : undefined);
      out[item.i] = tr || item.text;
      if (debug) diag.push({ src: item.text, steps, translated: !!tr });
      // Persist only real translations. INSERT OR REPLACE overwrites stale
      // poisoned rows so subsequent requests are served from cache.
      if (tr) {
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
    const hidden = await hiddenSlugs(c.env);
    const visible = result.apps.filter((a) => !hidden.has(String(a.slug)));
    const apps = visible.map((a) => ({
      ...appPublic(a),
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

app.get('/apps', async (c) => {
  const q = (c.req.query('q') || '').trim().toLowerCase(), category = (c.req.query('category') || '').trim(), type = (c.req.query('type') || '').trim();
  const sort = (c.req.query('sort') || 'recent').trim(), starredOnly = c.req.query('starred') === '1';
  const limit = Math.min(Number(c.req.query('limit') || '24') || 24, 60), offset = Math.max(Number(c.req.query('offset') || '0') || 0, 0);

  try {
    const result = await listApps(c.env, { q, category, type, sort, starredOnly, limit, offset });
    const hidden = await hiddenSlugs(c.env);
    const visible = result.apps.filter(a => !hidden.has(String(a.slug)));
    const ordered = sort === 'recent' ? applyConsoleOrder(visible, await consoleOrder(c.env)) : visible;
    const apps = ordered.map(a => ({ ...appPublic(a), icon_url: icon_url(a.icon_key, c.env), feature_url: feature_url(a.feature_key, c.env) }));
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ apps, total: Math.max(0, Number(result.total) - (result.apps.length - visible.length)) });
  } catch (e: any) { return c.json({ error: 'd1_error', message: e.message }, 500); }
});

app.get('/apps/:slug', async (c) => {
  const slug = c.req.param('slug');
  if ((await hiddenSlugs(c.env)).has(slug)) return c.json({ error: 'not_found' }, 404);
  const appData = await getAppBySlug(c.env, slug);
  if (!appData) return c.json({ error: 'not_found' }, 404);
  
  const screenshotsData = await listScreenshots(c.env, appData.id);
  // استخدام shot_url بدقة 720 لجلب صور الشاشات
  const screenshots = screenshotsData.map(s => ({ id: s.id, position: s.position, url: shot_url(s.r2_key, c.env) }));
  const videos = await videosFor(c.env, appData.id);
  
  return c.json({ app: { ...appPublic(appData), icon_url: icon_url(appData.icon_key, c.env), feature_url: feature_url(appData.feature_key, c.env) }, screenshots, videos });
});

app.get('/apps/:slug/download', async (c) => {
  const appData = await getAppBySlug(c.env, c.req.param('slug'));
  if (!appData || !appData.apk_key) return c.json({ error: 'apk_not_available' }, 404);

  if (rateLimit(getClientIp(c), `dl:${appData.slug}`, 1, 600)) {
    await c.env.DB.prepare('UPDATE apps SET downloads = downloads + 1 WHERE id = ?').bind(appData.id).run().catch(()=>{});
  }
  
  const filename = `${appData.slug}-${appData.version_name || ''}.apk`.replace(/-+/g, '-');
  await recordDownloadEvent(c.env, appData.slug, 'web');
  const url = await r2PresignGet(c.env, appData.apk_key, 300, `attachment; filename="${filename}"`);
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
];
const insightsReady = new WeakSet<object>();
async function ensureInsightsTables(db: any) {
  if (!db || insightsReady.has(db)) return;
  insightsReady.add(db);
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
  session_days: '7',
};
const SETTING_KEYS = Object.keys(SETTING_DEFAULTS);
const PUBLIC_SETTINGS = [
  'store_name', 'tagline', 'support_email', 'telegram_url', 'official_url',
  'theme_default', 'accent', 'density', 'default_language', 'allow_reviews',
  'show_download_counter', 'require_login', 'collect_demographics',
  'maintenance_mode', 'maintenance_message', 'notify_new_publications',
];
async function readAllSettings(env: Env): Promise<Record<string, string>> {
  await ensureInsightsTables(env.DB);
  const out: Record<string, string> = { ...SETTING_DEFAULTS };
  const rows: any = await env.DB.prepare('SELECT key, value FROM admin_preferences').all().catch(() => ({ results: [] }));
  (rows.results || []).forEach((r: any) => { if (SETTING_KEYS.includes(String(r.key))) out[String(r.key)] = String(r.value); });
  // The legacy singleton row remains the source of truth for this flag.
  try { const legacy = await getStoreSettings(env); out.notify_new_publications = legacy.notify_new_publications ? '1' : '0'; } catch (e) {}
  return out;
}
async function publicSettings(env: Env): Promise<Record<string, string>> {
  const all = await readAllSettings(env);
  const out: Record<string, string> = {};
  PUBLIC_SETTINGS.forEach((k) => { out[k] = all[k]; });
  return out;
}
async function recordDownloadEvent(env: Env, slug: string, platform = 'web') {
  await ensureInsightsTables(env.DB);
  const ts = nowSec();
  const d = new Date(ts * 1000);
  const day = d.toISOString().slice(0, 10);
  try {
    await env.DB.prepare('INSERT INTO download_events (id, slug, day, hour, ts, platform) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(String(crypto.randomUUID()), sanitizeText(slug, 120), day, d.getUTCHours(), ts, platform).run();
  } catch { /* analytics must never block a download */ }
}
app.get('/settings', async (c) => {
  // no-store: an admin change must take effect on the very next page load.
  c.header('Cache-Control', 'no-store');
  return c.json({ settings: await publicSettings(c.env) });
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
  let saved = 0;
  for (const k of SETTING_KEYS) {
    if (!(k in values)) continue;
    const v = sanitizeText(values[k], 500);
    await c.env.DB.prepare(`INSERT INTO admin_preferences (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .bind(k, v, nowSec()).run();
    if (k === 'notify_new_publications') {
      await c.env.DB.prepare(`INSERT OR REPLACE INTO store_settings (id, notify_new_publications, updated_at) VALUES ('general', ?, ?)`)
        .bind(v === '1' ? 1 : 0, nowSec()).run();
    }
    saved++;
  }
  await recordActivity(c.env, consoleActor(c), `حفظ ${saved} إعداداً`, 'settings');
  return c.json({ ok: true, saved, settings: await readAllSettings(c.env) });
});
app.post('/admin/settings/reset', async (c) => {
  await ensureInsightsTables(c.env.DB);
  await c.env.DB.prepare('DELETE FROM admin_preferences').run().catch(() => {});
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
  const uid = String(body.uid || '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(uid)) return c.json({ error: 'invalid_uid' }, 400);
  await ensureInsightsTables(c.env.DB);
  const age = AGE_RANGES.includes(body.age_range) ? body.age_range : '';
  const gender = GENDERS.includes(body.gender) ? body.gender : '';
  const country = sanitizeText(body.country, 60);
  const opted = body.opted_in === false ? 0 : 1;
  await c.env.DB.prepare(`INSERT INTO user_demographics (uid, age_range, gender, country, opted_in, updated_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET
      age_range = excluded.age_range, gender = excluded.gender, country = excluded.country,
      opted_in = excluded.opted_in, updated_at = excluded.updated_at`)
    .bind(uid, age, gender, country, opted, nowSec()).run();
  return c.json({ ok: true });
});
app.get('/profile/demographics/:uid', async (c) => {
  await ensureInsightsTables(c.env.DB);
  const row: any = await c.env.DB.prepare('SELECT age_range, gender, country, opted_in FROM user_demographics WHERE uid = ?')
    .bind(c.req.param('uid')).first().catch(() => null);
  return c.json({ demographics: row || null });
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

// ---- Release history -----------------------------------------------------
// Kept separate from the singleton `app_updates` row so the Update Center can
// show every published build. Created lazily: no manual migration required.
const releaseTableReady = new WeakSet<object>();
async function ensureReleaseTable(db: any) {
  if (!db || releaseTableReady.has(db)) return;
  releaseTableReady.add(db);
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
  return c.json({ ok: true, push });
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
    return c.json({ ok: true, push: await broadcastPush(c.env, { title: body.title || 'Test', body: body.body || 'Test', type: 'announcement', id: 'test' }) });
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

// Drain queued direct sends when a broadcast had more than one invocation's
// worth of unsubscribed tokens. The admin UI calls this until pending === 0.
app.post('/admin/push/flush', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const jobId = String(body.job_id || '');
  if (!jobId) return c.json({ error: 'job_id_required' }, 400);
  return c.json({ ok: true, ...(await processPushJob(c.env, jobId, Number(body.limit) || 300)) });
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
app.post('/admin/upload-url', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ext = safeExt(String(body.filename), body.kind === 'apk' ? 'apk' : body.kind === 'feature' ? 'jpg' : body.kind === 'icon' ? 'png' : 'jpg');
  const folder = body.kind === 'apk' ? 'apk' : body.kind === 'icon' ? 'icon' : body.kind === 'feature' ? 'feature' : body.kind === 'video-thumb' ? 'vthumb' : 'ss';
  const key = `${folder}/${slugify(String(body.slug_hint || 'app'))}-${Date.now()}-${randomId().slice(0, 6)}.${ext}`;
  return c.json({ url: await r2PresignPut(c.env, key, String(body.content_type || 'application/octet-stream'), 7200), key });
});

app.post('/admin/multipart/create', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ext = safeExt(String(body.filename), body.kind === 'apk' ? 'apk' : body.kind === 'feature' ? 'jpg' : body.kind === 'icon' ? 'png' : 'jpg');
  const folder = body.kind === 'apk' ? 'apk' : body.kind === 'icon' ? 'icon' : body.kind === 'feature' ? 'feature' : body.kind === 'video-thumb' ? 'vthumb' : 'ss';
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
  if ((await getStoreSettings(c.env)).notify_new_publications) {
    await addNotification(c.env, {
      type: 'new_app', title: body.name, body: '', app_slug: slug,
      image_url: icon_url(body.icon_key, c.env) || '',
      click_url: `/app?slug=${encodeURIComponent(slug)}`,
      created_at: now,
    });
  }
  
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

  if (versionChanged) await addNotification(c.env, {
    type: 'update', title: name, body: `إصدار ${body.version_name||old.version_name}`,
    app_slug: old.slug, image_url: icon_url(old.icon_key, c.env) || '',
    click_url: `/app?slug=${encodeURIComponent(old.slug)}`, created_at: nowSec(),
  });
  
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
  await addNotification(c.env, {
    type: 'update', title: old.name, body: `إصدار ${body.version_name||old.version_name}`,
    app_slug: old.slug, image_url: icon_url(old.icon_key, c.env) || '',
    click_url: `/app?slug=${encodeURIComponent(old.slug)}`, created_at: nowSec(),
  });
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

app.delete('/admin/apps/:id', async (c) => {
  const id = c.req.param('id'), app: any = await c.env.DB.prepare('SELECT * FROM apps WHERE id = ?').bind(id).first();
  if (!app) return c.json({ error: 'not_found' }, 404);

  const ss = await c.env.DB.prepare('SELECT r2_key FROM screenshots WHERE app_id = ?').bind(id).all();
  for (const s of (ss.results||[])) if (s.r2_key) await r2Delete(c.env, s.r2_key as string).catch(()=>{});
  await c.env.DB.prepare('DELETE FROM screenshots WHERE app_id = ?').bind(id).run();
  try {
    const keys = await listVideoThumbKeys(c.env, id);
    for (const k of keys) await r2Delete(c.env, k).catch(() => {});
  } catch { /* table may not exist yet */ }
  await deleteAppVideos(c.env, id).catch(() => {});
  
  if (app.apk_key) await r2Delete(c.env, app.apk_key).catch(()=>{});
  if (app.icon_key) await r2Delete(c.env, app.icon_key).catch(()=>{});
  if (app.feature_key) await r2Delete(c.env, app.feature_key).catch(()=>{});
  await c.env.DB.prepare('DELETE FROM apps WHERE id = ?').bind(id).run();
  
  // إبطال الكاش بعد الحذف
  invalidateAppsCache();
  
  return c.json({ ok: true });
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
      ctx.waitUntil(publishDueApps(env));
    } else {
      await processScheduledPushes(env);
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
