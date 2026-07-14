import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie } from 'hono/cookie';
import { getRequestListener } from '@hono/node-server';
import crypto from 'node:crypto';
import { firestore, getFieldValue, verifyFirebaseToken, messaging } from '../lib/firebase.js';
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
} from '../lib/r2.js';
import {
  COOKIE_NAME,
  constantTimeEqual,
  signJwt,
  verifyJwt,
} from '../lib/auth.js';
import { nowSec, randomId, safeExt, searchTerms, slugify, sanitizeText, sanitizeUrl, safeInt } from '../lib/utils.js';
import { DEFAULT_CATEGORIES, APP_CATEGORIES, GAME_CATEGORIES, type App, type Category, type Screenshot } from '../lib/types.js';

export const config = { runtime: 'nodejs' };

const app = new Hono().basePath('/api');

// --- Security: restrict CORS to same origin only ---
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return '';
    if (ALLOWED_ORIGINS.length > 0 && ALLOWED_ORIGINS.includes(origin)) return origin;
    // Allow same-origin requests from the Vercel deployment
    if (origin.endsWith('.vercel.app') || origin === 'https://goldenstore.me' || origin === 'https://www.goldenstore.me') return origin;
    return '';
  },
  credentials: true,
}));

// --- Security: rate limiter (in-memory, per IP) ---
const rateLimits = new Map<string, { count: number; reset: number }>();
function rateLimit(ip: string, key: string, maxRequests: number, windowSec: number): boolean {
  const k = `${key}:${ip}`;
  const now = Date.now();
  const entry = rateLimits.get(k);
  if (!entry || now > entry.reset) {
    rateLimits.set(k, { count: 1, reset: now + windowSec * 1000 });
    return true;
  }
  entry.count++;
  if (entry.count > maxRequests) return false;
  return true;
}
// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimits) {
    if (now > v.reset) rateLimits.delete(k);
  }
}, 5 * 60 * 1000);

function getClientIp(c: any): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') || 'unknown';
}

// --- Security: add security headers to all responses ---
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  c.header('Cache-Control', 'no-store');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
});

// --- Security: body size limit (1MB) ---
const MAX_BODY_SIZE = 1024 * 1024;
app.use('*', async (c, next) => {
  const cl = c.req.header('content-length');
  if (cl && Number(cl) > MAX_BODY_SIZE) {
    return c.json({ error: 'payload_too_large' }, 413);
  }
  await next();
});

// --- Security: validate slug/id params (no path traversal, max length) ---
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

// ---------------- helpers ----------------

async function requireAdmin(c: any, next: any) {
  const token = getCookie(c, COOKIE_NAME);
  const secret = process.env.JWT_SECRET || '';
  if (!token || !secret) return c.json({ error: 'unauthorized' }, 401);
  const payload = verifyJwt(token, secret);
  if (!payload || payload.role !== 'admin') return c.json({ error: 'unauthorized' }, 401);
  c.set('user', { sub: String(payload.sub) });
  await next();
}

