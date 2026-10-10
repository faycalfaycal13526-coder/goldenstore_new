import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { firestore, getFieldValue, verifyFirebaseToken, messaging, getAuthAdmin, sendWebPush } from '../lib/firebase.js';
import {
  r2PresignPut,
  r2PresignGet,
  r2PublicUrl,
  r2Delete,
  r2Head,
  r2CreateMultipartUpload,
  r2PresignUploadPart,
  r2CompleteMultipartUpload,
  r2AbortMultipartUpload,
  r2ConfigureCors,
} from '../lib/r2.js';
import {
  COOKIE_NAME,
  constantTimeEqual,
  signJwt,
  verifyJwt,
} from '../lib/auth.js';
import { nowSec, randomId, safeExt, searchTerms, slugify, sanitizeText, sanitizeUrl, safeInt, sha1Hex, sha256Hex } from '../lib/utils.js';
import { DEFAULT_CATEGORIES, APP_CATEGORIES, GAME_CATEGORIES, type App, type Category, type Screenshot } from '../lib/types.js';
import type { Env } from '../lib/env.js';

const app = new Hono<{ Bindings: Env }>().basePath('/api');

// ============================================================
// CACHE (in-memory per Worker isolate)
// ============================================================
const appsCache: { docs: any[] | null; ts: number } = { docs: null, ts: 0 };
const APPS_CACHE_TTL = 300; // 5 minutes

const categoriesCache: { data: Record<string, number> | null; ts: number } = { data: null, ts: 0 };
const CATEGORIES_CACHE_TTL = 3600; // 1 hour

function invalidateAppsCache() {
  appsCache.docs = null;
  appsCache.ts = 0;
  categoriesCache.data = null;
  categoriesCache.ts = 0;
}

async function getAppsCached(db: any): Promise<any[]> {
  const now = Date.now();
  if (appsCache.docs && (now - appsCache.ts) < APPS_CACHE_TTL * 1000) {
    return appsCache.docs;
  }
  const snap = await db.collection('apps').get();
  appsCache.docs = snap.docs;
  appsCache.ts = now;
  return appsCache.docs;
}

// ============================================================
// Security: CORS
// ============================================================
app.use('*', async (c, next) => {
  const origin = c.req.header('origin') || '';
  const allowedOrigins = (c.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
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

// ============================================================
// Security: rate limiter
// ============================================================
const rateLimits = new Map<string, { count: number; reset: number }>();
let rateLimitCalls = 0;
function rateLimit(ip: string, key: string, maxRequests: number, windowSec: number): boolean {
  const k = `${key}:${ip}`;
  const now = Date.now();
  if (++rateLimitCalls % 256 === 0 || rateLimits.size > 2000) {
    for (const [staleKey, stale] of rateLimits) {
      if (now > stale.reset) rateLimits.delete(staleKey);
    }
  }
  const entry = rateLimits.get(k);
  if (!entry || now > entry.reset) {
    rateLimits.set(k, { count: 1, reset: now + windowSec * 1000 });
    return true;
  }
  entry.count++;
  return entry.count <= maxRequests;
}

function getClientIp(c: any): string {
  return c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') || 'unknown';
}

// ============================================================
// Security headers
// ============================================================
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
});

// ============================================================
// Body size limit
// ============================================================
const MAX_BODY_SIZE = 1024 * 1024;
app.use('*', async (c, next) => {
  const cl = c.req.header('content-length');
  if (cl && Number(cl) > MAX_BODY_SIZE) {
    return c.json({ error: 'payload_too_large' }, 413);
  }
  await next();
});

// ============================================================
// Slug validation
// ============================================================
function isValidSlug(s: string): boolean {
  if (!s || s.length > 200) return false;
  if (/[\/\\<>\x00-\x1f]/.test(s)) return false;
  if (s.includes('..')) return false;
  return true;
}
app.use('/apps/:slug/*', async (c, next) => {
  const slug = c.req.param('slug');
  if (!isValidSlug(slug)) return c.json({ error: 'invalid_slug' }, 400);
  await next();
});
app.use('/apps/:slug', async (c, next) => {
  const slug = c.req.param('slug');
  if (!isValidSlug(slug)) return c.json({ error: 'invalid_slug' }, 400);
  await next();
});

// ============================================================
// Helpers
// ============================================================
async function requireAdmin(c: any, next: any) {
  let token = getCookie(c, COOKIE_NAME);
  const authHeader = c.req.header('authorization') || '';
  if (!token && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim();
  }
  const secret = c.env.JWT_SECRET || '';
  if (!token || !secret) return c.json({ error: 'unauthorized' }, 401);
  const payload = await verifyJwt(token, secret);
  if (!payload || payload.role !== 'admin') return c.json({ error: 'unauthorized' }, 401);
  c.set('user', { sub: String(payload.sub) });
  await next();
}

async function ensureUniqueSlug(base: string, env: Env): Promise<string> {
  let slug = base;
  let i = 1;
  while (true) {
    const db = await firestore(env);
    const snap = await db.collection('apps').where('slug', '==', slug).limit(1).get();
    if (snap.empty) return slug;
    i++;
    slug = `${base}-${i}`;
    if (i > 200) return `${base}-${randomId().slice(0, 6)}`;
  }
}

function ratingAverage(d: any): number {
  const count = Number(d.rating_count || 0);
  const sum = Number(d.rating_sum || 0);
  if (count <= 0) return 0;
  return Math.round((sum / count) * 10) / 10;
}

function appPublic(doc: any, includeInternalKeys = false): App & { id: string } {
  const d = doc.data() as App;
  const ratingCount = Number((d as any).rating_count || 0);
  const result: any = {
    id: doc.id,
    slug: d.slug,
    name: d.name,
    name_lower: d.name_lower,
    search_terms: [],
    package_name: d.package_name,
    short_description: d.short_description,
    description: d.description,
    category: d.category,
    type: (d as any).type === 'game' ? 'game' : 'app',
    developer: d.developer,
    version_name: d.version_name,
    version_code: d.version_code,
    min_sdk: d.min_sdk,
    size_bytes: d.size_bytes,
    rating: ratingAverage(d),
    rating_count: ratingCount,
    stars: ratingCount,
    downloads: d.downloads || 0,
    created_at: d.created_at,
    updated_at: d.updated_at,
  };
  if (includeInternalKeys) {
    result.apk_key = d.apk_key;
    result.icon_key = d.icon_key;
    result.feature_key = (d as any).feature_key;
  }
  return result;
}

function feature_url(feature_key: string | undefined, env: Env, width: number = 800): string | null {
  if (!feature_key) return null;
  try {
    const baseUrl = r2PublicUrl(feature_key, env);
    return `https://goldenstore.online/cdn-cgi/image/width=${width},format=auto,quality=80/${baseUrl}`;
  } catch {
    return null;
  }
}

function icon_url(icon_key: string | undefined, env: Env, width: number = 200): string | null {
  if (!icon_key) return null;
  try {
    const baseUrl = r2PublicUrl(icon_key, env);
    return `https://goldenstore.online/cdn-cgi/image/width=${width},format=auto,quality=80/${baseUrl}`;
  } catch {
    return null;
  }
}

function notificationPublic(doc: any) {
  const d = doc.data ? (doc.data() || {}) : {};
  const type = d.type === 'new_app' || d.type === 'update' ? d.type : 'announcement';
  return {
    id: doc.id,
    title: sanitizeText(d.title, 200),
    body: sanitizeText(d.body, 1000),
    type,
    app_slug: sanitizeText(d.app_slug, 120),
    data: d.data || null,
    created_at: Number(d.created_at || 0),
  };
}

async function listNotifications(db: any, limit?: number) {
  let docs: any[];
  try {
    let query: any = db.collection('notifications').orderBy('created_at', 'desc');
    if (typeof limit === 'number') query = query.limit(limit);
    const snap = await query.get();
    docs = snap.docs;
  } catch (err: any) {
    if (err?.code === 9 || err?.code === 3 || /index/i.test(err?.message ?? '')) {
      const snap = await db.collection('notifications').get();
      docs = snap.docs.sort((a: any, b: any) => (b.data().created_at || 0) - (a.data().created_at || 0));
      if (typeof limit === 'number') docs = docs.slice(0, limit);
    } else {
      throw err;
    }
  }
  return docs.map((d: any) => notificationPublic(d));
}

async function getStoreSettings(db: any): Promise<{ notify_new_publications: boolean }> {
  const snap = await db.collection('store_settings').doc('general').get();
  const data = snap.exists ? (snap.data() || {}) : {};
  return { notify_new_publications: data.notify_new_publications !== false };
}

function storeLogoUrl(env: Env): string {
  return env.STORE_LOGO_URL || 'https://goldenstore.online/images/logo.png';
}

async function resolveNotificationImage(db: any, app_slug: string): Promise<string> {
  if (!app_slug) return '';
  try {
    const snap = await db.collection('apps').where('slug', '==', app_slug).limit(1).get();
    if (snap.empty) return '';
    const url = icon_url((snap.docs[0].data() as any).icon_key, db.env);
    return url || '';
  } catch {
    return '';
  }
}

async function addNotification(db: any, data: any, env: Env) {
  const title = sanitizeText(data.title, 200);
  if (!title) throw new Error('notification_title_required');
  const body = sanitizeText(data.body, 1000);
  const type = data.type === 'new_app' || data.type === 'update' ? data.type : 'announcement';
  const app_slug = sanitizeText(data.app_slug, 120);
  const payloadData = data.data && typeof data.data === 'object' ? data.data : null;
  const created_at = Number(data.created_at || nowSec());
  const ref = await db.collection('notifications').add({
    title,
    body,
    type,
    app_slug: app_slug || '',
    data: payloadData,
    created_at,
  });
  let push: PushResult = { targeted: 0, success: 0, failure: 0, errors: [] };
  try {
    const image = await resolveNotificationImage(db, app_slug);
    push = await sendPushToRegistered(db, {
      title,
      body,
      type,
      app_slug: app_slug || '',
      id: ref.id,
      image,
      data: payloadData,
    }, env);
  } catch (err: any) {
    console.error('[fcm] push failed:', err?.message || err);
    push.errors.push('exception: ' + (err?.message || String(err)));
  }
  return { ref, push };
}

type PushResult = { targeted: number; success: number; failure: number; errors: string[]; invalid_tokens?: string[] };

async function sendPushToTokens(
  tokens: string[],
  n: { title: string; body: string; type: string; app_slug: string; id: string; image?: string; data?: any },
  env: Env,
): Promise<PushResult> {
  const result: PushResult = { targeted: 0, success: 0, failure: 0, errors: [] };
  result.targeted = tokens.length;
  if (tokens.length === 0) return result;

  const msg = await messaging(env);
  const dataPayload: Record<string, string> = {
    title: n.title,
    body: n.body || '',
    type: n.type,
    app_slug: n.app_slug || '',
    notification_id: n.id,
    image: n.image || '',
    store_logo: storeLogoUrl(env),
  };
  if (n.data && typeof n.data === 'object') {
    try { dataPayload.extra = JSON.stringify(n.data); } catch {}
  }
  const invalidTokens: string[] = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    let resp: any;
    try {
      resp = await msg.sendEachForMulticast({
        tokens: batch,
        data: dataPayload,
        notification: { title: n.title, body: n.body || '' },
        android: {
          priority: 'high',
          notification: {
            title: n.title,
            body: n.body || '',
            channelId: 'goldenstore_notifications',
            color: '#f4c01f',
            visibility: 'public',
          },
        },
      });
    } catch (err: any) {
      console.error('[fcm] multicast error:', err?.message || err);
      result.failure += batch.length;
      result.errors.push('multicast_error: ' + (err?.message || String(err)));
      continue;
    }
    result.success += resp.successCount || 0;
    result.failure += resp.failureCount || 0;
    resp.responses.forEach((r: any, idx: number) => {
      if (!r.success) {
        const code = r.error?.code || '';
        if (result.errors.length < 5) result.errors.push(code || (r.error?.message || 'unknown'));
        if (
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-registration-token') ||
          code.includes('invalid-argument')
        ) {
          invalidTokens.push(batch[idx]);
        }
      }
    });
  }
  result.invalid_tokens = invalidTokens;
  return result;
}

