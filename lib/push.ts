/* =========================================================================
   Golden Store — FCM broadcast engine (Cloudflare Worker / D1 / FCM HTTP v1)
   -------------------------------------------------------------------------
   Root causes this module fixes:
   1. Broadcasts used ONLY `topic: 'all'`, but no token was ever subscribed to
      that topic → only a handful of devices (manually subscribed) received.
   2. Web tokens were written to D1 `web_tokens` but read from Firestore →
      every browser subscriber was silently skipped.
   3. Dead tokens (UNREGISTERED / INVALID_ARGUMENT / 404) were collected but
      never deleted → growing failure rate and wasted quota.
   4. `Promise.all()` over up to 500 tokens opened 500 simultaneous outbound
      requests from one Worker invocation (subrequest limit) → partial sends.
   5. No permission/consent state was stored → could not target opted-in users
      only (Android 13+ POST_NOTIFICATIONS).
   ========================================================================= */
import type { Env } from './env.js';
import { nowSec, randomId, sha256Hex } from './utils.js';
import {
  messaging, sendWebPush, subscribeTokenToTopic, unsubscribeTokenFromTopic,
  mapWithConcurrency,
} from './firebase.js';
export { mapWithConcurrency, classifyFcmError, sendWebPush } from './firebase.js';

export const FCM_TOPIC = 'all';
/** Logical batch size requested by the store owner. HTTP v1 has no multicast
    endpoint, so each batch is dispatched with bounded concurrency. */
export const FCM_BATCH_SIZE = 500;
export const FCM_CONCURRENCY = 20;
/** Outbound subrequests per Worker invocation. Cloudflare allows 50 (free) /
    1000 (paid); 300 stays comfortably inside the paid plan. Overflow is
    queued in `push_jobs` and drained by POST /api/admin/push/flush. */
export const FCM_MAX_DIRECT_PER_SEND = 300;

/* -------------------------------------------------------------------------
   Schema — created automatically, and upgraded in place for existing D1 DBs.
   ------------------------------------------------------------------------- */