async function ensureUniqueSlug(base: string): Promise<string> {
  let slug = base;
  let i = 1;
  while (true) {
    const db = await firestore();
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

// Public URL for the wide feature graphic (same R2 public bucket as icons).
function feature_url(feature_key?: string): string | null {
  if (!feature_key) return null;
  try {
    return r2PublicUrl(feature_key);
  } catch {
    return null;
  }
}

function icon_url(icon_key?: string): string | null {
  if (!icon_key) return null;
  try {
    return r2PublicUrl(icon_key);
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

// Public URL of the store logo, shown as the notification large icon for
// announcements (and as a fallback for app-specific notifications).
const STORE_LOGO_URL =
  process.env.STORE_LOGO_URL || 'https://goldenstore.vercel.app/images/logo.png';

// Resolve the real app icon URL for a notification tied to an app, so the
// pushed notification shows the actual app's logo instead of a generic icon.
async function resolveNotificationImage(db: any, app_slug: string): Promise<string> {
  if (!app_slug) return '';
  try {
    const snap = await db.collection('apps').where('slug', '==', app_slug).limit(1).get();
    if (snap.empty) return '';
    const url = icon_url((snap.docs[0].data() as any).icon_key);
    return url || '';
  } catch {
    return '';
  }
}

async function addNotification(db: any, data: any) {
  const title = sanitizeText(data.title, 200);
  if (!title) throw new Error('notification_title_required');
  const body = sanitizeText(data.body, 1000);
  const type = data.type === 'new_app' || data.type === 'update' ? data.type : 'announcement';
  const app_slug = sanitizeText(data.app_slug, 120);
  const created_at = Number(data.created_at || nowSec());
  const ref = await db.collection('notifications').add({
    title,
    body,
    type,
    app_slug: app_slug || '',
    created_at,
  });
  // Push to all registered (logged-in) devices. This MUST be awaited: on
  // serverless (Vercel) the function is frozen/killed once the response is
  // returned, so a fire-and-forget push would be cut off before it reaches
  // FCM and notifications would never arrive on closed devices.
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
    });
  } catch (err: any) {
    console.error('[fcm] push failed:', err?.message || err);
    push.errors.push('exception: ' + (err?.message || String(err)));
  }
  return { ref, push };
}

// Send an FCM push to every registered device token. Only logged-in users
// register tokens (see /notifications/register-token), so this targets
// registered users only. Invalid/expired tokens are pruned from Firestore.
type PushResult = { targeted: number; success: number; failure: number; errors: string[] };

async function sendPushToRegistered(
  db: any,
  n: { title: string; body: string; type: string; app_slug: string; id: string; image?: string },
): Promise<PushResult> {
  const result: PushResult = { targeted: 0, success: 0, failure: 0, errors: [] };
  let tokensSnap: any;
  try {
    tokensSnap = await db.collection('fcm_tokens').get();
  } catch (err: any) {
    console.error('[fcm] failed to read tokens:', err?.message || err);
    result.errors.push('read_tokens_failed: ' + (err?.message || String(err)));
    return result;
  }
  const docs: any[] = tokensSnap.docs || [];
  const tokens: string[] = docs
    .map((d: any) => String(d.data()?.token || ''))
    .filter((t: string) => t.length > 0);
  result.targeted = tokens.length;
  if (tokens.length === 0) return result;

  const msg = await messaging();
  // Data-only payload: the Android client builds the notification natively in
  // GoldenFirebaseMessagingService so it can show the real store/app logo as
  // the large icon and a per-type label ("تطبيق جديد" / "تحديث" / "إشعار") in
  // every app state (foreground, background, killed). Sending a `notification`
  // block would make the system draw a plain notification (no large icon /
  // custom styling) whenever the app is in the background.
  const dataPayload: Record<string, string> = {
    title: n.title,
    body: n.body || '',
    type: n.type,
    app_slug: n.app_slug || '',
    notification_id: n.id,
    image: n.image || '',
    store_logo: STORE_LOGO_URL,
  };
  // Send in batches of 500 (FCM multicast limit).
  const invalidTokens: string[] = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    let resp: any;
    try {
      resp = await msg.sendEachForMulticast({
        tokens: batch,
        data: dataPayload,
        android: {
          priority: 'high',
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
  // Prune dead tokens.
  for (const t of invalidTokens) {
    const dead = docs.find((d: any) => String(d.data()?.token || '') === t);
    if (dead) await dead.ref.delete().catch(() => {});
  }
  return result;
}

// ---------------- public ----------------

app.get('/store', (c) => {
  return c.json({
    name: process.env.STORE_NAME || 'Goldenstore',
    domain: process.env.STORE_DOMAIN || 'goldenstore.me',
  });
});

app.get('/notifications', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') || '30') || 30, 50);
  const db = await firestore();
  const notifications = await listNotifications(db, limit);
  return c.json({ notifications });
});

// Register an FCM device token for the logged-in user. Only authenticated
// users can register, so pushes are delivered to registered users only.
app.post('/notifications/register-token', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'reg-token', 30, 60)) return c.json({ error: 'rate_limited' }, 429);
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({} as any));
  const token = String(body.token || '').trim();
  if (!token || token.length > 4096) return c.json({ error: 'invalid_token' }, 400);
  const db = await firestore();
  const docId = crypto.createHash('sha256').update(token).digest('hex');
  await db.collection('fcm_tokens').doc(docId).set({
    token,
    uid: user.uid,
    platform: String(body.platform || 'android').slice(0, 20),
    updated_at: nowSec(),
  });
  return c.json({ ok: true });
});

// Remove an FCM device token (e.g. on logout).
app.post('/notifications/unregister-token', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const token = String(body.token || '').trim();
  if (!token) return c.json({ error: 'invalid_token' }, 400);
  const db = await firestore();
  const docId = crypto.createHash('sha256').update(token).digest('hex');
  await db.collection('fcm_tokens').doc(docId).delete().catch(() => {});
  return c.json({ ok: true });
});

// ---------------- i18n machine translation (free MT + Firestore cache) ----------------
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

  const db = await firestore().catch(() => null);
  const out: (string | null)[] = new Array(q.length).fill(null);
  const toFetch: { i: number; text: string; id: string }[] = [];

  for (let i = 0; i < q.length; i++) {
    const text = q[i];
    if (!text || text.length > 5000) { out[i] = text; continue; }
    const id = crypto.createHash('sha1').update(target + '::' + text).digest('hex');
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
  return c.json({ t: out });
});

app.get('/categories', async (c) => {
  // type=app → app categories only, type=game → game categories only,
  // anything else → the combined list (legacy compatibility).
  const type = (c.req.query('type') || '').trim();
  const db = await firestore();
  const snap = await db.collection('apps').select('category').get();
  const counts: Record<string, number> = {};
  snap.forEach((d: any) => {
    const cat = (d.data() as any).category || 'other';
    counts[cat] = (counts[cat] || 0) + 1;
  });
  const source = type === 'app' ? APP_CATEGORIES
    : type === 'game' ? GAME_CATEGORIES
    : DEFAULT_CATEGORIES;
  const categories: Category[] = source.map((c) => ({ ...c, count: counts[c.slug] || 0 }));
  return c.json({ categories });
});