async function sendPushToRegistered(
  db: any,
  n: { title: string; body: string; type: string; app_slug: string; id: string; image?: string; data?: any },
  env: Env,
): Promise<PushResult> {
  const result: PushResult = { targeted: 0, success: 0, failure: 0, errors: [] };
  let registered = 0;
  let tokensSnap: any;
  try {
    // OPTIMIZATION: limit token read, we only need count for the response
    tokensSnap = await db.collection('fcm_tokens').limit(1000).get();
    registered = (tokensSnap.docs || []).filter((d: any) => String(d.data()?.token || '').length > 0).length;
  } catch (err: any) {
    console.error('[fcm] failed to read tokens:', err?.message || err);
  }
  result.targeted = registered;

  const msg = await messaging(env);
  const dataPayload: Record<string, string> = {
    title: n.title,
    body: n.body || '',
    type: n.type,
    app_slug: n.app_slug || '',
    notification_id: n.id,
    image: n.image || '',
    store_logo: storeLogoUrl(env),
  };
  if (n.data && typeof n.data === 'object') {
    try { dataPayload.extra = JSON.stringify(n.data); } catch {}
  }
  try {
    await msg.send({
      topic: 'all',
      data: dataPayload,
      notification: { title: n.title, body: n.body || '' },
      android: {
        priority: 'high',
        notification: {
          title: n.title,
          body: n.body || '',
          channelId: 'goldenstore_notifications',
          color: '#f4c01f',
          visibility: 'public',
        },
      },
    });
    result.success = Math.max(1, registered);
  } catch (err: any) {
    console.error('[fcm] topic send failed:', err?.message || err);
    result.failure = Math.max(1, registered);
    result.errors.push('topic_send_failed: ' + (err?.message || String(err)));
  }

  try {
    const web = await sendWebPush(env, n.title, n.body || '', {
      type: n.type,
      app_slug: n.app_slug || '',
      notification_id: n.id,
      image: n.image || '',
      store_logo: storeLogoUrl(env),
    });
    result.targeted += web.targeted;
    result.success += web.success;
    result.failure += web.failure;
    for (const webError of web.errors) {
      if (result.errors.length < 8) result.errors.push(webError);
    }
  } catch (err: any) {
    console.error('[fcm] web push failed:', err?.message || err);
    result.errors.push('web_push_failed: ' + (err?.message || String(err)));
  }
  return result;
}

// ============================================================
// Public routes
// ============================================================

app.get('/store', (c) => {
  c.header('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  return c.json({
    name: c.env.STORE_NAME || 'Goldenstore',
    domain: c.env.STORE_DOMAIN || 'goldenstore.online',
  });
});

const CURRENT_RELEASE = {
  version_name: '1.18',
  version_code: 19,
  apk_url: 'https://cdn.goldenstore.online/apk/goldenstore-app-1791319330825-c2d8f1.apk',
  notes: 'نسخة أسرع بكثير: التطبيق الآن يفتح المتجر مباشرة بدون انتظار — حدّث الآن',
};

app.get('/app-update', async (c) => {
  try {
    const db = await firestore(c.env);
    const doc = await db.collection('app_updates').doc('current').get();

    if (!doc.exists) {
      return c.json({
        version_name: CURRENT_RELEASE.version_name,
        version_code: CURRENT_RELEASE.version_code,
        apk_url: CURRENT_RELEASE.apk_url,
        url: CURRENT_RELEASE.apk_url,
        notes: CURRENT_RELEASE.notes,
        message: CURRENT_RELEASE.notes,
        force: false,
        created_at: 0,
        downloads: 0,
        update: {
          version_name: CURRENT_RELEASE.version_name,
          version_code: CURRENT_RELEASE.version_code,
          apk_url: CURRENT_RELEASE.apk_url,
          url: CURRENT_RELEASE.apk_url,
          notes: CURRENT_RELEASE.notes,
          message: CURRENT_RELEASE.notes,
          force: false,
        },
      });
    }

    const d = doc.data() || {};
    const version_code = safeInt(d.version_code, 0, 999999999);
    const apk_url = sanitizeUrl(d.apk_url) || sanitizeUrl(d.url) || CURRENT_RELEASE.apk_url;
    const notes = sanitizeText(d.notes, 1000) || CURRENT_RELEASE.notes;
    const version_name = sanitizeText(d.version_name, 60) || CURRENT_RELEASE.version_name;
    const force = d.force === true;

    const out: Record<string, any> = {
      version_name,
      version_code,
      apk_url,
      url: apk_url,
      notes,
      message: notes,
      force,
      created_at: Number(d.created_at || 0),
      downloads: safeInt(d.downloads, 0, Number.MAX_SAFE_INTEGER),
    };
    out.update = { ...out };
    c.header('Cache-Control', 'public, max-age=300, s-maxage=300');
    return c.json(out);
  } catch (err: any) {
    console.error('[app-update] get failed:', err?.message || err);
    return c.json({});
  }
});