const PUSH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS fcm_tokens (
     id TEXT PRIMARY KEY,
     token TEXT NOT NULL,
     uid TEXT NOT NULL,
     platform TEXT NOT NULL DEFAULT 'android',
     permission TEXT NOT NULL DEFAULT 'granted',
     notifications_enabled INTEGER NOT NULL DEFAULT 1,
     topic_subscribed INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS web_tokens (
     uid TEXT PRIMARY KEY,
     token TEXT NOT NULL,
     platform TEXT NOT NULL DEFAULT 'web',
     userAgent TEXT,
     updatedAt INTEGER NOT NULL,
     permission TEXT NOT NULL DEFAULT 'granted',
     notifications_enabled INTEGER NOT NULL DEFAULT 1
   )`,
  `CREATE TABLE IF NOT EXISTS push_jobs (
     id TEXT PRIMARY KEY,
     notification_id TEXT,
     payload TEXT NOT NULL,
     cursor TEXT NOT NULL DEFAULT '',
     done INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS push_send_log (
     id TEXT PRIMARY KEY,
     notification_id TEXT,
     targeted INTEGER NOT NULL DEFAULT 0,
     topic_targeted INTEGER NOT NULL DEFAULT 0,
     direct_targeted INTEGER NOT NULL DEFAULT 0,
     web_targeted INTEGER NOT NULL DEFAULT 0,
     success INTEGER NOT NULL DEFAULT 0,
     failure INTEGER NOT NULL DEFAULT 0,
     invalid_removed INTEGER NOT NULL DEFAULT 0,
     pending INTEGER NOT NULL DEFAULT 0,
     topic_sent INTEGER NOT NULL DEFAULT 0,
     errors TEXT,
     duration_ms INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_fcm_tokens_eligible
     ON fcm_tokens(notifications_enabled, topic_subscribed, id)`,
  `CREATE INDEX IF NOT EXISTS idx_web_tokens_eligible
     ON web_tokens(notifications_enabled, permission, uid)`,
  `CREATE INDEX IF NOT EXISTS idx_push_send_log_created
     ON push_send_log(created_at DESC)`,
];
// CREATE TABLE IF NOT EXISTS cannot add a column to an existing table. Each
// ALTER is safe to fail with "duplicate column name".
const PUSH_UPGRADES = [
  `ALTER TABLE fcm_tokens ADD COLUMN permission TEXT NOT NULL DEFAULT 'granted'`,
  `ALTER TABLE fcm_tokens ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE fcm_tokens ADD COLUMN topic_subscribed INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE web_tokens ADD COLUMN permission TEXT NOT NULL DEFAULT 'granted'`,
  `ALTER TABLE web_tokens ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 1`,
];
const pushSchemaReady = new WeakSet<object>();

export async function ensurePushSchema(env: Env): Promise<void> {
  const db: any = env.DB;
  if (pushSchemaReady.has(db)) return;
  for (const sql of PUSH_SCHEMA) await db.prepare(sql).run();
  for (const sql of PUSH_UPGRADES) {
    try { await db.prepare(sql).run(); } catch { /* column already exists */ }
  }
  pushSchemaReady.add(db);
}

function normalizePermission(raw: unknown): string {
  const value = String(raw || 'granted').toLowerCase();
  return value === 'denied' || value === 'default' ? value : 'granted';
}

/* -------------------------------------------------------------------------
   Registration / consent
   ------------------------------------------------------------------------- */
export type TokenRegistration = {
  token: string;
  uid: string;
  web?: boolean;
  platform?: string;
  permission?: string;
  enabled?: boolean;
  userAgent?: string;
};

export async function registerPushToken(env: Env, input: TokenRegistration): Promise<any> {
  await ensurePushSchema(env);
  const db: any = env.DB;
  const token = String(input.token || '').trim();
  const permission = normalizePermission(input.permission);
  const enabled = input.enabled !== false && permission !== 'denied';

  // Explicit opt-out: remove the token everywhere and leave the FCM topic.
  if (!enabled) {
    await db.prepare('DELETE FROM fcm_tokens WHERE token = ?').bind(token).run().catch(() => {});
    await db.prepare('DELETE FROM web_tokens WHERE token = ?').bind(token).run().catch(() => {});
    if (!input.web) await unsubscribeTokenFromTopic(env, token, FCM_TOPIC).catch(() => {});
    return { ok: true, registered: false, topic_subscribed: false, reason: 'opted_out' };
  }

  if (input.web) {
    await db.prepare(`INSERT OR REPLACE INTO web_tokens
        (uid, token, platform, userAgent, updatedAt, permission, notifications_enabled)
        VALUES (?, ?, 'web', ?, ?, ?, 1)`)
      .bind(input.uid, token, String(input.userAgent || '').slice(0, 300),
        nowSec(), permission).run();
    return { ok: true, registered: true, topic_subscribed: false };
  }

  // Native token: subscribe it to the broadcast topic ONCE, using the modern
  // FCM v1 topicSubscriptions endpoint. A permanent failure means the token
  // is dead → delete it instead of storing it.
  let subscribed = false;
  try {
    const sub = await subscribeTokenToTopic(env, token, FCM_TOPIC);
    subscribed = sub.ok;
    if (sub.permanent) {
      await db.prepare('DELETE FROM fcm_tokens WHERE token = ?').bind(token).run().catch(() => {});
      console.warn('[fcm] dropped dead token at registration', { status: sub.status, code: sub.code });
      return { ok: true, registered: false, topic_subscribed: false, reason: 'invalid_token' };
    }
  } catch (error: any) {
    console.warn('[fcm] topic subscribe failed (will send directly):', error?.message || error);
  }

  const id = await sha256Hex(token);
  await db.prepare(`INSERT OR REPLACE INTO fcm_tokens
      (id, token, uid, platform, permission, notifications_enabled, topic_subscribed, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
    .bind(id, token, input.uid, String(input.platform || 'android').slice(0, 40),
      permission, subscribed ? 1 : 0, nowSec()).run();
  return { ok: true, registered: true, topic_subscribed: subscribed };
}

/** Persist the OS notification permission (Android 13+ POST_NOTIFICATIONS /
    browser Notification.permission) so broadcasts target opted-in users only. */
export async function setPushPreference(
  env: Env, uid: string, rawPermission: string, rawEnabled: boolean,
): Promise<any> {
  await ensurePushSchema(env);
  const db: any = env.DB;
  const permission = normalizePermission(rawPermission);
  const enabled = rawEnabled !== false && permission !== 'denied' ? 1 : 0;
  await db.prepare('UPDATE fcm_tokens SET permission = ?, notifications_enabled = ? WHERE uid = ?')
    .bind(permission, enabled, uid).run().catch(() => {});
  await db.prepare('UPDATE web_tokens SET permission = ?, notifications_enabled = ? WHERE uid = ?')
    .bind(permission, enabled, uid).run().catch(() => {});

  // Keep topic membership in sync with consent: opting out must also
  // unsubscribe, otherwise topic messages would bypass the D1 filter.
  // Only rows whose membership actually differs are touched, so calling this
  // on every page load does not issue redundant FCM requests.
  const rows: any = await db.prepare(
    'SELECT token FROM fcm_tokens WHERE uid = ? AND topic_subscribed = ?',
  ).bind(uid, enabled ? 0 : 1).all().catch(() => ({ results: [] }));
  await mapWithConcurrency(rows.results || [], 10, async (row: any) => {
    const token = String(row.token || '');
    if (!token) return;
    if (enabled) {
      const sub = await subscribeTokenToTopic(env, token, FCM_TOPIC).catch(() => null);
      if (sub?.ok) await db.prepare('UPDATE fcm_tokens SET topic_subscribed = 1 WHERE token = ?').bind(token).run().catch(() => {});
    } else {
      await unsubscribeTokenFromTopic(env, token, FCM_TOPIC).catch(() => {});
      await db.prepare('UPDATE fcm_tokens SET topic_subscribed = 0 WHERE token = ?').bind(token).run().catch(() => {});
    }
  });
  return { ok: true, permission, notifications_enabled: !!enabled };
}

export async function unregisterPushToken(env: Env, token: string): Promise<void> {
  await ensurePushSchema(env);
  const db: any = env.DB;
  await db.prepare('DELETE FROM fcm_tokens WHERE token = ?').bind(token).run().catch(() => {});
  await db.prepare('DELETE FROM fcm_tokens WHERE id = ?').bind(await sha256Hex(token)).run().catch(() => {});
  await db.prepare('DELETE FROM web_tokens WHERE token = ?').bind(token).run().catch(() => {});
  await unsubscribeTokenFromTopic(env, token, FCM_TOPIC).catch(() => {});
}

/* -------------------------------------------------------------------------
   Payload
   ------------------------------------------------------------------------- */
function storeLogoUrl(env: Env): string {
  return env.STORE_LOGO_URL || `https://${env.STORE_DOMAIN || 'goldenstore.online'}/images/logo.png`;
}

export function buildPushPayload(env: Env, n: any) {
  const data: Record<string, string> = {
    title: String(n.title || ''), body: String(n.body || ''),
    type: String(n.type || 'announcement'), app_slug: String(n.app_slug || ''),
    notification_id: String(n.id || ''), image: String(n.image || ''),
    store_logo: storeLogoUrl(env),
  };
  if (n.data) { try { data.extra = JSON.stringify(n.data); } catch { /* ignore */ } }
  return {
    data,
    notification: { title: String(n.title || ''), body: String(n.body || '') },
    android: {
      priority: 'high',
      notification: {
        title: String(n.title || ''), body: String(n.body || ''),
        channelId: 'goldenstore_notifications', color: '#f4c01f', visibility: 'public',
      },
    },
  };
}

/* -------------------------------------------------------------------------
   Direct (token) delivery — batches of 500, bounded concurrency, pruning.
   ------------------------------------------------------------------------- */
export type DirectResult = {
  targeted: number; success: number; failure: number; invalid_removed: number;
  errors: string[]; error_counts: Record<string, number>;
};

export async function sendDirectPush(
  env: Env, tokens: string[], payload: ReturnType<typeof buildPushPayload>,
): Promise<DirectResult> {
  const result: DirectResult = {
    targeted: 0, success: 0, failure: 0, invalid_removed: 0,
    errors: [], error_counts: {},
  };
  const unique = Array.from(new Set(tokens.map((t) => String(t || '').trim()).filter(Boolean)));
  result.targeted = unique.length;
  if (!unique.length) return result;

  const msg = await messaging(env);
  const dead: string[] = [];
  for (let i = 0; i < unique.length; i += FCM_BATCH_SIZE) {
    const batch = unique.slice(i, i + FCM_BATCH_SIZE);
    let resp: any;
    try {
      resp = await msg.sendEachForMulticast({ tokens: batch, ...payload });
    } catch (error: any) {
      result.failure += batch.length;
      result.error_counts.multicast_error = (result.error_counts.multicast_error || 0) + batch.length;
      if (result.errors.length < 8) result.errors.push('multicast_error: ' + (error?.message || String(error)));
      continue;
    }
    (resp.responses || []).forEach((r: any, idx: number) => {
      if (r.success) { result.success++; return; }
      result.failure++;
      const code = String(r.error?.code || 'messaging/unknown-error');
      result.error_counts[code] = (result.error_counts[code] || 0) + 1;
      if (result.errors.length < 8) {
        result.errors.push(`${code}: ${String(r.error?.message || '').slice(0, 160)}`);
      }
      // UNREGISTERED / INVALID_ARGUMENT / SENDER_ID_MISMATCH are permanent.
      if (r.error?.kind === 'permanent' || code.includes('registration-token-not-registered')
          || code.includes('invalid-argument') || code.includes('sender-id-mismatch')) {
        dead.push(batch[idx]);
      }
    });
  }
  if (dead.length) result.invalid_removed = await deleteDeadTokens(env, dead);
  return result;
}

export async function deleteDeadTokens(env: Env, tokens: string[]): Promise<number> {
  if (!tokens.length) return 0;
  await ensurePushSchema(env);
  const db: any = env.DB;
  const unique = Array.from(new Set(tokens));
  try {
    await db.batch(unique.map((token) =>
      db.prepare('DELETE FROM fcm_tokens WHERE token = ?').bind(token)));
  } catch {
    // Some D1 shims do not implement batch(); fall back to sequential deletes.
    for (const token of unique) {
      await db.prepare('DELETE FROM fcm_tokens WHERE token = ?').bind(token).run().catch(() => {});
    }
  }
  console.warn('[fcm] pruned dead tokens', { count: unique.length });
  return unique.length;
}

/* -------------------------------------------------------------------------
   Queue: guarantees EVERY eligible token is covered even when the audience
   is larger than one Worker invocation's subrequest budget.
   ------------------------------------------------------------------------- */
const UNSUBSCRIBED_WHERE = `notifications_enabled = 1 AND permission != 'denied' AND topic_subscribed = 0`;

export async function processPushJob(env: Env, jobId: string, limit = FCM_MAX_DIRECT_PER_SEND): Promise<any> {
  await ensurePushSchema(env);
  const db: any = env.DB;
  const job: any = await db.prepare('SELECT * FROM push_jobs WHERE id = ?').bind(jobId).first();
  if (!job) return { processed: 0, success: 0, failure: 0, invalid_removed: 0, pending: 0, done: true, errors: ['job_not_found'] };
  const payload = JSON.parse(job.payload);
  const cap = Math.max(1, Math.min(Number(limit) || FCM_MAX_DIRECT_PER_SEND, FCM_MAX_DIRECT_PER_SEND));
  const rows: any = await db.prepare(
    `SELECT id, token FROM fcm_tokens WHERE ${UNSUBSCRIBED_WHERE} AND id > ? ORDER BY id LIMIT ?`,
  ).bind(job.cursor || '', cap).all();
  const list: any[] = rows.results || [];
  const direct = await sendDirectPush(env, list.map((r) => String(r.token)), payload);
  const cursor = list.length ? String(list[list.length - 1].id) : String(job.cursor || '');
  const rest: any = await db.prepare(
    `SELECT COUNT(*) AS c FROM fcm_tokens WHERE ${UNSUBSCRIBED_WHERE} AND id > ?`,
  ).bind(cursor).first().catch(() => ({ c: 0 }));
  const pending = Number(rest?.c || 0);
  await db.prepare('UPDATE push_jobs SET cursor = ?, done = ?, updated_at = ? WHERE id = ?')
    .bind(cursor, pending > 0 ? 0 : 1, nowSec(), jobId).run();
  return {
    processed: direct.targeted, success: direct.success, failure: direct.failure,
    invalid_removed: direct.invalid_removed, errors: direct.errors,
    pending, done: pending === 0,
  };
}

/** One-off backfill for tokens registered before this fix. */
export async function syncTopicSubscriptions(env: Env, limit = 100): Promise<any> {
  await ensurePushSchema(env);
  const db: any = env.DB;
  const cap = Math.max(1, Math.min(Number(limit) || 100, 200));
  const rows: any = await db.prepare(
    `SELECT id, token FROM fcm_tokens WHERE ${UNSUBSCRIBED_WHERE} ORDER BY id LIMIT ?`,
  ).bind(cap).all();
  const list: any[] = rows.results || [];
  let subscribed = 0, invalid = 0, failed = 0;
  await mapWithConcurrency(list, 10, async (row) => {
    const token = String(row.token || '');
    const sub = await subscribeTokenToTopic(env, token, FCM_TOPIC).catch(() => null);
    if (sub?.ok) {
      await db.prepare('UPDATE fcm_tokens SET topic_subscribed = 1 WHERE id = ?').bind(row.id).run().catch(() => {});
      subscribed++;
    } else if (sub?.permanent) {
      await db.prepare('DELETE FROM fcm_tokens WHERE id = ?').bind(row.id).run().catch(() => {});
      invalid++;
    } else failed++;
  });
  const rest: any = await db.prepare(
    `SELECT COUNT(*) AS c FROM fcm_tokens WHERE ${UNSUBSCRIBED_WHERE}`,
  ).first().catch(() => ({ c: 0 }));
  return { attempted: list.length, subscribed, invalid, failed, remaining: Number(rest?.c || 0) };
}

/* -------------------------------------------------------------------------
   Stats / logs
   ------------------------------------------------------------------------- */
export async function pushTokenStats(env: Env): Promise<any> {
  await ensurePushSchema(env);
  const db: any = env.DB;
  const native: any = await db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN notifications_enabled = 1 AND permission != 'denied' THEN 1 ELSE 0 END) AS eligible,
      SUM(CASE WHEN notifications_enabled = 1 AND permission != 'denied' AND topic_subscribed = 1 THEN 1 ELSE 0 END) AS subscribed
    FROM fcm_tokens`).first().catch(() => ({}));
  const web: any = await db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN notifications_enabled = 1 AND permission != 'denied' THEN 1 ELSE 0 END) AS eligible
    FROM web_tokens`).first().catch(() => ({}));
  const jobs: any = await db.prepare('SELECT COUNT(*) AS c FROM push_jobs WHERE done = 0').first().catch(() => ({}));
  return {
    native_total: Number(native?.total || 0),
    native_eligible: Number(native?.eligible || 0),
    native_subscribed: Number(native?.subscribed || 0),
    native_unsubscribed: Number(native?.eligible || 0) - Number(native?.subscribed || 0),
    web_total: Number(web?.total || 0),
    web_eligible: Number(web?.eligible || 0),
    pending_jobs: Number(jobs?.c || 0),
  };
}

export async function recordPushLog(env: Env, notificationId: string, r: any): Promise<void> {
  await ensurePushSchema(env);
  const db: any = env.DB;
  await db.prepare(`INSERT INTO push_send_log
      (id, notification_id, targeted, topic_targeted, direct_targeted, web_targeted,
       success, failure, invalid_removed, pending, topic_sent, errors, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(randomId(), notificationId, r.targeted, r.topic_targeted, r.direct_targeted,
      r.web_targeted, r.success, r.failure, r.invalid_removed, r.pending,
      r.topic_sent ? 1 : 0, JSON.stringify(r.errors || []), r.duration_ms, nowSec())
    .run().catch((e: any) => console.error('[fcm] log write failed:', e?.message || e));
  console.log(JSON.stringify({
    level: 'info', event: 'push_broadcast', notification_id: notificationId,
    targeted: r.targeted, topic_targeted: r.topic_targeted,
    direct_targeted: r.direct_targeted, web_targeted: r.web_targeted,
    success: r.success, failure: r.failure, invalid_removed: r.invalid_removed,
    pending: r.pending, topic_sent: r.topic_sent, duration_ms: r.duration_ms,
  }));
  if ((r.errors || []).length) {
    console.error(JSON.stringify({
      level: 'error', event: 'push_failures', notification_id: notificationId,
      errors: r.errors, error_counts: r.error_counts,
    }));
  }
}

export async function listPushLogs(env: Env, limit = 20): Promise<any[]> {
  await ensurePushSchema(env);
  const rows: any = await env.DB.prepare(
    'SELECT * FROM push_send_log ORDER BY created_at DESC LIMIT ?',
  ).bind(Math.max(1, Math.min(Number(limit) || 20, 100))).all().catch(() => ({ results: [] }));
  return (rows.results || []).map((r: any) => ({ ...r, errors: safeJson(r.errors) }));
}
function safeJson(raw: any): any { try { return JSON.parse(raw || '[]'); } catch { return []; } }

/* -------------------------------------------------------------------------
   Broadcast — the single entry point used by addNotification and admin routes.
   ------------------------------------------------------------------------- */
export type BroadcastResult = {
  targeted: number; topic_targeted: number; direct_targeted: number; web_targeted: number;
  success: number; failure: number; invalid_removed: number; pending: number;
  topic_sent: boolean; errors: string[]; error_counts: Record<string, number>;
  job_id: string | null; duration_ms: number;
};

export async function broadcastPush(env: Env, n: any): Promise<BroadcastResult> {
  const started = Date.now();
  await ensurePushSchema(env);
  const db: any = env.DB;
  const payload = buildPushPayload(env, n);
  const result: BroadcastResult = {
    targeted: 0, topic_targeted: 0, direct_targeted: 0, web_targeted: 0,
    success: 0, failure: 0, invalid_removed: 0, pending: 0,
    topic_sent: false, errors: [], error_counts: {}, job_id: null,
    duration_ms: 0,
  };

  const stats = await pushTokenStats(env);
  result.topic_targeted = stats.native_subscribed;
  result.web_targeted = stats.web_eligible;
  result.targeted = stats.native_eligible + stats.web_eligible;

  // A) ONE topic message covers every subscribed native device. This is the
  //    only path that scales to a large audience without subrequest limits.
  if (stats.native_subscribed > 0) {
    try {
      const msg = await messaging(env);
      await msg.send({ topic: FCM_TOPIC, ...payload });
      result.topic_sent = true;
      result.success += stats.native_subscribed; // topic = 1 request, no per-device receipt
    } catch (error: any) {
      result.failure += stats.native_subscribed;
      const code = String(error?.code || 'topic_send_failed');
      result.error_counts[code] = (result.error_counts[code] || 0) + 1;
      result.errors.push(`topic_send_failed: ${error?.message || String(error)}`);
      console.error('[fcm] topic send failed', { code, message: error?.message, httpStatus: error?.httpStatus });
    }
  }

  // B) Tokens not yet subscribed are sent DIRECTLY in 500-token batches.
  //    Overflow goes to a D1 job so no eligible device is skipped.
  if (stats.native_unsubscribed > 0) {
    const jobId = randomId();
    await db.prepare(`INSERT INTO push_jobs
        (id, notification_id, payload, cursor, done, created_at, updated_at)
        VALUES (?, ?, ?, '', 0, ?, ?)`)
      .bind(jobId, String(n.id || ''), JSON.stringify(payload), nowSec(), nowSec()).run();
    result.job_id = jobId;
    const chunk = await processPushJob(env, jobId, FCM_MAX_DIRECT_PER_SEND);
    result.direct_targeted = chunk.processed;
    result.success += chunk.success;
    result.failure += chunk.failure;
    result.invalid_removed += chunk.invalid_removed;
    result.pending = chunk.pending;
    result.errors.push(...chunk.errors);
  }

  // C) Browser subscribers — now read from the SAME D1 table they are written
  //    to, with dead-token pruning and bounded concurrency.
  try {
    const web = await sendWebPush(env, String(n.title || ''), String(n.body || ''), payload.data);
    result.web_targeted = web.targeted;
    result.targeted = result.topic_targeted + result.direct_targeted + web.targeted + result.pending;
    result.success += web.success;
    result.failure += web.failure;
    result.invalid_removed += web.invalid_removed;
    result.errors.push(...web.errors);
    for (const [code, count] of Object.entries(web.error_counts)) {
      result.error_counts[code] = (result.error_counts[code] || 0) + Number(count);
    }
  } catch (error: any) {
    result.errors.push('web_push_failed: ' + (error?.message || String(error)));
    console.error('[fcm] web push failed:', error?.message || error);
  }

  result.duration_ms = Date.now() - started;
  await recordPushLog(env, String(n.id || ''), result);
  return result;
}