app.get('/apps', async (c) => {
  const q = (c.req.query('q') || '').trim().toLowerCase();
  const category = (c.req.query('category') || '').trim();
  const type = (c.req.query('type') || '').trim();
  const sort = (c.req.query('sort') || 'recent').trim();
  const starredOnly = c.req.query('starred') === '1';
  const limit = Math.min(Number(c.req.query('limit') || '24') || 24, 60);
  const offset = Math.max(Number(c.req.query('offset') || '0') || 0, 0);

  // type=game → only games. type=app → everything that isn't a game, including
  // legacy docs created before the app/game split that have no `type` field
  // (so the apps view never goes empty before the one-time backfill runs).
  const gameOnly = type === 'game';
  const excludeGames = type === 'app';

  const db = await firestore();

  const sortDocs = (docs: any[]) => {
    if (sort === 'popular') docs.sort((a: any, b: any) =>
      ((b.data().downloads || 0) - (a.data().downloads || 0)) || (ratingAverage(b.data()) - ratingAverage(a.data())));
    else if (sort === 'stars' || sort === 'rating') docs.sort((a: any, b: any) =>
      (ratingAverage(b.data()) - ratingAverage(a.data())) || ((b.data().rating_count || 0) - (a.data().rating_count || 0)));
    else if (sort === 'name') docs.sort((a: any, b: any) => (a.data().name_lower || '').localeCompare(b.data().name_lower || ''));
    else docs.sort((a: any, b: any) => (b.data().created_at || 0) - (a.data().created_at || 0));
    return docs;
  };

  // "Apps" view excludes games in-memory (can't express "type != game OR missing"
  // as an efficient Firestore filter), so always take the fetch-all path here.
  if (excludeGames) {
    let base: any = db.collection('apps');
    if (category) base = base.where('category', '==', category);
    if (starredOnly) base = base.where('stars', '>', 0);
    if (q) {
      const token = q.split(/\s+/).filter((w) => w.length >= 2)[0];
      if (token) base = base.where('search_terms', 'array-contains', token);
    }
    const allSnap = await base.get();
    let docs = sortDocs(allSnap.docs.filter((d: any) => d.data().type !== 'game'));
    const total = docs.length;
    docs = docs.slice(offset, offset + limit);
    const apps = docs.map((d: any) => {
      const a = appPublic(d);
      return { ...a, icon_url: icon_url((d.data() as App).icon_key), feature_url: feature_url((d.data() as App).feature_key) };
    });
    return c.json({ apps, total });
  }

  let query: any = db.collection('apps');
  if (category) query = query.where('category', '==', category);
  if (gameOnly) query = query.where('type', '==', 'game');
  if (starredOnly) query = query.where('stars', '>', 0);
  if (q) {
    const token = q.split(/\s+/).filter((w) => w.length >= 2)[0];
    if (token) query = query.where('search_terms', 'array-contains', token);
  }

  if (sort === 'popular') query = query.orderBy('downloads', 'desc');
  else if (sort === 'stars' || sort === 'rating') query = query.orderBy('rating', 'desc');
  else if (sort === 'name') query = query.orderBy('name_lower', 'asc');
  else query = query.orderBy('created_at', 'desc');

  let total: number;
  let snap: any;
  try {
    total = (await query.count().get()).data().count;
    snap = await query.limit(limit).offset(offset).get();
  } catch (err: any) {
    if (err?.code === 9 || err?.code === 3 || /index/i.test(err?.message ?? '')) {
      // Composite index not yet created — fall back to unordered fetch + in-memory sort
      let fallback: any = db.collection('apps');
      if (category) fallback = fallback.where('category', '==', category);
      if (gameOnly) fallback = fallback.where('type', '==', 'game');
      if (starredOnly) fallback = fallback.where('stars', '>', 0);
      if (q) {
        const token = q.split(/\s+/).filter((w) => w.length >= 2)[0];
        if (token) fallback = fallback.where('search_terms', 'array-contains', token);
      }
      const allSnap = await fallback.get();
      let docs = sortDocs(allSnap.docs);
      total = docs.length;
      docs = docs.slice(offset, offset + limit);
      snap = { docs };
    } else {
      throw err;
    }
  }
  const apps = snap.docs.map((d: any) => {
    const a = appPublic(d);
    return { ...a, icon_url: icon_url((d.data() as App).icon_key), feature_url: feature_url((d.data() as App).feature_key) };
  });
  return c.json({ apps, total });
});

app.get('/apps/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = await firestore();
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
    return { id: s.id, position: sd.position, url: icon_url(sd.r2_key) };
  });
  return c.json({
    app: { ...ap, icon_url: icon_url(rawData.icon_key), feature_url: feature_url(rawData.feature_key) },
    screenshots,
  });
});