app.get('/app-update/download', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'app-update-download', 30, 60)) {
    return c.json({ error: 'rate_limited' }, 429);
  }
  const db = await firestore(c.env);
  const ref = db.collection('app_updates').doc('current');
  const doc = await ref.get();

  let apkUrl = '';
  if (doc.exists) {
    const data = doc.data() || {};
    apkUrl = sanitizeUrl(data.apk_url) || sanitizeUrl(data.url) || '';
  }
  if (!apkUrl) apkUrl = CURRENT_RELEASE.apk_url;
  if (!apkUrl) return c.json({ error: 'apk_not_available' }, 404);

  if (doc.exists && rateLimit(ip, 'dl-count:store-app-update', 1, 600)) {
    try {
      const FV = await getFieldValue();
      await ref.set({ downloads: FV.increment(1) }, { merge: true });
    } catch (err: any) {
      console.error('[app-update/download] counter update failed:', err?.message || err);
    }
  }

  return c.redirect(apkUrl, 302);
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
  const limit = Math.min(Number(c.req.query('limit') || '30') || 30, 50);
  const db = await firestore(c.env);
  const notifications = await listNotifications(db, limit);
  c.header('Cache-Control', 'public, max-age=60, s-maxage=60');
  return c.json({ notifications });
});

async function requireFirebaseUser(c: any) {
  const authHeader = c.req.header('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;
  return verifyFirebaseToken(token, c.env);
}

app.post('/notifications/register-token', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'reg-token', 30, 60)) return c.json({ error: 'rate_limited' }, 429);
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({} as any));
  const token = String(body.token || '').trim();
  if (!token || token.length > 4096) return c.json({ error: 'invalid_token' }, 400);
  const db = await firestore(c.env);
  const docId = await sha256Hex(token);
  await db.collection('fcm_tokens').doc(docId).set({
    token,
    uid: user.uid,
    platform: String(body.platform || 'android').slice(0, 20),
    updated_at: nowSec(),
  });
  return c.json({ ok: true });
});

app.post('/notifications/register-web', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'reg-web-token', 30, 60)) return c.json({ error: 'rate_limited' }, 429);
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({} as any));
  const token = String(body.token || '').trim();
  if (!token || token.length > 4096) return c.json({ error: 'invalid_token' }, 400);
  const db = await firestore(c.env);
  await db.collection('web_tokens').doc(user.uid).set({
    token,
    platform: 'web',
    userAgent: String(c.req.header('user-agent') || '').slice(0, 300),
    updatedAt: nowSec(),
  });
  return c.json({ ok: true });
});

app.post('/notifications/unregister-token', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const token = String(body.token || '').trim();
  if (!token) return c.json({ error: 'invalid_token' }, 400);
  const db = await firestore(c.env);
  const docId = await sha256Hex(token);
  await db.collection('fcm_tokens').doc(docId).delete().catch(() => {});
  return c.json({ ok: true });
});

app.get('/notifications/my-tokens', async (c) => {
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const db = await firestore(c.env);
  const snap = await db.collection('fcm_tokens').where('uid', '==', user.uid).get();
  const tokens = snap.docs.map((d: any) => {
    const t = String(d.data()?.token || '');
    return {
      platform: String(d.data()?.platform || 'unknown'),
      updated_at: Number(d.data()?.updated_at || 0),
      token_tail: t.length > 6 ? t.slice(-6) : '…',
    };
  }).sort((a: any, b: any) => b.updated_at - a.updated_at);
  return c.json({ registered: tokens.length, tokens });
});

app.post('/notifications/self-test', async (c) => {
  const ip = getClientIp(c);
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (!rateLimit(`${user.uid}:${ip}`, 'self-test', 6, 600)) {
    return c.json({ error: 'rate_limit_exceeded' }, 429);
  }
  const db = await firestore(c.env);
  const snap = await db.collection('fcm_tokens').where('uid', '==', user.uid).get();
  const docs: any[] = snap.docs;
  const tokens: string[] = docs
    .map((d: any) => String(d.data()?.token || ''))
    .filter((t: string) => t.length > 0);
  if (tokens.length === 0) return c.json({ error: 'no_registered_devices' }, 400);
  const push = await sendPushToTokens(tokens, {
    title: 'إشعار تجريبي من Golden Store',
    body: 'إذا ظهر لك هذا الإشعار، فالإشعارات تعمل بشكل سليم ✓',
    type: 'announcement',
    app_slug: '',
    id: 'self-test-' + nowSec(),
  }, c.env);
  delete push.invalid_tokens;
  return c.json({ ok: true, push });
});

// ============================================================
// Translation
// ============================================================
const SUPPORTED_TL = new Set(['en', 'fr', 'es']);
const memTranslate = new Map<string, string>();

async function mtOne(text: string, target: string): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('mt_failed');
  const data = (await res.json()) as any;
  const segs = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];
  let out = '';
  for (const s of segs) if (s && typeof s[0] === 'string') out += s[0];
  return out || text;
}

app.post('/translate', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'translate', 120, 60)) return c.json({ error: 'rate_limit_exceeded' }, 429);
  const body = await c.req.json().catch(() => ({} as any));
  const target = String(body.target || '').trim().toLowerCase();
  const q: string[] = Array.isArray(body.q) ? body.q.slice(0, 60).map((x: any) => String(x == null ? '' : x)) : [];
  if (!SUPPORTED_TL.has(target)) return c.json({ t: q });
  if (!q.length) return c.json({ t: [] });

  const db = await firestore(c.env).catch(() => null);
  const out: (string | null)[] = new Array(q.length).fill(null);
  const toFetch: { i: number; text: string; id: string }[] = [];

  for (let i = 0; i < q.length; i++) {
    const text = q[i];
    if (!text || text.length > 5000) { out[i] = text; continue; }
    const id = await sha1Hex(target + '::' + text);
    const mem = memTranslate.get(id);
    if (mem != null) { out[i] = mem; continue; }
    toFetch.push({ i, text, id });
  }

  if (db && toFetch.length) {
    await Promise.all(toFetch.map(async (item) => {
      try {
        const doc = await db.collection('i18n_cache').doc(item.id).get();
        if (doc.exists) {
          const v = (doc.data() as any).out;
          if (typeof v === 'string') { out[item.i] = v; memTranslate.set(item.id, v); }
        }
      } catch {}
    }));
  }

  const remaining = toFetch.filter((it) => out[it.i] == null);
  const CONCURRENCY = 6;
  for (let k = 0; k < remaining.length; k += CONCURRENCY) {
    const batch = remaining.slice(k, k + CONCURRENCY);
    await Promise.all(batch.map(async (item) => {
      try {
        const tr = await mtOne(item.text, target);
        out[item.i] = tr;
        memTranslate.set(item.id, tr);
        if (db) db.collection('i18n_cache').doc(item.id).set({ target, src: item.text, out: tr, ts: nowSec() }).catch(() => {});
      } catch {
        out[item.i] = item.text;
      }
    }));
  }

  for (let i = 0; i < q.length; i++) if (out[i] == null) out[i] = q[i];
  c.header('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  return c.json({ t: out });
});

