/* =========================================================================
   Golden Store — Advanced Push System
   -------------------------------------------------------------------------
   Segmentation, scheduling (Cron), rich image/click payloads, click tracking,
   history and the analytics overview. Cloudflare Workers / D1 / FCM HTTP v1.
   No Node-only dependencies; all Google calls go through fetch().
   ========================================================================= */
import type { Env } from './env.js';
import { nowSec, randomId, sanitizeText } from './utils.js';
import {
  ensurePushSchema, buildPushPayload, pushTokenStats, broadcastPush,
  recordPushLog, deleteDeadTokens, FCM_MAX_DIRECT_PER_SEND,
} from './push.js';
import { sendFcmToEntries, type FcmEntry } from './firebase.js';
import { firebaseUsage, cloudflareUsage, ensureUsageSchema } from './usage.js';

export type SegmentMode = 'all' | 'uid' | 'token' | 'platform' | 'app' | 'active';
export interface Segment {
  mode: SegmentMode;
  uid?: string;
  token?: string;
  platform?: string;        // android | ios | web
  app_slug?: string;
  days?: number;            // for 'active'
}

const ELIGIBLE = `COALESCE(notifications_enabled, 1) = 1
  AND COALESCE(permission, 'granted') != 'denied'`;
const ACTIVE_NATIVE = `COALESCE(NULLIF(last_seen_at, 0), updated_at) >= ?`;
const ACTIVE_WEB = `COALESCE(NULLIF(last_seen_at, 0), updatedAt) >= ?`;

/* -------------------------------------------------------------------------
   Schema
   ------------------------------------------------------------------------- */
const ADVANCED_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS scheduled_pushes (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     body TEXT,
     image_url TEXT,
     click_url TEXT,
     segment_json TEXT NOT NULL,
     scheduled_at INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     created_at INTEGER NOT NULL,
     sent_at INTEGER,
     error TEXT,
     result_json TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS push_clicks (
     id TEXT PRIMARY KEY,
     notification_id TEXT NOT NULL,
     uid TEXT,
     platform TEXT,
     clicked_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS app_subscriptions (
     uid TEXT NOT NULL,
     app_slug TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (uid, app_slug)
   )`,
];
const ADVANCED_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_scheduled_pending ON scheduled_pushes(status, scheduled_at)`,
  `CREATE INDEX IF NOT EXISTS idx_push_clicks_note ON push_clicks(notification_id)`,
  `CREATE INDEX IF NOT EXISTS idx_app_subs_slug ON app_subscriptions(app_slug)`,
  `CREATE INDEX IF NOT EXISTS idx_fcm_last_seen ON fcm_tokens(last_seen_at)`,
];
// CREATE TABLE IF NOT EXISTS cannot add columns; each ALTER is safe to fail.
const ADVANCED_UPGRADES = [
  `ALTER TABLE fcm_tokens ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE web_tokens ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE push_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy'`,
  `ALTER TABLE push_jobs ADD COLUMN tokens TEXT`,
];
const advancedSchemaReady = new WeakSet<object>();

export async function ensureAdvancedSchema(env: Env): Promise<void> {
  // Tables first, upgrades second, indexes LAST (legacy-DB regression).
  await ensurePushSchema(env);
  await ensureUsageSchema(env);
  const db: any = env.DB;
  if (advancedSchemaReady.has(db)) return;
  for (const sql of ADVANCED_SCHEMA) await db.prepare(sql).run();
  for (const sql of ADVANCED_UPGRADES) {
    try { await db.prepare(sql).run(); } catch { /* column already exists */ }
  }
  for (const sql of ADVANCED_INDEXES) {
    try { await db.prepare(sql).run(); }
    catch (error: any) { console.warn('[push] optional index skipped:', error?.message || error); }
  }
  advancedSchemaReady.add(db);
}

/* -------------------------------------------------------------------------
   Safe URLs: allow same-origin relative paths and http(s) absolute URLs only.
   ------------------------------------------------------------------------- */
function safeUrl(raw: unknown): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.charAt(0) === '/' && value.charAt(1) !== '/') return value.slice(0, 2000);
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString().slice(0, 2000);
  } catch { return ''; }
}

/** Rich message: image + click_action travel in `data` for BOTH channels,
    plus Android's native big-picture field. The service worker / mobile app
    read data.image and data.click_url (see ADVANCED_PUSH_PAYLOAD.md). */