app.get('/apps/:slug/download', async (c) => {
  const ip = getClientIp(c);
  const slug = c.req.param('slug');
  if (!rateLimit(ip, 'download', 30, 60)) {
    return c.json({ error: 'rate_limit_exceeded' }, 429);
  }
  const db = await firestore();
  const snap = await db.collection('apps').where('slug', '==', slug).limit(1).get();
  if (snap.empty) return c.json({ error: 'not_found' }, 404);
  const doc = snap.docs[0];
  const a = doc.data() as App;
  if (!a.apk_key) return c.json({ error: 'apk_not_available' }, 404);

  // Rate-limit download counter: max 1 increment per IP per app per 10 min
  if (rateLimit(ip, `dl-count:${slug}`, 1, 600)) {
    const FV = await getFieldValue();
    await doc.ref.update({ downloads: FV.increment(1) });
  }

  const filename = `${a.slug || 'app'}-${a.version_name || ''}.apk`.replace(/-+/g, '-');
  const disposition = `attachment; filename="${filename}"`;
  const url = await r2PresignGet(a.apk_key, 300, disposition);

  // Same-origin streaming mode: proxy the bytes through this function so the
  // browser can read a real Content-Length and report genuine download progress.
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

// ---------------- star / vote ----------------

function serverFingerprint(c: any): string {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown';
  const ua = c.req.header('user-agent') || '';
  const lang = c.req.header('accept-language') || '';
  return `${ip}||${ua}||${lang}`;
}

function computeVoteHash(clientFp: string, serverFp: string): string {
  return crypto
    .createHash('sha256')
    .update(`${clientFp}::${serverFp}`)
    .digest('hex');
}

app.post('/apps/:slug/star', async (c) => {
  const ip = getClientIp(c);
  // Rate limit: max 10 star attempts per IP per minute (anti-spam burst guard)
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

  const db = await firestore();
  const snap = await db.collection('apps').where('slug', '==', slug).limit(1).get();
  if (snap.empty) return c.json({ error: 'not_found' }, 404);
  const doc = snap.docs[0];

  const sFp = serverFingerprint(c);
  const voteHash = computeVoteHash(clientFp, sFp);
  // Also store a server-only hash to prevent same IP+UA from voting with different client FPs
  const serverOnlyHash = crypto.createHash('sha256').update(sFp).digest('hex');

  // Check for duplicate votes before writing.
  const votesRef = doc.ref.collection('star_votes');
  if (uid) {
    // Signed-in users: exactly one rating/review per account.
    const existingByUid = await votesRef.where('uid', '==', uid).limit(1).get();
    if (!existingByUid.empty) {
      return c.json({ error: 'already_voted', rating: ratingAverage(doc.data()), rating_count: Number((doc.data() as any).rating_count || 0) }, 409);
    }
  } else {
    // Anonymous fallback: dedupe by device fingerprint.
    const existingByHash = await votesRef.where('hash', '==', voteHash).limit(1).get();
    if (!existingByHash.empty) {
      return c.json({ error: 'already_voted', rating: ratingAverage(doc.data()), rating_count: Number((doc.data() as any).rating_count || 0) }, 409);
    }
    const existingByServer = await votesRef.where('server_hash', '==', serverOnlyHash).limit(1).get();
    if (!existingByServer.empty) {
      return c.json({ error: 'already_voted', rating: ratingAverage(doc.data()), rating_count: Number((doc.data() as any).rating_count || 0) }, 409);
    }
  }

  // Write the vote and update the running average atomically.
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

  const db = await firestore();
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

  // Signed-in users are matched by account id first.
  if (uid) {
    const existingByUid = await doc.ref.collection('star_votes').where('uid', '==', uid).limit(1).get();
    if (!existingByUid.empty) return mine(existingByUid.docs[0].data());
    return c.json({ voted: false, rating: ratingAvg, rating_count: ratingCount });
  }

  const sFp = serverFingerprint(c);
  const voteHash = computeVoteHash(clientFp, sFp);
  const serverOnlyHash = crypto.createHash('sha256').update(sFp).digest('hex');
  const existingByHash = await doc.ref.collection('star_votes').where('hash', '==', voteHash).limit(1).get();
  if (!existingByHash.empty) return mine(existingByHash.docs[0].data());
  const existingByServer = await doc.ref.collection('star_votes').where('server_hash', '==', serverOnlyHash).limit(1).get();
  if (!existingByServer.empty) return mine(existingByServer.docs[0].data());
  return c.json({ voted: false, my_rating: 0, my_comment: '', my_name: '', my_photo: '', rating: ratingAvg, rating_count: ratingCount });
});

// List reviews (votes that include a written comment) + rating distribution.
app.get('/apps/:slug/reviews', async (c) => {
  const slug = c.req.param('slug');
  const limit = Math.min(Number(c.req.query('limit') || '50') || 50, 100);
  const db = await firestore();
  const snap = await db.collection('apps').where('slug', '==', slug).limit(1).get();
  if (snap.empty) return c.json({ error: 'not_found' }, 404);
  const doc = snap.docs[0];

  const votesSnap = await doc.ref.collection('star_votes').get();
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

  return c.json({
    reviews: reviews.slice(0, limit),
    total: reviews.length,
    dist,
    rating: ratingAverage(doc.data()),
    rating_count: Number((doc.data() as any).rating_count || 0),
  });
});

// ---------------- update requests & reports (sent to admin) ----------------

// User asks for a newer version to be uploaded.
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

  const db = await firestore();
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

// User reports a problem (virus, broken, etc.).
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

  const db = await firestore();
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

// ---------------- auth ----------------

function isSecureRequest(c: any): boolean {
  // Trust Vercel/CDN forwarded headers; fall back to URL scheme.
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
  // Rate limit: max 5 login attempts per IP per 5 minutes
  if (!rateLimit(ip, 'login', 5, 300)) {
    return c.json({ error: 'rate_limit_exceeded' }, 429);
  }

  const body = await c.req.json().catch(() => ({} as any));
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const username = String(body.username ?? adminUser);
  const password = String(body.password ?? '');
  const adminPass = process.env.ADMIN_PASSWORD || '';
  const secret = process.env.JWT_SECRET || '';
  if (!adminPass || !secret) return c.json({ error: 'server_not_configured' }, 500);

  const userOk = constantTimeEqual(username, adminUser);
  const passOk = !!password && constantTimeEqual(password, adminPass);
  if (!userOk || !passOk) {
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
    return c.json({ error: 'invalid_credentials' }, 401);
  }

  const token = signJwt({ sub: adminUser, role: 'admin' }, secret);
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

app.get('/me', (c) => {
  const token = getCookie(c, COOKIE_NAME);
  const secret = process.env.JWT_SECRET || '';
  if (!token || !secret) return c.json({ authenticated: false });
  const payload = verifyJwt(token, secret);
  if (!payload) return c.json({ authenticated: false });
  return c.json({ authenticated: true, user: { username: payload.sub, role: payload.role } });
});

// ---------------- admin ----------------

app.use('/admin/*', requireAdmin);

app.get('/admin/stats', async (c) => {
  const db = await firestore();
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
      icon_url: icon_url(a.icon_key),
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
  const db = await firestore();
  const snap = await db.collection('apps').orderBy('created_at', 'desc').get();
  const apps = snap.docs.map((d: any) => {
    const a = appPublic(d, true);
    return { ...a, icon_url: icon_url(a.icon_key), feature_url: feature_url((a as any).feature_key) };
  });
  return c.json({ apps });
});

// One-time backfill: legacy docs created before the app/game split have no
// `type` field, so type-filtered queries skip them. Set them all to 'app'.
app.post('/admin/migrate-types', async (c) => {
  const db = await firestore();
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
  return c.json({ ok: true, updated, total: snap.size });
});

// List update-requests / reports submitted by users.
app.get('/admin/requests', async (c) => {
  const db = await firestore();
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
  const db = await firestore();
  const notifications = await listNotifications(db);
  return c.json({ notifications });
});

app.post('/admin/notifications', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const db = await firestore();
  const title = sanitizeText(body.title, 200);
  const text = sanitizeText(body.body, 1000);
  if (!title) return c.json({ error: 'title_required' }, 400);
  const { ref, push } = await addNotification(db, {
    title,
    body: text,
    type: 'announcement',
    created_at: nowSec(),
  });
  // `push` reports how many devices were targeted / succeeded so the dashboard
  // can tell whether the notification actually went out over FCM.
  return c.json({ ok: true, id: ref.id, push });
});

// Diagnostics: how many device tokens are registered right now.
app.get('/admin/push/status', async (c) => {
  const db = await firestore();
  let count = 0;
  const platforms: Record<string, number> = {};
  try {
    const snap = await db.collection('fcm_tokens').get();
    count = snap.size;
    snap.forEach((d: any) => {
      const p = String(d.data()?.platform || 'unknown');
      platforms[p] = (platforms[p] || 0) + 1;
    });
  } catch (err: any) {
    return c.json({ error: 'read_failed', message: err?.message || String(err) }, 500);
  }
  return c.json({ registered_tokens: count, platforms });
});

// Diagnostics: send a test push right now and return the detailed FCM result
// (targeted / success / failure / error codes) without saving a notification.
app.post('/admin/push/test', async (c) => {
  const db = await firestore();
  const body = await c.req.json().catch(() => ({} as any));
  const title = sanitizeText(body.title, 200) || 'اختبار الإشعارات';
  const text = sanitizeText(body.body, 1000) || 'هذا إشعار تجريبي من لوحة التحكم';
  let push: PushResult = { targeted: 0, success: 0, failure: 0, errors: [] };
  try {
    push = await sendPushToRegistered(db, { title, body: text, type: 'announcement', app_slug: '', id: 'test-' + nowSec() });
  } catch (err: any) {
    return c.json({ ok: false, error: 'send_failed', message: err?.message || String(err) }, 500);
  }
  return c.json({ ok: true, push });
});

app.delete('/admin/notifications/:id', async (c) => {
  const id = c.req.param('id');
  const db = await firestore();
  await db.collection('notifications').doc(id).delete().catch(() => {});
  return c.json({ ok: true });
});

// Delete (dismiss/resolve) a request.
app.delete('/admin/requests/:id', async (c) => {
  const id = c.req.param('id');
  const db = await firestore();
  await db.collection('app_requests').doc(id).delete().catch(() => {});
  return c.json({ ok: true });
});

app.get('/admin/apps/:id', async (c) => {
  const id = c.req.param('id');
  const db = await firestore();
  const doc = await db.collection('apps').doc(id).get();
  if (!doc.exists) return c.json({ error: 'not_found' }, 404);
  const a = appPublic(doc, true);
  const ssSnap = await doc.ref.collection('screenshots').orderBy('position', 'asc').get();
  const screenshots = ssSnap.docs.map((s: any) => {
    const sd = s.data() as Screenshot;
    return { id: s.id, position: sd.position, r2_key: sd.r2_key, url: icon_url(sd.r2_key) };
  });
  return c.json({ app: { ...a, icon_url: icon_url(a.icon_key), feature_url: feature_url((a as any).feature_key) }, screenshots });
});

// Step 1: client requests a presigned upload URL for R2
app.post('/admin/upload-url', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const kind = String(body.kind || ''); // 'apk' | 'icon' | 'screenshot'
  const filename = String(body.filename || '');
  const contentType = String(body.content_type || 'application/octet-stream');
  const slugHint = slugify(String(body.slug_hint || 'app'));

  // Validate content-type to prevent serving malicious HTML/JS from R2
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
  const url = await r2PresignPut(key, contentType, 3600);
  return c.json({ url, key });
});

// --- Multipart upload for large files (>10 MB) ---

// Initiate a multipart upload and return presigned URLs for all parts
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

  const uploadId = await r2CreateMultipartUpload(key, contentType);

  const PART_SIZE = 10 * 1024 * 1024; // 10 MB per part
  const partCount = Math.ceil(fileSize / PART_SIZE);
  const parts: { partNumber: number; url: string }[] = [];
  for (let i = 1; i <= partCount; i++) {
    const url = await r2PresignUploadPart(key, uploadId, i, 3600);
    parts.push({ partNumber: i, url });
  }

  return c.json({ key, uploadId, partSize: PART_SIZE, parts });
});