// ============================================================
// Categories (CACHED)
// ============================================================
app.get('/categories', async (c) => {
  const type = (c.req.query('type') || '').trim();
  const now = Date.now();

  let counts: Record<string, number>;

  if (categoriesCache.data && (now - categoriesCache.ts) < CATEGORIES_CACHE_TTL * 1000) {
    counts = categoriesCache.data;
  } else {
    const db = await firestore(c.env);
    // OPTIMIZATION: read once, cache for 1 hour
    const snap = await db.collection('apps').select('category').get();
    counts = {};
    snap.forEach((d: any) => {
      const cat = (d.data() as any).category || 'other';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    categoriesCache.data = counts;
    categoriesCache.ts = now;
  }

  const source = type === 'app' ? APP_CATEGORIES
    : type === 'game' ? GAME_CATEGORIES
    : DEFAULT_CATEGORIES;
  const categories: Category[] = source.map((cat) => ({ ...cat, count: counts[cat.slug] || 0 }));
  c.header('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  return c.json({ categories });
});

// ============================================================
// Apps list (CACHED + filter/sort/paginate in memory)
// ============================================================
app.get('/apps', async (c) => {
  const q = (c.req.query('q') || '').trim().toLowerCase();
  const category = (c.req.query('category') || '').trim();
  const type = (c.req.query('type') || '').trim();
  const sort = (c.req.query('sort') || 'recent').trim();
  const starredOnly = c.req.query('starred') === '1';
  const limit = Math.min(Number(c.req.query('limit') || '24') || 24, 60);
  const offset = Math.max(Number(c.req.query('offset') || '0') || 0, 0);

  const gameOnly = type === 'game';
  const excludeGames = type === 'app';

  const db = await firestore(c.env);

  let allDocs: any[];
  try {
    // OPTIMIZATION: cache apps list for 5 minutes
    allDocs = await getAppsCached(db);
  } catch (err: any) {
    console.error('[apps] firestore read failed:', err?.message || err);
    return c.json({ error: 'firestore_error', message: err?.message || String(err) }, 500);
  }

  let docs = allDocs;

  if (gameOnly) {
    docs = docs.filter((d: any) => (d.data() as any).type === 'game');
  } else if (excludeGames) {
    docs = docs.filter((d: any) => (d.data() as any).type !== 'game');
  }

  if (category) {
    docs = docs.filter((d: any) => (d.data() as any).category === category);
  }

  if (starredOnly) {
    docs = docs.filter((d: any) => ((d.data() as any).stars || 0) > 0);
  }

  if (q) {
    const token = q.split(/\s+/).filter((w) => w.length >= 2)[0];
    if (token) {
      docs = docs.filter((d: any) => {
        const terms = (d.data() as any).search_terms;
        return Array.isArray(terms) && terms.includes(token);
      });
    }
  }

  if (sort === 'popular') {
    docs.sort((a: any, b: any) => {
      const diff = ((b.data().downloads || 0) - (a.data().downloads || 0));
      if (diff !== 0) return diff;
      return ratingAverage(b.data()) - ratingAverage(a.data());
    });
  } else if (sort === 'stars' || sort === 'rating') {
    docs.sort((a: any, b: any) => {
      const diff = ratingAverage(b.data()) - ratingAverage(a.data());
      if (diff !== 0) return diff;
      return ((b.data().rating_count || 0) - (a.data().rating_count || 0));
    });
  } else if (sort === 'name') {
    docs.sort((a: any, b: any) =>
      (a.data().name_lower || '').localeCompare(b.data().name_lower || '')
    );
  } else {
    docs.sort((a: any, b: any) =>
      (b.data().created_at || 0) - (a.data().created_at || 0)
    );
  }

  const total = docs.length;
  const paginatedDocs = docs.slice(offset, offset + limit);

  const apps = paginatedDocs.map((d: any) => {
    const a = appPublic(d);
    return {
      ...a,
      icon_url: icon_url((d.data() as App).icon_key, c.env),
      feature_url: feature_url((d.data() as App).feature_key, c.env),
    };
  });

  c.header('Cache-Control', 'public, max-age=300, s-maxage=300');
  return c.json({ apps, total });
});

// ============================================================
// App detail
// ============================================================
app.get('/apps/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = await firestore(c.env);
  const snap = await db.collection('apps').where('slug', '==', slug).limit(1).get();
  if (snap.empty) return c.json({ error: 'not_found' }, 404);
  const doc = snap.docs[0];
  const ap = appPublic(doc);
  const rawData = doc.data() as App;
  const ssSnap = await db
    .collection('apps')
    .doc(doc.id)
    .collection('screenshots')
    .orderBy('position', 'asc')
    .get();
  const screenshots = ssSnap.docs.map((s: any) => {
    const sd = s.data() as Screenshot;
    return { id: s.id, position: sd.position, url: icon_url(sd.r2_key, c.env) };
  });
  c.header('Cache-Control', 'public, max-age=300, s-maxage=300');
  return c.json({
    app: { ...ap, icon_url: icon_url(rawData.icon_key, c.env), feature_url: feature_url(rawData.feature_key, c.env) },
    screenshots,
  });
});

// ============================================================
// App download
// ============================================================
app.get('/apps/:slug/download', async (c) => {
  const ip = getClientIp(c);
  const slug = c.req.param('slug');
  if (!rateLimit(ip, 'download', 30, 60)) {
    return c.json({ error: 'rate_limit_exceeded' }, 429);
  }
  const db = await firestore(c.env);
  const snap = await db.collection('apps').where('slug', '==', slug).limit(1).get();
  if (snap.empty) return c.json({ error: 'not_found' }, 404);
  const doc = snap.docs[0];
  const a = doc.data() as App;
  if (!a.apk_key) return c.json({ error: 'apk_not_available' }, 404);

  if (rateLimit(ip, `dl-count:${slug}`, 1, 600)) {
    const FV = await getFieldValue();
    await doc.ref.update({ downloads: FV.increment(1) });
  }

  const filename = `${a.slug || 'app'}-${a.version_name || ''}.apk`.replace(/-+/g, '-');
  const disposition = `attachment; filename="${filename}"`;
  const url = await r2PresignGet(c.env, a.apk_key, 300, disposition);

  if (c.req.query('stream') === '1') {
    const upstream = await fetch(url);
    if (!upstream.ok || !upstream.body) {
      return c.json({ error: 'download_failed' }, 502);
    }
    const headers = new Headers();
    headers.set('Content-Type', 'application/vnd.android.package-archive');
    headers.set('Content-Disposition', disposition);
    const len = upstream.headers.get('content-length');
    if (len) headers.set('Content-Length', len);
    headers.set('Cache-Control', 'no-store');
    return new Response(upstream.body, { headers });
  }

  return c.redirect(url);
});

// ============================================================
// Star / reviews
// ============================================================
function serverFingerprint(c: any): string {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown';
  const ua = c.req.header('user-agent') || '';
  const lang = c.req.header('accept-language') || '';
  return `${ip}||${ua}||${lang}`;
}

function computeVoteHash(clientFp: string, serverFp: string): Promise<string> {
  return sha256Hex(`${clientFp}::${serverFp}`);
}

app.post('/apps/:slug/star', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'star', 10, 60)) {
    return c.json({ error: 'rate_limit_exceeded' }, 429);
  }
  const slug = c.req.param('slug');

  const body = await c.req.json().catch(() => ({} as any));
  const clientFp = String(body.fp || '').trim();
  if (!clientFp || clientFp.length < 16 || clientFp.length > 256) {
    return c.json({ error: 'invalid_fingerprint' }, 400);
  }
  const rating = Math.round(Number(body.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return c.json({ error: 'invalid_rating' }, 400);
  }
  const comment = sanitizeText(body.comment, 2000);
  const name = sanitizeText(body.name, 60);
  const uid = sanitizeText(body.uid, 128);
  let photo_url = sanitizeUrl(body.photo_url);
  if (!photo_url.startsWith('https://')) photo_url = '';

  const db = await firestore(c.env);
  const snap = await db.collection('apps').where('slug', '==', slug).limit(1).get();
  if (snap.empty) return c.json({ error: 'not_found' }, 404);
  const doc = snap.docs[0];

  const sFp = serverFingerprint(c);
  const voteHash = await computeVoteHash(clientFp, sFp);
  const serverOnlyHash = await sha256Hex(sFp);

  const votesRef = doc.ref.collection('star_votes');
  if (uid) {
    const existingByUid = await votesRef.where('uid', '==', uid).limit(1).get();
    if (!existingByUid.empty) {
      return c.json({ error: 'already_voted', rating: ratingAverage(doc.data()), rating_count: Number((doc.data() as any).rating_count || 0) }, 409);
    }
  } else {
    const existingByHash = await votesRef.where('hash', '==', voteHash).limit(1).get();
    if (!existingByHash.empty) {
      return c.json({ error: 'already_voted', rating: ratingAverage(doc.data()), rating_count: Number((doc.data() as any).rating_count || 0) }, 409);
    }
    const existingByServer = await votesRef.where('server_hash', '==', serverOnlyHash).limit(1).get();
    if (!existingByServer.empty) {
      return c.json({ error: 'already_voted', rating: ratingAverage(doc.data()), rating_count: Number((doc.data() as any).rating_count || 0) }, 409);
    }
  }

  await votesRef.add({
    hash: voteHash,
    server_hash: serverOnlyHash,
    uid: uid || null,
    rating,
    comment,
    name,
    photo_url: photo_url || null,
    ts: nowSec(),
  });
  const result = await db.runTransaction(async (tx: any) => {
    const fresh = await tx.get(doc.ref);
    const data = (fresh.data() || {}) as any;
    const newSum = Number(data.rating_sum || 0) + rating;
    const newCount = Number(data.rating_count || 0) + 1;
    const avg = Math.round((newSum / newCount) * 10) / 10;
    tx.update(doc.ref, {
      rating_sum: newSum,
      rating_count: newCount,
      rating: avg,
      stars: newCount,
    });
    return { rating: avg, rating_count: newCount };
  });

  invalidateAppsCache();

  const review = (comment || name)
    ? { name: name || 'مستخدم', rating, comment, photo_url: photo_url || null, ts: nowSec() }
    : null;
  return c.json({ ok: true, ...result, review });
});