export function buildAdvancedPayload(env: Env, n: any) {
  const base = buildPushPayload(env, {
    id: n.id || randomId(), title: n.title, body: n.body,
    type: n.type || 'announcement', app_slug: n.app_slug || '',
    image: n.image_url || n.image || '', data: n.data,
  });
  const image = safeUrl(n.image_url || n.image);
  const click = safeUrl(n.click_url || (n.app_slug ? `/app?slug=${encodeURIComponent(n.app_slug)}` : ''));
  const data: Record<string, string> = { ...base.data };
  if (image) data.image = image;
  if (click) data.click_url = click;
  const android: any = {
    ...base.android,
    notification: { ...(base.android as any).notification },
  };
  if (image) android.notification.image = image;
  return { data, notification: base.notification, android };
}

/* -------------------------------------------------------------------------
   Audience resolution — ALL filters use bound parameters.
   ------------------------------------------------------------------------- */
export async function resolveAudience(env: Env, segment: Segment): Promise<{
  entries: FcmEntry[]; native_count: number; web_count: number; targeted: number;
}> {
  await ensureAdvancedSchema(env);
  const db: any = env.DB;
  const mode: SegmentMode = (['all', 'uid', 'token', 'platform', 'app', 'active'] as SegmentMode[])
    .includes(segment.mode) ? segment.mode : 'all';
  let nWhere = ELIGIBLE, wWhere = ELIGIBLE;
  const nArgs: any[] = [], wArgs: any[] = [];
  const uid = sanitizeText(segment.uid, 128);
  const token = sanitizeText(segment.token, 4096);
  const platform = sanitizeText(segment.platform, 32).toLowerCase();
  const appSlug = sanitizeText(segment.app_slug, 120);
  const days = Math.max(1, Math.min(Number(segment.days) || 7, 90));
  const since = nowSec() - days * 86400;

  if (mode === 'uid') {
    nWhere += ' AND uid = ?'; nArgs.push(uid);
    wWhere += ' AND uid = ?'; wArgs.push(uid);
  } else if (mode === 'token') {
    nWhere += ' AND token = ?'; nArgs.push(token);
    wWhere += ' AND token = ?'; wArgs.push(token);
  } else if (mode === 'platform') {
    if (platform === 'web') {
      nWhere += ' AND 1 = 0';
    } else {
      nWhere += ' AND LOWER(COALESCE(platform, \'android\')) = ?'; nArgs.push(platform || 'android');
      wWhere += ' AND 1 = 0';
    }
  } else if (mode === 'app') {
    const sub = 'uid IN (SELECT uid FROM app_subscriptions WHERE app_slug = ?)';
    nWhere += ` AND ${sub}`; nArgs.push(appSlug);
    wWhere += ` AND ${sub}`; wArgs.push(appSlug);
  } else if (mode === 'active') {
    nWhere += ` AND ${ACTIVE_NATIVE}`; nArgs.push(since);
    wWhere += ` AND ${ACTIVE_WEB}`; wArgs.push(since);
  }

  const native: any = await db.prepare(
    `SELECT token FROM fcm_tokens WHERE ${nWhere} ORDER BY id`,
  ).bind(...nArgs).all().catch(() => ({ results: [] }));
  const web: any = await db.prepare(
    `SELECT token FROM web_tokens WHERE ${wWhere} ORDER BY uid`,
  ).bind(...wArgs).all().catch(() => ({ results: [] }));

  const seen = new Set<string>();
  const entries: FcmEntry[] = [];
  for (const r of (native.results || []) as any[]) {
    const t = String(r.token || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t); entries.push({ token: t, channel: 'native' });
  }
  for (const r of (web.results || []) as any[]) {
    const t = String(r.token || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t); entries.push({ token: t, channel: 'web' });
  }
  return { entries, native_count: (native.results || []).length,
    web_count: (web.results || []).length, targeted: entries.length };
}

/* -------------------------------------------------------------------------
   Segmented delivery + queue
   ------------------------------------------------------------------------- */
export async function processAdvancedJob(env: Env, jobId: string, limit = FCM_MAX_DIRECT_PER_SEND): Promise<any> {
  await ensureAdvancedSchema(env);
  const db: any = env.DB;
  const job: any = await db.prepare('SELECT * FROM push_jobs WHERE id = ?').bind(jobId).first();
  if (!job || String(job.kind) !== 'advanced') {
    return { processed: 0, success: 0, failure: 0, invalid_removed: 0, pending: 0, done: true, errors: ['job_not_found'] };
  }
  const entries: FcmEntry[] = JSON.parse(String(job.tokens || '[]'));
  const payload = JSON.parse(String(job.payload));
  const cap = Math.max(1, Math.min(Number(limit) || FCM_MAX_DIRECT_PER_SEND, FCM_MAX_DIRECT_PER_SEND));
  const offset = Number(job.cursor || 0);
  const slice = entries.slice(offset, offset + cap);
  const sent = await sendFcmToEntries(env, slice, payload);
  const invalidRemoved = sent.invalid.length ? await deleteDeadTokens(env, sent.invalid) : 0;
  const next = offset + slice.length;
  const pending = Math.max(0, entries.length - next);
  await db.prepare('UPDATE push_jobs SET cursor = ?, done = ?, updated_at = ? WHERE id = ?')
    .bind(String(next), pending > 0 ? 0 : 1, nowSec(), jobId).run();
  return {
    processed: slice.length, success: sent.success, failure: sent.failure,
    invalid_removed: invalidRemoved, errors: sent.errors, error_counts: sent.error_counts,
    pending, done: pending === 0,
  };
}