// Complete a multipart upload after all parts have been uploaded
app.post('/admin/multipart/complete', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const key = String(body.key || '');
  const uploadId = String(body.uploadId || '');
  const parts: { PartNumber: number; ETag: string }[] = Array.isArray(body.parts) ? body.parts : [];

  if (!key || !uploadId || parts.length === 0) {
    return c.json({ error: 'missing_fields' }, 400);
  }

  await r2CompleteMultipartUpload(key, uploadId, parts);
  return c.json({ ok: true, key });
});

// Abort a multipart upload (cleanup on failure)
app.post('/admin/multipart/abort', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const key = String(body.key || '');
  const uploadId = String(body.uploadId || '');
  if (key && uploadId) {
    await r2AbortMultipartUpload(key, uploadId);
  }
  return c.json({ ok: true });
});

// Validate that R2 keys match expected folder prefixes (prevent path traversal)
function isValidR2Key(key: string, expectedPrefix: string): boolean {
  if (!key || key.includes('..') || key.startsWith('/')) return false;
  return key.startsWith(`${expectedPrefix}/`);
}

// Step 2: after R2 upload, client posts metadata to create the app
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

  // Verify the file exists in R2 to get size
  const head = await r2Head(apk_key);
  if (!head) return c.json({ error: 'apk_not_found_in_r2' }, 400);

  const base = slugify(name);
  const slug = await ensureUniqueSlug(base);
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

  const db = await firestore();
  const ref = await db.collection('apps').add(docData);

  try {
    await addNotification(db, {
      type: 'new_app',
      title: name,
      body: '',
      app_slug: slug,
      created_at: now,
    });
  } catch {}

  // Add screenshots if provided
  const screenshotKeys: string[] = Array.isArray(body.screenshot_keys) ? body.screenshot_keys.slice(0, 20) : [];
  for (let i = 0; i < screenshotKeys.length; i++) {
    const r2_key = String(screenshotKeys[i]);
    if (!r2_key || !isValidR2Key(r2_key, 'ss')) continue;
    await ref.collection('screenshots').add({
      app_id: ref.id,
      r2_key,
      position: i,
      created_at: now,
    } as Screenshot);
  }

  return c.json({ ok: true, id: ref.id, slug });
});