app.post('/apps/:slug/star-check', async (c) => {
  const slug = c.req.param('slug');
  const body = await c.req.json().catch(() => ({} as any));
  const clientFp = String(body.fp || '').trim();
  const uid = String(body.uid || '').trim().slice(0, 128);
  if ((!clientFp || clientFp.length < 16) && !uid) {
    return c.json({ voted: false });
  }

  const db = await firestore(c.env);
  const snap = await db.collection('apps').where('slug', '==', slug).limit(1).get();
  if (snap.empty) return c.json({ error: 'not_found' }, 404);
  const doc = snap.docs[0];

  const ratingAvg = ratingAverage(doc.data());
  const ratingCount = Number((doc.data() as any).rating_count || 0);
  const mine = (v: any) => c.json({
    voted: true,
    my_rating: Number(v.rating || 0),
    my_comment: v.comment || '',
    my_name: v.name || '',
    my_photo: v.photo_url || '',
    rating: ratingAvg,
    rating_count: ratingCount,
  });

  if (uid) {
    const existingByUid = await doc.ref.collection('star_votes').where('uid', '==', uid).limit(1).get();
    if (!existingByUid.empty) return mine(existingByUid.docs[0].data());
    return c.json({ voted: false, rating: ratingAvg, rating_count: ratingCount });
  }

  const sFp = serverFingerprint(c);
  const voteHash = await computeVoteHash(clientFp, sFp);
  const serverOnlyHash = await sha256Hex(sFp);
  const existingByHash = await doc.ref.collection('star_votes').where('hash', '==', voteHash).limit(1).get();
  if (!existingByHash.empty) return mine(existingByHash.docs[0].data());
  const existingByServer = await doc.ref.collection('star_votes').where('server_hash', '==', serverOnlyHash).limit(1).get();
  if (!existingByServer.empty) return mine(existingByServer.docs[0].data());
  return c.json({ voted: false, my_rating: 0, my_comment: '', my_name: '', my_photo: '', rating: ratingAvg, rating_count: ratingCount });
});

app.get('/apps/:slug/reviews', async (c) => {
  const slug = c.req.param('slug');
  const limit = Math.min(Number(c.req.query('limit') || '50') || 50, 100);
  const db = await firestore(c.env);
  const snap = await db.collection('apps').where('slug', '==', slug).limit(1).get();
  if (snap.empty) return c.json({ error: 'not_found' }, 404);
  const doc = snap.docs[0];

  // OPTIMIZATION: only fetch recent reviews, not all
  const votesSnap = await doc.ref.collection('star_votes')
    .orderBy('ts', 'desc')
    .limit(limit * 2)
    .get();

  const dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  const reviews: { name: string; rating: number; comment: string; photo_url: string | null; ts: number }[] = [];
  votesSnap.forEach((v: any) => {
    const d = v.data() as any;
    const r = Math.round(Number(d.rating) || 0);
    if (r >= 1 && r <= 5) dist[String(r)]++;
    const comment = String(d.comment || '').trim();
    if (comment) {
      const photo = String(d.photo_url || '').trim();
      reviews.push({
        name: String(d.name || '').trim() || 'مستخدم',
        rating: r,
        comment,
        photo_url: /^https:\/\//.test(photo) ? photo : null,
        ts: Number(d.ts || 0),
      });
    }
  });
  reviews.sort((a, b) => b.ts - a.ts);

  c.header('Cache-Control', 'public, max-age=300, s-maxage=300');
  return c.json({
    reviews: reviews.slice(0, limit),
    total: reviews.length,
    dist,
    rating: ratingAverage(doc.data()),
    rating_count: Number((doc.data() as any).rating_count || 0),
  });
});

// ============================================================
// Request update / report
// ============================================================
app.post('/apps/:slug/request-update', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'req-update', 5, 300)) {
    return c.json({ error: 'rate_limit_exceeded' }, 429);
  }
  const slug = c.req.param('slug');
  const body = await c.req.json().catch(() => ({} as any));
  const newVersion = sanitizeText(body.new_version, 60);
  const source = sanitizeUrl(body.source) || sanitizeText(body.source, 500);
  if (!newVersion) return c.json({ error: 'new_version_required' }, 400);

  const db = await firestore(c.env);
  const snap = await db.collection('apps').where('slug', '==', slug).limit(1).get();
  if (snap.empty) return c.json({ error: 'not_found' }, 404);
  const a = snap.docs[0].data() as App;

  await db.collection('app_requests').add({
    type: 'update',
    slug,
    app_name: a.name || slug,
    current_version: a.version_name || '',
    new_version: newVersion,
    source,
    status: 'new',
    ts: nowSec(),
  });
  return c.json({ ok: true });
});

app.post('/apps/:slug/report', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'report', 5, 300)) {
    return c.json({ error: 'rate_limit_exceeded' }, 429);
  }
  const slug = c.req.param('slug');
  const body = await c.req.json().catch(() => ({} as any));
  const reason = sanitizeText(body.reason, 80);
  const details = sanitizeText(body.details, 2000);
  if (!reason) return c.json({ error: 'reason_required' }, 400);

  const db = await firestore(c.env);
  const snap = await db.collection('apps').where('slug', '==', slug).limit(1).get();
  if (snap.empty) return c.json({ error: 'not_found' }, 404);
  const a = snap.docs[0].data() as App;

  await db.collection('app_requests').add({
    type: 'report',
    slug,
    app_name: a.name || slug,
    reason,
    details,
    status: 'new',
    ts: nowSec(),
  });
  return c.json({ ok: true });
});

// ============================================================
// Auth (admin)
// ============================================================
function isSecureRequest(c: any): boolean {
  const proto = c.req.header('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  try {
    return new URL(c.req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

app.post('/login', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'login', 5, 300)) {
    return c.json({ error: 'rate_limit_exceeded' }, 429);
  }

  const body = await c.req.json().catch(() => ({} as any));
  const adminUser = c.env.ADMIN_USERNAME || 'admin';
  const username = String(body.username ?? adminUser);
  const password = String(body.password ?? '');
  const adminPass = c.env.ADMIN_PASSWORD || '';
  const secret = c.env.JWT_SECRET || '';
  if (!adminPass || !secret) return c.json({ error: 'server_not_configured' }, 500);

  const userOk = constantTimeEqual(username, adminUser);
  const passOk = !!password && constantTimeEqual(password, adminPass);
  if (!userOk || !passOk) {
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
    return c.json({ error: 'invalid_credentials' }, 401);
  }

  const token = await signJwt({ sub: adminUser, role: 'admin' }, secret);
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
  return c.json({ ok: true, user: { username: adminUser } });
});

app.post('/logout', (c) => {
  setCookie(c, COOKIE_NAME, '', {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: 0,
  });
  return c.json({ ok: true });
});