export async function sendAdvancedPush(env: Env, note: any, segment: Segment): Promise<any> {
  const started = Date.now();
  await ensureAdvancedSchema(env);
  const db: any = env.DB;
  const id = String(note.id || randomId());

  // Persist the notification ONCE with the same id used for delivery logs and
  // clicks, so the history table can join them. INSERT OR IGNORE makes this
  // safe when called from the API, the cron handler or a self-test.
  await db.prepare(`INSERT OR IGNORE INTO notifications
      (id, title, body, type, app_slug, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, String(note.title || '').slice(0, 200), String(note.body || '').slice(0, 1000),
      String(note.type || 'announcement'), String(note.app_slug || ''),
      JSON.stringify({ image_url: note.image_url || '', click_url: note.click_url || '', segment }),
      nowSec()).run().catch(() => {});

  // "all" reuses the topic broadcast (one request for the whole audience).
  if (segment.mode === 'all') {
    const r: any = await broadcastPush(env, { ...note, id, image_url: note.image_url, click_url: note.click_url });
    return { ...r, id, segment };
  }

  const audience = await resolveAudience(env, segment);
  const payload = buildAdvancedPayload(env, { ...note, id });
  const result: any = {
    targeted: audience.targeted, topic_targeted: 0, direct_targeted: 0,
    web_targeted: audience.web_count, success: 0, failure: 0,
    invalid_removed: 0, pending: 0, topic_sent: false,
    errors: [], error_counts: {}, job_id: null, duration_ms: 0,
    id, segment, native_count: audience.native_count,
  };
  if (!audience.entries.length) {
    await recordPushLog(env, id, result);
    return result;
  }

  const jobId = randomId();
  await db.prepare(`INSERT INTO push_jobs
      (id, notification_id, payload, cursor, done, created_at, updated_at, kind, tokens)
      VALUES (?, ?, ?, '0', 0, ?, ?, 'advanced', ?)`)
    .bind(jobId, id, JSON.stringify(payload), nowSec(), nowSec(), JSON.stringify(audience.entries)).run();
  result.job_id = jobId;
  const chunk = await processAdvancedJob(env, jobId, FCM_MAX_DIRECT_PER_SEND);
  result.direct_targeted = chunk.processed;
  result.success = chunk.success;
  result.failure = chunk.failure;
  result.invalid_removed = chunk.invalid_removed;
  result.pending = chunk.pending;
  result.errors = chunk.errors;
  result.error_counts = chunk.error_counts || {};
  result.duration_ms = Date.now() - started;
  await recordPushLog(env, id, result);
  console.log(JSON.stringify({ level: 'info', event: 'push_segmented',
    notification_id: id, mode: segment.mode, targeted: result.targeted,
    native: audience.native_count, web: audience.web_count,
    success: result.success, failure: result.failure, pending: result.pending }));
  return result;
}

/* -------------------------------------------------------------------------
   Scheduling (Cloudflare Cron Triggers call processScheduledPushes)
   ------------------------------------------------------------------------- */
export async function schedulePush(env: Env, input: any): Promise<any> {
  await ensureAdvancedSchema(env);
  const title = sanitizeText(input.title, 200);
  if (!title) throw new Error('title_required');
  const raw = input.scheduled_at;
  const ms = typeof raw === 'number' ? raw * 1000 : Date.parse(String(raw || ''));
  if (!Number.isFinite(ms)) throw new Error('invalid_schedule');
  const scheduledAt = Math.floor(ms / 1000);
  const id = randomId();
  const segment: Segment = { mode: (input.segment?.mode || 'all') as SegmentMode,
    uid: input.segment?.uid, token: input.segment?.token,
    platform: input.segment?.platform, app_slug: input.segment?.app_slug,
    days: input.segment?.days };
  await env.DB.prepare(`INSERT INTO scheduled_pushes
      (id, title, body, image_url, click_url, segment_json, scheduled_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
    .bind(id, title, sanitizeText(input.body, 1000), safeUrl(input.image_url),
      safeUrl(input.click_url), JSON.stringify(segment), scheduledAt, nowSec()).run();
  return { ok: true, id, scheduled_at: scheduledAt, segment };
}

export async function listScheduledPushes(env: Env, limit = 30): Promise<any[]> {
  await ensureAdvancedSchema(env);
  const rows: any = await env.DB.prepare(
    'SELECT * FROM scheduled_pushes ORDER BY scheduled_at DESC LIMIT ?',
  ).bind(Math.max(1, Math.min(Number(limit) || 30, 100))).all().catch(() => ({ results: [] }));
  return (rows.results || []).map((r: any) => ({ ...r, segment: safeParse(r.segment_json), result: safeParse(r.result_json) }));
}
function safeParse(raw: any): any { try { return JSON.parse(raw || '{}'); } catch { return {}; } }

export async function cancelScheduledPush(env: Env, id: string): Promise<boolean> {
  await ensureAdvancedSchema(env);
  const res: any = await env.DB.prepare(
    "UPDATE scheduled_pushes SET status = 'cancelled' WHERE id = ? AND status = 'pending'",
  ).bind(id).run().catch(() => null);
  return !!res?.success;
}

export async function processScheduledPushes(env: Env, limit = 10): Promise<any> {
  await ensureAdvancedSchema(env);
  const db: any = env.DB;
  const due: any = await db.prepare(
    "SELECT * FROM scheduled_pushes WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT ?",
  ).bind(nowSec(), Math.max(1, Math.min(Number(limit) || 10, 50))).all().catch(() => ({ results: [] }));
  let sent = 0, failed = 0;
  for (const row of (due.results || []) as any[]) {
    await db.prepare("UPDATE scheduled_pushes SET status = 'sending' WHERE id = ?").bind(row.id).run().catch(() => {});
    try {
      const result = await sendAdvancedPush(env, {
        id: `sched-${row.id}`, title: row.title, body: row.body,
        image_url: row.image_url, click_url: row.click_url,
        type: 'announcement',
      }, safeParse(row.segment_json));
      await db.prepare("UPDATE scheduled_pushes SET status = 'sent', sent_at = ?, result_json = ? WHERE id = ?")
        .bind(nowSec(), JSON.stringify(result), row.id).run();
      sent++;
    } catch (error: any) {
      await db.prepare("UPDATE scheduled_pushes SET status = 'failed', error = ? WHERE id = ?")
        .bind(String(error?.message || error), row.id).run().catch(() => {});
      console.error('[push] scheduled send failed:', row.id, error?.message || error);
      failed++;
    }
  }
  if (sent || failed) console.log(JSON.stringify({ level: 'info', event: 'push_cron', sent, failed }));
  return { processed: sent + failed, sent, failed };
}

/* -------------------------------------------------------------------------
   Clicks, history, app subscriptions
   ------------------------------------------------------------------------- */
export async function recordPushClick(env: Env, notificationId: string, uid = '', platform = ''): Promise<void> {
  await ensureAdvancedSchema(env);
  await env.DB.prepare(`INSERT INTO push_clicks
      (id, notification_id, uid, platform, clicked_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(randomId(), sanitizeText(notificationId, 120), sanitizeText(uid, 128),
      sanitizeText(platform, 32), nowSec()).run().catch(() => {});
}

export async function pushHistory(env: Env, limit = 30): Promise<any[]> {
  await ensureAdvancedSchema(env);
  const db: any = env.DB;
  const notes: any = await db.prepare(
    'SELECT id, title, body, type, app_slug, created_at FROM notifications ORDER BY created_at DESC LIMIT ?',
  ).bind(Math.max(1, Math.min(Number(limit) || 30, 100))).all().catch(() => ({ results: [] }));
  const sends: any = await db.prepare(`SELECT notification_id,
      SUM(targeted) AS targeted, SUM(success) AS success, SUM(failure) AS failure
    FROM push_send_log GROUP BY notification_id`).all().catch(() => ({ results: [] }));
  const clicks: any = await db.prepare(
    'SELECT notification_id, COUNT(*) AS n FROM push_clicks GROUP BY notification_id',
  ).all().catch(() => ({ results: [] }));
  const sendMap = new Map((sends.results || []).map((r: any) => [String(r.notification_id), r]));
  const clickMap = new Map((clicks.results || []).map((r: any) => [String(r.notification_id), Number(r.n)]));
  return (notes.results || []).map((n: any) => {
    const s: any = sendMap.get(String(n.id)) || {};
    return { ...n, targeted: Number(s.targeted || 0), success: Number(s.success || 0),
      failure: Number(s.failure || 0), clicks: Number(clickMap.get(String(n.id)) || 0) };
  });
}

export async function followApp(env: Env, uid: string, slug: string): Promise<boolean> {
  await ensureAdvancedSchema(env);
  const clean = sanitizeText(slug, 120);
  if (!clean) return false;
  await env.DB.prepare(`INSERT OR IGNORE INTO app_subscriptions (uid, app_slug, created_at)
    VALUES (?, ?, ?)`).bind(uid, clean, nowSec()).run().catch(() => {});
  return true;
}
export async function unfollowApp(env: Env, uid: string, slug: string): Promise<boolean> {
  await ensureAdvancedSchema(env);
  await env.DB.prepare('DELETE FROM app_subscriptions WHERE uid = ? AND app_slug = ?')
    .bind(uid, sanitizeText(slug, 120)).run().catch(() => {});
  return true;
}
export async function appFollowerCount(env: Env, slug: string): Promise<number> {
  await ensureAdvancedSchema(env);
  const row: any = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM app_subscriptions WHERE app_slug = ?',
  ).bind(sanitizeText(slug, 120)).first().catch(() => ({ c: 0 }));
  return Number(row?.c || 0);
}

/* -------------------------------------------------------------------------
   Analytics overview
   ------------------------------------------------------------------------- */
export async function analyticsOverview(env: Env): Promise<any> {
  await ensureAdvancedSchema(env);
  const db: any = env.DB;
  const stats = await pushTokenStats(env);
  const since7 = nowSec() - 7 * 86400;
  const active: any = await db.prepare(
    `SELECT COUNT(*) AS c FROM fcm_tokens WHERE ${ELIGIBLE} AND ${ACTIVE_NATIVE}`,
  ).bind(since7).first().catch(() => ({ c: 0 }));
  const activeWeb: any = await db.prepare(
    `SELECT COUNT(*) AS c FROM web_tokens WHERE ${ELIGIBLE} AND ${ACTIVE_WEB}`,
  ).bind(since7).first().catch(() => ({ c: 0 }));
  const daily: any = await db.prepare(`SELECT date(created_at, 'unixepoch') AS day,
      COUNT(*) AS sends, SUM(success) AS delivered, SUM(failure) AS failed
    FROM push_send_log WHERE created_at >= ? GROUP BY day ORDER BY day`)
    .bind(nowSec() - 30 * 86400).all().catch(() => ({ results: [] }));
  const store: any = await db.prepare(`SELECT COUNT(*) AS apps,
      COALESCE(SUM(downloads), 0) AS downloads,
      COALESCE(AVG(NULLIF(rating, 0)), 0) AS avg_rating FROM apps`).first().catch(() => ({}));
  const apk: any = await db.prepare(
    "SELECT downloads FROM app_download_stats WHERE id = 'current'",
  ).first().catch(() => null);
  const users: any = await db.prepare(
    'SELECT COUNT(*) AS c FROM (SELECT uid FROM fcm_tokens UNION SELECT uid FROM web_tokens)',
  ).first().catch(() => ({ c: 0 }));
  const clicks: any = await db.prepare('SELECT COUNT(*) AS c FROM push_clicks').first().catch(() => ({ c: 0 }));
  const scheduled: any = await db.prepare(
    "SELECT COUNT(*) AS c FROM scheduled_pushes WHERE status = 'pending'",
  ).first().catch(() => ({ c: 0 }));
  const cf = await cloudflareUsage(env);
  return {
    generated_at: nowSec(),
    push: {
      registered_devices: stats.native_total + stats.web_total,
      unique_tokens: stats.native_unique + stats.web_unique,
      opted_in: stats.native_eligible + stats.web_eligible,
      opted_out: stats.native_opted_out,
      active_7d: Number(active?.c || 0) + Number(activeWeb?.c || 0),
      subscribed_to_topic: stats.native_subscribed,
      registrations_24h: stats.registrations_24h,
      total_clicks: Number(clicks?.c || 0),
      pending_scheduled: Number(scheduled?.c || 0),
    },
    store: {
      total_apps: Number(store?.apps || 0),
      total_downloads: Number(store?.downloads || 0),
      avg_rating: Number(Number(store?.avg_rating || 0).toFixed(2)),
      apk_downloads: Number(apk?.downloads || 0),
      users_with_devices: Number(users?.c || 0),
    },
    daily_sends: daily.results || [],
    cloudflare: cf,
    firebase_usage: await firebaseUsage(env, 7),
  };
}