app.patch('/admin/apps/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const db = await firestore();
  const ref = db.collection('apps').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return c.json({ error: 'not_found' }, 404);
  const old = snap.data() as App;
  // Input length limits
  if (('name' in body && String(body.name).length > 200) ||
      ('package_name' in body && String(body.package_name).length > 200) ||
      ('description' in body && String(body.description).length > 10000) ||
      ('short_description' in body && String(body.short_description).length > 500)) {
    return c.json({ error: 'input_too_long' }, 400);
  }
  // Prevent admin from tampering with stars/downloads via PATCH
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
  // Recompute search terms if relevant fields changed
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
  if (versionChanged) {
    try {
      const merged = { ...old, ...update };
      await addNotification(db, {
        type: 'update',
        title: merged.name,
        body: `إصدار جديد ${merged.version_name || ''}`.trim(),
        app_slug: merged.slug,
        created_at: nowSec(),
      });
    } catch {}
  }
  return c.json({ ok: true });
});

// Replace APK
app.post('/admin/apps/:id/apk', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const newKey = String(body.apk_key || '');
  if (!newKey) return c.json({ error: 'apk_key_required' }, 400);
  if (!isValidR2Key(newKey, 'apk')) return c.json({ error: 'invalid_apk_key' }, 400);
  const head = await r2Head(newKey);
  if (!head) return c.json({ error: 'apk_not_found' }, 400);

  const db = await firestore();
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

  if (old.apk_key && old.apk_key !== newKey) {
    await r2Delete(old.apk_key).catch(() => {});
  }

  // Replacing the APK is an update — notify users (store + FCM push).
  try {
    const newVersion = body.version_name ? String(body.version_name) : (old.version_name || '');
    await addNotification(db, {
      type: 'update',
      title: old.name,
      body: `إصدار جديد ${newVersion}`.trim(),
      app_slug: old.slug,
      created_at: nowSec(),
    });
  } catch {}

  return c.json({ ok: true });
});

// Replace icon
app.post('/admin/apps/:id/icon', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const newKey = String(body.icon_key || '');
  if (!newKey) return c.json({ error: 'icon_key_required' }, 400);
  if (!isValidR2Key(newKey, 'icon')) return c.json({ error: 'invalid_icon_key' }, 400);

  const db = await firestore();
  const ref = db.collection('apps').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return c.json({ error: 'not_found' }, 404);
  const old = snap.data() as App;

  await ref.update({ icon_key: newKey, updated_at: nowSec() });

  if (old.icon_key && old.icon_key !== newKey) {
    await r2Delete(old.icon_key).catch(() => {});
  }
  return c.json({ ok: true });
});

// Replace / set the wide feature graphic
app.post('/admin/apps/:id/feature', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const newKey = String(body.feature_key || '');
  if (!newKey) return c.json({ error: 'feature_key_required' }, 400);
  if (!isValidR2Key(newKey, 'feature')) return c.json({ error: 'invalid_feature_key' }, 400);

  const db = await firestore();
  const ref = db.collection('apps').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return c.json({ error: 'not_found' }, 404);
  const old = snap.data() as App;

  await ref.update({ feature_key: newKey, updated_at: nowSec() });

  if (old.feature_key && old.feature_key !== newKey) {
    await r2Delete(old.feature_key).catch(() => {});
  }
  return c.json({ ok: true });
});