app.get('/me', async (c) => {
  const token = getCookie(c, COOKIE_NAME);
  const secret = c.env.JWT_SECRET || '';
  if (!token || !secret) return c.json({ authenticated: false });
  const payload = await verifyJwt(token, secret);
  if (!payload) return c.json({ authenticated: false });
  return c.json({ authenticated: true, user: { username: payload.sub, role: payload.role } });
});

app.post('/setup-r2-cors', async (c) => {
  const expectedPassword = c.env.ADMIN_PASSWORD || '';
  const suppliedPassword = c.req.header('x-admin-password') || '';
  if (!expectedPassword) return c.json({ error: 'server_not_configured' }, 500);
  if (!constantTimeEqual(suppliedPassword, expectedPassword)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const origins = (c.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  try {
    await r2ConfigureCors(c.env, origins);
    return c.json({ ok: true, message: 'CORS configured for R2 bucket' });
  } catch (error: any) {
    console.error('[setup-r2-cors] failed:', error?.message || error);
    return c.json({ error: 'r2_cors_configuration_failed' }, 500);
  }
});

// ============================================================
// Admin
// ============================================================
app.use('/admin/*', requireAdmin);

app.get('/admin/settings', async (c) => {
  const db = await firestore(c.env);
  return c.json({ settings: await getStoreSettings(db) });
});

app.patch('/admin/settings', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  if (typeof body.notify_new_publications !== 'boolean') {
    return c.json({ error: 'notify_new_publications_must_be_boolean' }, 400);
  }
  const db = await firestore(c.env);
  const settings = {
    notify_new_publications: body.notify_new_publications,
    updated_at: nowSec(),
  };
  await db.collection('store_settings').doc('general').set(settings, { merge: true });
  return c.json({ settings: { notify_new_publications: settings.notify_new_publications } });
});

app.get('/admin/stats', async (c) => {
  const db = await firestore(c.env);
  const snap = await db.collection('apps').get();
  let totalDownloads = 0;
  let totalSize = 0;
  const apps: any[] = [];
  snap.forEach((d: any) => {
    const a = d.data() as App;
    totalDownloads += a.downloads || 0;
    totalSize += a.size_bytes || 0;
    apps.push({
      id: d.id,
      slug: a.slug,
      name: a.name,
      downloads: a.downloads || 0,
      icon_url: icon_url(a.icon_key, c.env),
    });
  });
  apps.sort((a, b) => b.downloads - a.downloads);
  return c.json({
    total_apps: snap.size,
    total_downloads: totalDownloads,
    total_size_bytes: totalSize,
    top_apps: apps.slice(0, 5),
  });
});

app.get('/admin/apps', async (c) => {
  const db = await firestore(c.env);
  const snap = await db.collection('apps').orderBy('created_at', 'desc').get();
  const apps = snap.docs.map((d: any) => {
    const a = appPublic(d, true);
    return { ...a, icon_url: icon_url(a.icon_key, c.env), feature_url: feature_url((a as any).feature_key, c.env) };
  });
  return c.json({ apps });
});

app.post('/admin/migrate-types', async (c) => {
  const db = await firestore(c.env);
  const snap = await db.collection('apps').get();
  let updated = 0;
  let batch = db.batch();
  let pending = 0;
  for (const d of snap.docs) {
    const data = d.data() as any;
    if (data.type === 'app' || data.type === 'game') continue;
    batch.update(d.ref, { type: 'app' });
    updated++;
    pending++;
    if (pending >= 400) { await batch.commit(); batch = db.batch(); pending = 0; }
  }
  if (pending > 0) await batch.commit();
  invalidateAppsCache();
  return c.json({ ok: true, updated, total: snap.size });
});

app.get('/admin/requests', async (c) => {
  const db = await firestore(c.env);
  let docs: any[];
  try {
    const snap = await db.collection('app_requests').orderBy('ts', 'desc').limit(200).get();
    docs = snap.docs;
  } catch {
    const snap = await db.collection('app_requests').get();
    docs = snap.docs.sort((a: any, b: any) => (b.data().ts || 0) - (a.data().ts || 0)).slice(0, 200);
  }
  const requests = docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  return c.json({ requests });
});

app.get('/admin/notifications', async (c) => {
  const db = await firestore(c.env);
  const notifications = await listNotifications(db);
  return c.json({ notifications });
});

app.post('/admin/notifications', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const db = await firestore(c.env);
  const title = sanitizeText(body.title, 200);
  const text = sanitizeText(body.body, 1000);
  if (!title) return c.json({ error: 'title_required' }, 400);

  const { ref, push } = await addNotification(db, {
    title,
    body: text,
    type: 'announcement',
    created_at: nowSec(),
  }, c.env);
  return c.json({ ok: true, id: ref.id, push });
});

app.post('/admin/app-update', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const version_name = sanitizeText(body.version_name, 60);
  const version_code = safeInt(body.version_code, 0, 999999999);

  let apk_url = sanitizeUrl(body.apk_url);
  let apk_key = String(body.apk_key || '').trim();
  let size_bytes = 0;

  if (!apk_url && !apk_key) return c.json({ error: 'apk_url_or_key_required' }, 400);

  if (apk_key) {
    if (!isValidR2Key(apk_key, 'apk')) return c.json({ error: 'invalid_apk_key' }, 400);
    const head = await r2Head(c.env, apk_key);
    if (!head) return c.json({ error: 'apk_not_found_in_r2' }, 400);
    apk_url = r2PublicUrl(apk_key, c.env);
    size_bytes = head.size || 0;
  }

  if (!apk_url) return c.json({ error: 'apk_url_required' }, 400);

  const db = await firestore(c.env);
  const updateDoc: any = {
    version_name: version_name || '',
    version_code,
    apk_url,
    apk_key: apk_key || undefined,
    notes: sanitizeText(body.notes, 1000),
    force: body.force === true,
    size_bytes,
    created_at: nowSec(),
  };
  await db.collection('app_updates').doc('current').set(updateDoc, { merge: true });

  let push: PushResult = { targeted: 0, success: 0, failure: 0, errors: [] };
  if (body.send_notification) {
    try {
      const title = version_name ? `تحديث Golden Store ${version_name}` : 'تحديث Golden Store متاح';
      const { push: p } = await addNotification(db, {
        type: 'update',
        title,
        body: updateDoc.notes || 'حمل النسخة الجديدة الآن',
        app_slug: '',
        data: {
          version_name: updateDoc.version_name,
          version_code: updateDoc.version_code,
          apk_url: updateDoc.apk_url,
          notes: updateDoc.notes,
          force: updateDoc.force,
        },
        created_at: updateDoc.created_at,
      }, c.env);
      push = p;
    } catch (err: any) {
      console.error('[admin/app-update] notification failed:', err?.message || err);
      push.errors.push(err?.message || String(err));
    }
  }
  return c.json({ ok: true, update: updateDoc, push });
});

app.get('/admin/push/status', async (c) => {
  const db = await firestore(c.env);
  let count = 0;
  const platforms: Record<string, number> = {};
  const tokens: any[] = [];
  try {
    const snap = await db.collection('fcm_tokens').limit(500).get();
    count = snap.size;
    snap.forEach((d: any) => {
      const data = d.data() || {};
      const p = String(data.platform || 'unknown');
      platforms[p] = (platforms[p] || 0) + 1;
      const tok = String(data.token || '');
      tokens.push({
        platform: p,
        uid_masked: String(data.uid || '').slice(0, 10),
        updated_at: Number(data.updated_at || 0),
        token_tail: tok.length > 6 ? tok.slice(-6) : '…',
      });
    });
    tokens.sort((a: any, b: any) => b.updated_at - a.updated_at);
  } catch (err: any) {
    return c.json({ error: 'read_failed', message: err?.message || String(err) }, 500);
  }
  return c.json({ registered_tokens: count, platforms, tokens });
});

app.post('/admin/push/test', async (c) => {
  const db = await firestore(c.env);
  const body = await c.req.json().catch(() => ({} as any));
  const title = sanitizeText(body.title, 200) || 'اختبار الإشعارات';
  const text = sanitizeText(body.body, 1000) || 'هذا إشعار تجريبي من لوحة التحكم';
  let push: PushResult = { targeted: 0, success: 0, failure: 0, errors: [] };
  try {
    push = await sendPushToRegistered(db, { title, body: text, type: 'announcement', app_slug: '', id: 'test-' + nowSec() }, c.env);
  } catch (err: any) {
    return c.json({ ok: false, error: 'send_failed', message: err?.message || String(err) }, 500);
  }
  return c.json({ ok: true, push });
});

app.delete('/admin/notifications/:id', async (c) => {
  const id = c.req.param('id');
  const db = await firestore(c.env);
  await db.collection('notifications').doc(id).delete().catch(() => {});
  return c.json({ ok: true });
});

app.delete('/admin/requests/:id', async (c) => {
  const id = c.req.param('id');
  const db = await firestore(c.env);
  await db.collection('app_requests').doc(id).delete().catch(() => {});
  return c.json({ ok: true });
});

app.get('/admin/apps/:id', async (c) => {
  const id = c.req.param('id');
  const db = await firestore(c.env);
  const doc = await db.collection('apps').doc(id).get();
  if (!doc.exists) return c.json({ error: 'not_found' }, 404);
  const a = appPublic(doc, true);
  const ssSnap = await doc.ref.collection('screenshots').orderBy('position', 'asc').get();
  const screenshots = ssSnap.docs.map((s: any) => {
    const sd = s.data() as Screenshot;
    return { id: s.id, position: sd.position, r2_key: sd.r2_key, url: icon_url(sd.r2_key, c.env) };
  });
  return c.json({ app: { ...a, icon_url: icon_url(a.icon_key, c.env), feature_url: feature_url((a as any).feature_key, c.env) }, screenshots });
});

app.post('/admin/upload-url', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const kind = String(body.kind || '');
  const filename = String(body.filename || '');
  const contentType = String(body.content_type || 'application/octet-stream');
  const slugHint = slugify(String(body.slug_hint || 'app'));

  const ALLOWED_CONTENT_TYPES: Record<string, string[]> = {
    apk: ['application/vnd.android.package-archive', 'application/octet-stream'],
    icon: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    screenshot: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    feature: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  };

  if (!['apk', 'icon', 'screenshot', 'feature'].includes(kind)) {
    return c.json({ error: 'invalid_kind' }, 400);
  }
  if (ALLOWED_CONTENT_TYPES[kind] && !ALLOWED_CONTENT_TYPES[kind].includes(contentType)) {
    return c.json({ error: 'invalid_content_type' }, 400);
  }
  const ext = safeExt(filename, kind === 'apk' ? 'apk' : kind === 'feature' ? 'jpg' : kind === 'icon' ? 'png' : 'jpg');
  const ts = Date.now();
  const rand = randomId().slice(0, 6);
  const folder = kind === 'apk' ? 'apk' : kind === 'icon' ? 'icon' : kind === 'feature' ? 'feature' : 'ss';
  const key = `${folder}/${slugHint}-${ts}-${rand}.${ext}`;
  const url = await r2PresignPut(c.env, key, contentType, 7200);
  return c.json({ url, key });
});

app.post('/admin/multipart/create', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const kind = String(body.kind || '');
  const filename = String(body.filename || '');
  const contentType = String(body.content_type || 'application/octet-stream');
  const slugHint = slugify(String(body.slug_hint || 'app'));
  const fileSize = Number(body.file_size || 0);

  const ALLOWED_CONTENT_TYPES: Record<string, string[]> = {
    apk: ['application/vnd.android.package-archive', 'application/octet-stream'],
    icon: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    screenshot: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    feature: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  };
  if (!['apk', 'icon', 'screenshot', 'feature'].includes(kind)) {
    return c.json({ error: 'invalid_kind' }, 400);
  }
  if (ALLOWED_CONTENT_TYPES[kind] && !ALLOWED_CONTENT_TYPES[kind].includes(contentType)) {
    return c.json({ error: 'invalid_content_type' }, 400);
  }
  if (!fileSize || fileSize <= 0) {
    return c.json({ error: 'file_size_required' }, 400);
  }

  const ext = safeExt(filename, kind === 'apk' ? 'apk' : kind === 'feature' ? 'jpg' : kind === 'icon' ? 'png' : 'jpg');
  const ts = Date.now();
  const rand = randomId().slice(0, 6);
  const folder = kind === 'apk' ? 'apk' : kind === 'icon' ? 'icon' : kind === 'feature' ? 'feature' : 'ss';
  const key = `${folder}/${slugHint}-${ts}-${rand}.${ext}`;

  const uploadId = await r2CreateMultipartUpload(c.env, key, contentType);

  const PART_SIZE = 10 * 1024 * 1024;
  const partCount = Math.ceil(fileSize / PART_SIZE);
  const parts: { partNumber: number; url: string }[] = [];
  for (let i = 1; i <= partCount; i++) {
    const url = await r2PresignUploadPart(c.env, key, uploadId, i, 3600);
    parts.push({ partNumber: i, url });
  }

  return c.json({ key, uploadId, partSize: PART_SIZE, parts });
});

app.post('/admin/multipart/complete', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const key = String(body.key || '');
  const uploadId = String(body.uploadId || '');
  const parts: { PartNumber: number; ETag: string }[] = Array.isArray(body.parts) ? body.parts : [];

  if (!key || !uploadId || parts.length === 0) {
    return c.json({ error: 'missing_fields' }, 400);
  }

  await r2CompleteMultipartUpload(c.env, key, uploadId, parts);
  return c.json({ ok: true, key });
});

app.post('/admin/multipart/abort', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const key = String(body.key || '');
  const uploadId = String(body.uploadId || '');
  if (key && uploadId) {
    await r2AbortMultipartUpload(c.env, key, uploadId);
  }
  return c.json({ ok: true });
});

function isValidR2Key(key: string, expectedPrefix: string): boolean {
  if (!key || key.includes('..') || key.startsWith('/')) return false;
  return key.startsWith(`${expectedPrefix}/`);
}

app.post('/admin/apps', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const name = sanitizeText(body.name, 200);
  const package_name = sanitizeText(body.package_name, 200);
  const apk_key = String(body.apk_key || '').trim();
  if (!name || !package_name || !apk_key) {
    return c.json({ error: 'name_package_apk_required' }, 400);
  }
  if (sanitizeText(body.description, 10000).length > 10000 || sanitizeText(body.short_description, 500).length > 500) {
    return c.json({ error: 'input_too_long' }, 400);
  }
  if (!isValidR2Key(apk_key, 'apk')) {
    return c.json({ error: 'invalid_apk_key' }, 400);
  }
  if (body.icon_key && !isValidR2Key(String(body.icon_key), 'icon')) {
    return c.json({ error: 'invalid_icon_key' }, 400);
  }
  if (body.feature_key && !isValidR2Key(String(body.feature_key), 'feature')) {
    return c.json({ error: 'invalid_feature_key' }, 400);
  }

  const head = await r2Head(c.env, apk_key);
  if (!head) return c.json({ error: 'apk_not_found_in_r2' }, 400);

  const base = slugify(name);
  const slug = await ensureUniqueSlug(base, c.env);
  const now = nowSec();

  const docData: App = {
    slug,
    name,
    name_lower: name.toLowerCase(),
    search_terms: searchTerms(name, body.developer, body.short_description, package_name),
    package_name,
    short_description: sanitizeText(body.short_description, 500) || undefined,
    description: sanitizeText(body.description, 10000) || undefined,
    category: sanitizeText(body.category, 60) || 'other',
    type: String(body.type || 'app') === 'game' ? 'game' : 'app',
    developer: sanitizeText(body.developer, 120) || undefined,
    version_name: sanitizeText(body.version_name, 60) || undefined,
    version_code: body.version_code != null ? safeInt(body.version_code, 0, 999999999) : undefined,
    min_sdk: body.min_sdk != null ? safeInt(body.min_sdk, 1, 99) : undefined,
    size_bytes: head.size,
    apk_key,
    icon_key: body.icon_key ? String(body.icon_key) : undefined,
    feature_key: body.feature_key ? String(body.feature_key) : undefined,
    stars: 0,
    rating_sum: 0,
    rating_count: 0,
    rating: 0,
    downloads: 0,
    created_at: now,
    updated_at: now,
  };

  const db = await firestore(c.env);
  const ref = await db.collection('apps').add(docData as unknown as Record<string, unknown>);

  invalidateAppsCache();

  try {
    const settings = await getStoreSettings(db);
    if (settings.notify_new_publications) {
      await addNotification(db, {
        type: 'new_app',
        title: name,
        body: '',
        app_slug: slug,
        created_at: now,
      }, c.env);
    }
  } catch (err: any) {
    console.error('[admin/apps] publication notification skipped:', err?.message || err);
  }

  const screenshotKeys: string[] = Array.isArray(body.screenshot_keys) ? body.screenshot_keys.slice(0, 20) : [];
  for (let i = 0; i < screenshotKeys.length; i++) {
    const r2_key = String(screenshotKeys[i]);
    if (!r2_key || !isValidR2Key(r2_key, 'ss')) continue;
    await ref.collection('screenshots').add({
      app_id: ref.id,
      r2_key,
      position: i,
      created_at: now,
    } as unknown as Record<string, unknown>);
  }

  return c.json({ ok: true, id: ref.id, slug });
});