// Add screenshots
app.post('/admin/apps/:id/screenshots', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const keys: string[] = Array.isArray(body.screenshot_keys) ? body.screenshot_keys.slice(0, 20) : [];
  if (keys.length === 0) return c.json({ error: 'no_screenshots' }, 400);

  const db = await firestore();
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

// Delete screenshot
app.delete('/admin/apps/:id/screenshots/:sid', async (c) => {
  const id = c.req.param('id');
  const sid = c.req.param('sid');
  const db = await firestore();
  const ssRef = db.collection('apps').doc(id).collection('screenshots').doc(sid);
  const snap = await ssRef.get();
  if (!snap.exists) return c.json({ error: 'not_found' }, 404);
  const ss = snap.data() as Screenshot;
  await ssRef.delete();
  if (ss.r2_key) await r2Delete(ss.r2_key).catch(() => {});
  return c.json({ ok: true });
});

// Delete app
app.delete('/admin/apps/:id', async (c) => {
  const id = c.req.param('id');
  const db = await firestore();
  const ref = db.collection('apps').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return c.json({ error: 'not_found' }, 404);
  const a = snap.data() as App;

  // Delete subcollection screenshots
  const ssSnap = await ref.collection('screenshots').get();
  for (const s of ssSnap.docs) {
    const sd = s.data() as Screenshot;
    if (sd.r2_key) await r2Delete(sd.r2_key).catch(() => {});
    await s.ref.delete();
  }
  if (a.apk_key) await r2Delete(a.apk_key).catch(() => {});
  if (a.icon_key) await r2Delete(a.icon_key).catch(() => {});
  if (a.feature_key) await r2Delete(a.feature_key).catch(() => {});
  await ref.delete();
  return c.json({ ok: true });
});

// ---------------- Points system (نقاط التشغيل) ----------------
// Points are earned server-side only. Firebase ID token is verified to prevent
// forgery, and each app can award points to a given user only once. Withdrawals
// require a minimum balance and are logged for manual admin review/payout.

const POINTS_PER_DOWNLOAD = 10;     // points granted per first install of an app
const POINTS_PER_DOLLAR = 1000;     // 1000 points = $1
const MIN_WITHDRAW_USD = 5;          // minimum payout request
const MIN_WITHDRAW_POINTS = MIN_WITHDRAW_USD * POINTS_PER_DOLLAR; // 5000

async function requireFirebaseUser(c: any): Promise<{ uid: string; email?: string; name?: string } | null> {
  const authHeader = c.req.header('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;
  return verifyFirebaseToken(token);
}

function pointsConfig() {
  return {
    points_per_download: POINTS_PER_DOWNLOAD,
    points_per_dollar: POINTS_PER_DOLLAR,
    min_withdraw_usd: MIN_WITHDRAW_USD,
    min_withdraw_points: MIN_WITHDRAW_POINTS,
  };
}

// Get points balance + withdrawal history
app.get('/points/balance', async (c) => {
  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const db = await firestore();
  const doc = await db.collection('user_points').doc(user.uid).get();
  const data = doc.exists ? (doc.data() as any) : {};
  const balance = data.balance || 0;

  // Recent withdrawal requests for this user
  let withdrawals: any[] = [];
  try {
    const wsnap = await db.collection('withdrawals').where('uid', '==', user.uid).get();
    withdrawals = wsnap.docs
      .map((d: any) => ({ id: d.id, amount_usd: d.data().amount_usd, points_spent: d.data().points_spent, method: d.data().method || '', account: d.data().account || '', status: d.data().status || 'pending', ts: d.data().ts || 0 }))
      .sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 50);
  } catch {}

  return c.json({
    balance,
    dollars: Math.round((balance / POINTS_PER_DOLLAR) * 100) / 100,
    total_earned: data.total_earned || 0,
    total_withdrawn_usd: data.withdrawn_amount || 0,
    earned_apps: data.earned_apps || [],
    can_withdraw: balance >= MIN_WITHDRAW_POINTS,
    withdrawals,
    config: pointsConfig(),
  });
});

// Earn points after downloading an app
app.post('/points/earn', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'points-earn', 20, 60)) {
    return c.json({ error: 'rate_limit_exceeded' }, 429);
  }

  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => ({} as any));
  const slug = String(body.slug || '').trim();
  if (!slug || !isValidSlug(slug)) return c.json({ error: 'invalid_slug' }, 400);

  // Verify the app exists and is a real, downloadable app (must have an APK).
  // This blocks farming points off non-existent or non-downloadable slugs.
  const db = await firestore();
  const appSnap = await db.collection('apps').where('slug', '==', slug).limit(1).get();
  if (appSnap.empty) return c.json({ error: 'app_not_found' }, 404);
  if (!(appSnap.docs[0].data() as any).apk_key) return c.json({ error: 'app_not_downloadable' }, 400);

  const pointsRef = db.collection('user_points').doc(user.uid);

  // Use a transaction to prevent race conditions and double-earning
  const result = await db.runTransaction(async (tx: any) => {
    const pointsDoc = await tx.get(pointsRef);
    const data = pointsDoc.exists ? (pointsDoc.data() as any) : {
      balance: 0, total_earned: 0, total_claimed: 0, claimed_amount: 0,
      earned_apps: [], created_at: nowSec(),
    };

    const earnedApps: string[] = data.earned_apps || [];

    // Check if points were already earned for this app
    if (earnedApps.includes(slug)) {
      return { already_earned: true, balance: data.balance || 0 };
    }

    // Award points
    const newBalance = (data.balance || 0) + POINTS_PER_DOWNLOAD;
    const newTotalEarned = (data.total_earned || 0) + POINTS_PER_DOWNLOAD;
    earnedApps.push(slug);

    tx.set(pointsRef, {
      ...data,
      balance: newBalance,
      total_earned: newTotalEarned,
      earned_apps: earnedApps,
      updated_at: nowSec(),
    }, { merge: true });

    return { already_earned: false, balance: newBalance, earned: POINTS_PER_DOWNLOAD };
  });

  if (result.already_earned) {
    return c.json({ ok: false, error: 'already_earned', balance: result.balance });
  }
  return c.json({ ok: true, earned: result.earned, balance: result.balance });
});