app.patch('/admin/apps/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const db = await firestore(c.env);
  const ref = db.collection('apps').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return c.json({ error: 'not_found' }, 404);
  const old = snap.data() as App;
  if (('name' in body && String(body.name).length > 200) ||
      ('package_name' in body && String(body.package_name).length > 200) ||
      ('description' in body && String(body.description).length > 10000) ||
      ('short_description' in body && String(body.short_description).length > 500)) {
    return c.json({ error: 'input_too_long' }, 400);
  }
  const update: Partial<App> = { updated_at: nowSec() };
  if ('name' in body) {
    update.name = String(body.name);
    update.name_lower = update.name.toLowerCase();
  }
  if ('package_name' in body) update.package_name = String(body.package_name);
  if ('short_description' in body) update.short_description = String(body.short_description) || undefined;
  if ('description' in body) update.description = String(body.description) || undefined;
  if ('category' in body) update.category = String(body.category);
  if ('type' in body) update.type = String(body.type) === 'game' ? 'game' : 'app';
  if ('developer' in body) update.developer = String(body.developer) || undefined;
  if ('version_name' in body) update.version_name = String(body.version_name) || undefined;
  if ('version_code' in body) update.version_code = Number(body.version_code) || undefined;
  if ('min_sdk' in body) update.min_sdk = Number(body.min_sdk) || undefined;
  if ('name' in body || 'developer' in body || 'short_description' in body || 'package_name' in body) {
    const merged = { ...old, ...update };
    update.search_terms = searchTerms(
      merged.name,
      merged.developer,
      merged.short_description,
      merged.package_name,
    );
  }

  const versionChanged =
    ('version_name' in update && String(update.version_name ?? '') !== String(old.version_name ?? '')) ||
    ('version_code' in update && Number(update.version_code ?? 0) !== Number(old.version_code ?? 0));

  await ref.update(update as any);
  invalidateAppsCache();

  if (versionChanged) {
    try {
      const merged = { ...old, ...update };
      await addNotification(db, {
        type: 'update',
        title: merged.name,
        body: `إصدار جديد ${merged.version_name || ''}`.trim(),
        app_slug: merged.slug,
        created_at: nowSec(),
      }, c.env);
    } catch {}
  }
  return c.json({ ok: true });
});

app.post('/admin/apps/:id/apk', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const newKey = String(body.apk_key || '');
  if (!newKey) return c.json({ error: 'apk_key_required' }, 400);
  if (!isValidR2Key(newKey, 'apk')) return c.json({ error: 'invalid_apk_key' }, 400);
  const head = await r2Head(c.env, newKey);
  if (!head) return c.json({ error: 'apk_not_found' }, 400);

  const db = await firestore(c.env);
  const ref = db.collection('apps').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return c.json({ error: 'not_found' }, 404);
  const old = snap.data() as App;

  await ref.update({
    apk_key: newKey,
    size_bytes: head.size,
    version_name: body.version_name ? String(body.version_name) : old.version_name,
    version_code: body.version_code != null ? Number(body.version_code) : old.version_code,
    updated_at: nowSec(),
  });
  invalidateAppsCache();

  if (old.apk_key && old.apk_key !== newKey) {
    await r2Delete(c.env, old.apk_key).catch(() => {});
  }

  try {
    const newVersion = body.version_name ? String(body.version_name) : (old.version_name || '');
    await addNotification(db, {
      type: 'update',
      title: old.name,
      body: `إصدار جديد ${newVersion}`.trim(),
      app_slug: old.slug,
      created_at: nowSec(),
    }, c.env);
  } catch {}

  return c.json({ ok: true });
});

app.post('/admin/apps/:id/icon', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const newKey = String(body.icon_key || '');
  if (!newKey) return c.json({ error: 'icon_key_required' }, 400);
  if (!isValidR2Key(newKey, 'icon')) return c.json({ error: 'invalid_icon_key' }, 400);

  const db = await firestore(c.env);
  const ref = db.collection('apps').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return c.json({ error: 'not_found' }, 404);
  const old = snap.data() as App;

  await ref.update({ icon_key: newKey, updated_at: nowSec() });
  invalidateAppsCache();

  if (old.icon_key && old.icon_key !== newKey) {
    await r2Delete(c.env, old.icon_key).catch(() => {});
  }
  return c.json({ ok: true });
});

app.post('/admin/apps/:id/feature', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const newKey = String(body.feature_key || '');
  if (!newKey) return c.json({ error: 'feature_key_required' }, 400);
  if (!isValidR2Key(newKey, 'feature')) return c.json({ error: 'invalid_feature_key' }, 400);

  const db = await firestore(c.env);
  const ref = db.collection('apps').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return c.json({ error: 'not_found' }, 404);
  const old = snap.data() as App;

  await ref.update({ feature_key: newKey, updated_at: nowSec() });
  invalidateAppsCache();

  if (old.feature_key && old.feature_key !== newKey) {
    await r2Delete(c.env, old.feature_key).catch(() => {});
  }
  return c.json({ ok: true });
});

app.post('/admin/apps/:id/screenshots', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const keys: string[] = Array.isArray(body.screenshot_keys) ? body.screenshot_keys.slice(0, 20) : [];
  if (keys.length === 0) return c.json({ error: 'no_screenshots' }, 400);

  const db = await firestore(c.env);
  const ref = db.collection('apps').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return c.json({ error: 'not_found' }, 404);

  const existing = await ref.collection('screenshots').get();
  let pos = existing.size;
  const now = nowSec();
  for (const k of keys) {
    if (!k || !isValidR2Key(String(k), 'ss')) continue;
    await ref.collection('screenshots').add({
      app_id: id,
      r2_key: String(k),
      position: pos++,
      created_at: now,
    });
  }
  await ref.update({ updated_at: now });
  return c.json({ ok: true, added: keys.length });
});

app.delete('/admin/apps/:id/screenshots/:sid', async (c) => {
  const id = c.req.param('id');
  const sid = c.req.param('sid');
  const db = await firestore(c.env);
  const ssRef = db.collection('apps').doc(id).collection('screenshots').doc(sid);
  const snap = await ssRef.get();
  if (!snap.exists) return c.json({ error: 'not_found' }, 404);
  const ss = snap.data() as Screenshot;
  await ssRef.delete();
  if (ss.r2_key) await r2Delete(c.env, ss.r2_key).catch(() => {});
  return c.json({ ok: true });
});

app.delete('/admin/apps/:id', async (c) => {
  const id = c.req.param('id');
  const db = await firestore(c.env);
  const ref = db.collection('apps').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return c.json({ error: 'not_found' }, 404);
  const a = snap.data() as App;

  const ssSnap = await ref.collection('screenshots').get();
  for (const s of ssSnap.docs) {
    const sd = s.data() as Screenshot;
    if (sd.r2_key) await r2Delete(c.env, sd.r2_key).catch(() => {});
    await s.ref.delete();
  }
  if (a.apk_key) await r2Delete(c.env, a.apk_key).catch(() => {});
  if (a.icon_key) await r2Delete(c.env, a.icon_key).catch(() => {});
  if (a.feature_key) await r2Delete(c.env, a.feature_key).catch(() => {});
  await ref.delete();
  invalidateAppsCache();
  return c.json({ ok: true });
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error('[api error]', err);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