// Request a withdrawal (payout). Minimum is MIN_WITHDRAW_USD. Points are
// deducted atomically and a pending request is logged for admin review.
app.post('/points/withdraw', async (c) => {
  const ip = getClientIp(c);
  if (!rateLimit(ip, 'points-withdraw', 5, 300)) {
    return c.json({ error: 'rate_limit_exceeded' }, 429);
  }

  const user = await requireFirebaseUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json().catch(() => ({} as any));
  const method = sanitizeText(body.method, 40);
  const account = sanitizeText(body.account, 200);
  if (!method) return c.json({ error: 'invalid_method' }, 400);
  if (!account || account.length < 3) return c.json({ error: 'invalid_account' }, 400);
  // Optional explicit amount in whole dollars; default = withdraw everything.
  const requestedUsd = body.amount_usd != null ? Math.floor(Number(body.amount_usd)) : null;
  if (requestedUsd != null && (!Number.isFinite(requestedUsd) || requestedUsd <= 0)) {
    return c.json({ error: 'invalid_amount' }, 400);
  }

  const db = await firestore();
  const pointsRef = db.collection('user_points').doc(user.uid);
  const withdrawalRef = db.collection('withdrawals').doc();

  const result = await db.runTransaction(async (tx: any) => {
    const pointsDoc = await tx.get(pointsRef);
    const data = pointsDoc.exists ? (pointsDoc.data() as any) : {};
    const balance = data.balance || 0;

    const maxUsd = Math.floor(balance / POINTS_PER_DOLLAR);
    if (maxUsd < MIN_WITHDRAW_USD) {
      return { error: 'insufficient_points', balance };
    }
    const amountUsd = requestedUsd == null ? maxUsd : requestedUsd;
    if (amountUsd < MIN_WITHDRAW_USD) return { error: 'below_minimum', balance };
    if (amountUsd > maxUsd) return { error: 'insufficient_points', balance };

    const pointsSpent = amountUsd * POINTS_PER_DOLLAR;
    const newBalance = balance - pointsSpent;

    tx.set(pointsRef, {
      ...data,
      balance: newBalance,
      total_withdrawals: (data.total_withdrawals || 0) + 1,
      withdrawn_amount: (data.withdrawn_amount || 0) + amountUsd,
      updated_at: nowSec(),
    }, { merge: true });

    tx.set(withdrawalRef, {
      uid: user.uid,
      email: user.email || '',
      name: user.name || '',
      points_spent: pointsSpent,
      amount_usd: amountUsd,
      method,
      account,
      status: 'pending',
      ts: nowSec(),
    });

    return { ok: true, balance: newBalance, amount_usd: amountUsd, withdrawal_id: withdrawalRef.id };
  });

  if (result.error) {
    return c.json({ error: result.error, balance: result.balance || 0 }, 400);
  }
  return c.json(result);
});

// Admin: view all withdrawal requests
app.get('/admin/points/withdrawals', requireAdmin, async (c) => {
  const db = await firestore();
  let docs: any[];
  try {
    const snap = await db.collection('withdrawals').orderBy('ts', 'desc').limit(200).get();
    docs = snap.docs;
  } catch {
    const snap = await db.collection('withdrawals').get();
    docs = snap.docs.sort((a: any, b: any) => (b.data().ts || 0) - (a.data().ts || 0)).slice(0, 200);
  }
  const withdrawals = docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  return c.json({ withdrawals });
});

// Admin: approve/reject a withdrawal request
app.patch('/admin/points/withdrawals/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const status = String(body.status || '').trim();
  if (!['approved', 'rejected'].includes(status)) return c.json({ error: 'invalid_status' }, 400);

  const db = await firestore();
  const ref = db.collection('withdrawals').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return c.json({ error: 'not_found' }, 404);

  const data = snap.data() as any;

  // If rejecting a still-pending request, refund the spent points.
  if (status === 'rejected' && data.status === 'pending') {
    const pointsRef = db.collection('user_points').doc(data.uid);
    const FV = await getFieldValue();
    await pointsRef.update({
      balance: FV.increment(data.points_spent || 0),
      total_withdrawals: FV.increment(-1),
      withdrawn_amount: FV.increment(-(data.amount_usd || 0)),
    });
  }

  await ref.update({ status, resolved_at: nowSec() });
  return c.json({ ok: true });
});

// 404 fallback
app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  console.error('[api error]', err);
  return c.json({ error: 'internal_error' }, 500);
});

export default getRequestListener(app.fetch);
