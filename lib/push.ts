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
  `CREATE TABLE IF NOT EXISTS push_sync_state (
     id TEXT PRIMARY KEY,
     cursor TEXT NOT NULL DEFAULT '',
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS push_reg_log (
     id TEXT PRIMARY KEY,
     uid_masked TEXT,
     platform TEXT,
     permission TEXT,
     enabled INTEGER,
     token_tail TEXT,
     created_at INTEGER NOT NULL
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
// Indexes MUST run AFTER the upgrades: on a legacy database the tables already
// exist without the new columns, so CREATE INDEX referencing them fails with
// "no such column" and would break EVERY push endpoint.
const PUSH_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_fcm_tokens_eligible
     ON fcm_tokens(notifications_enabled, topic_subscribed, id)`,
  `CREATE INDEX IF NOT EXISTS idx_web_tokens_eligible
     ON web_tokens(notifications_enabled, permission, uid)`,
  `CREATE INDEX IF NOT EXISTS idx_push_send_log_created
     ON push_send_log(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_push_reg_log_created
     ON push_reg_log(created_at DESC)`,
];
const pushSchemaReady = new WeakSet<object>();

export async function ensurePushSchema(env: Env): Promise<void> {
  const db: any = env.DB;
  if (pushSchemaReady.has(db)) return;
  // 1) tables  2) add missing columns  3) THEN indexes. Never reorder.
  for (const sql of PUSH_SCHEMA) await db.prepare(sql).run();
  for (const sql of PUSH_UPGRADES) {
    try { await db.prepare(sql).run(); } catch { /* column already exists */ }
  }
  for (const sql of PUSH_INDEXES) {
    try { await db.prepare(sql).run(); }
    catch (error: any) {
      // A missing index degrades performance, never delivery.
      console.warn('[fcm] optional index skipped:', error?.message || String(error));
    }
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
  // The token is ALWAYS stored. Consent is a SEPARATE field used only when
  // building the audience — deleting a device because the user once tapped
  // "no" makes that user permanently unreachable from the server side.
  const enabled = input.enabled !== false && permission !== 'denied';
  const platform = input.web ? 'web' : String(input.platform || 'android').slice(0, 40);

  const id = await sha256Hex(token);
  let topicSubscribed = false;

  if (input.web) {
    await db.prepare(`INSERT OR REPLACE INTO web_tokens
        (uid, token, platform, userAgent, updatedAt, permission, notifications_enabled)
        VALUES (?, ?, 'web', ?, ?, ?, ?)`)
      .bind(input.uid, token, String(input.userAgent || '').slice(0, 300),
        nowSec(), permission, enabled ? 1 : 0).run();
  } else {
    // Preserve an existing successful subscription: a transient failure on
    // re-registration must not turn a topic device into a direct-only device
    // (that would deliver the same message twice).
    const existing: any = await db.prepare('SELECT topic_subscribed FROM fcm_tokens WHERE id = ?')
      .bind(id).first().catch(() => null);
    topicSubscribed = Number(existing?.topic_subscribed || 0) === 1;

    if (enabled && !topicSubscribed) {
      try {
        const sub = await subscribeTokenToTopic(env, token, FCM_TOPIC);
        topicSubscribed = sub.ok;
        if (sub.permanent) {
          // Genuinely dead token: nothing can ever be delivered to it.
          await db.prepare('DELETE FROM fcm_tokens WHERE token = ?').bind(token).run().catch(() => {});
          console.warn('[fcm] dropped dead token at registration', { status: sub.status, code: sub.code });
          return { ok: true, registered: false, permission, notifications_enabled: false,
            topic_subscribed: false, reason: 'invalid_token' };
        }
      } catch (error: any) {
        console.warn('[fcm] topic subscribe failed (will send directly):', error?.message || error);
      }
    } else if (!enabled && topicSubscribed) {
      await unsubscribeTokenFromTopic(env, token, FCM_TOPIC).catch(() => {});
      topicSubscribed = false;
    }

    await db.prepare(`INSERT OR REPLACE INTO fcm_tokens
        (id, token, uid, platform, permission, notifications_enabled, topic_subscribed, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, token, input.uid, platform, permission, enabled ? 1 : 0,
        topicSubscribed ? 1 : 0, nowSec()).run();
  }

  // Structured, privacy-safe registration log: visible in `wrangler tail` and
  // via /api/admin/push/registrations. Never logs the full FCM token.
  await db.prepare(`INSERT INTO push_reg_log
      (id, uid_masked, platform, permission, enabled, token_tail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(randomId(), String(input.uid).slice(0, 8), platform, permission,
      enabled ? 1 : 0, token.slice(-6), nowSec())
    .run().catch(() => {});
  console.log(JSON.stringify({
    level: 'info', event: 'push_register', platform, permission,
    notifications_enabled: enabled, topic_subscribed: topicSubscribed,
    token_tail: token.slice(-6), uid_masked: String(input.uid).slice(0, 8),
  }));
  return { ok: true, registered: true, permission,
    notifications_enabled: enabled, topic_subscribed: topicSubscribed };
}

/** Persist the OS notification permission (Android 13+ POST_NOTIFICATIONS /
    browser Notification.permission) so broadcasts target opted-in users only. */
export async function setPushPreference(
  env: Env, uid: string, rawPermission: string, rawEnabled: boolean, platform = 'android',
): Promise<any> {
  await ensurePushSchema(env);
  const db: any = env.DB;
  const permission = normalizePermission(rawPermission);
  const enabled = rawEnabled !== false && permission !== 'denied' ? 1 : 0;
  const isWeb = String(platform) === 'web';

  // CRITICAL: a browser tab reporting permission "default" must NOT disable
  // the same user's Android device. Each platform owns its own consent state.
  if (isWeb) {
    await db.prepare('UPDATE web_tokens SET permission = ?, notifications_enabled = ? WHERE uid = ?')
      .bind(permission, enabled, uid).run().catch(() => {});
    return { ok: true, platform: 'web', permission, notifications_enabled: !!enabled };
  }

  await db.prepare('UPDATE fcm_tokens SET permission = ?, notifications_enabled = ? WHERE uid = ?')
    .bind(permission, enabled, uid).run().catch(() => {});

  // Keep topic membership in sync; only rows whose state actually differs
  // are touched, so calling this on every app launch issues no extra requests.
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
  return { ok: true, platform: 'android', permission, notifications_enabled: !!enabled };
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
// COALESCE keeps rows created before the consent columns (or with NULL
// values) eligible — a plain `permission != 'denied'` silently drops NULLs.
const ELIGIBLE_WHERE = `COALESCE(notifications_enabled, 1) = 1
  AND COALESCE(permission, 'granted') != 'denied'`;
const UNSUBSCRIBED_WHERE = `${ELIGIBLE_WHERE} AND COALESCE(topic_subscribed, 0) = 0`;

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

/** One-off backfill for tokens registered before this fix.
 *
 *  Uses a PERSISTENT keyset cursor (push_sync_state) so repeated calls walk
 *  the WHOLE fcm_tokens table instead of re-reading the first N rows forever.
 *  With `all: true` it drains several chunks in one invocation, capped by the
 *  Worker subrequest budget. Every run emits a structured log with the exact
 *  number of rows fetched from D1 and the number subscribed in FCM.
 */
export const FCM_MAX_SYNC_PER_SEND = 300;

async function readSyncCursor(env: Env): Promise<string> {
  const row: any = await env.DB.prepare(
    "SELECT cursor FROM push_sync_state WHERE id = 'topics'",
  ).first().catch(() => null);
  return String(row?.cursor || '');
}
async function writeSyncCursor(env: Env, cursor: string): Promise<void> {
  await env.DB.prepare(`INSERT OR REPLACE INTO push_sync_state (id, cursor, updated_at)
    VALUES ('topics', ?, ?)`).bind(cursor, nowSec()).run().catch(() => {});
}

export async function syncTopicSubscriptions(
  env: Env, options: { limit?: number; all?: boolean } = {},
): Promise<any> {
  await ensurePushSchema(env);
  const db: any = env.DB;
  const limit = Math.max(1, Math.min(Number(options.limit) || 100, 200));
  const maxRounds = options.all
    ? Math.max(1, Math.min(20, Math.floor(FCM_MAX_SYNC_PER_SEND / limit)))
    : 1;
  let cursor = await readSyncCursor(env);
  let fetched = 0, subscribed = 0, invalid = 0, failed = 0, rounds = 0;

  for (let round = 0; round < maxRounds; round++) {
    const rows: any = await db.prepare(
      `SELECT id, token FROM fcm_tokens
        WHERE ${UNSUBSCRIBED_WHERE} AND id > ? ORDER BY id LIMIT ?`,
    ).bind(cursor, limit).all();
    const list: any[] = rows.results || [];
    if (!list.length) { cursor = ''; await writeSyncCursor(env, ''); break; }
    rounds++;
    fetched += list.length;
    cursor = String(list[list.length - 1].id);
    await writeSyncCursor(env, cursor);

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
      `SELECT COUNT(*) AS c FROM fcm_tokens WHERE ${UNSUBSCRIBED_WHERE} AND id > ?`,
    ).bind(cursor).first().catch(() => ({ c: 0 }));
    if (Number(rest?.c || 0) === 0) { cursor = ''; await writeSyncCursor(env, ''); break; }
  }

  const total: any = await db.prepare(
    `SELECT COUNT(*) AS c FROM fcm_tokens WHERE ${UNSUBSCRIBED_WHERE}`,
  ).first().catch(() => ({ c: 0 }));
  const remaining = Number(total?.c || 0);
  const result = { fetched, attempted: fetched, subscribed, invalid, failed,
    remaining, rounds, done: remaining === 0 };
  console.log(JSON.stringify({ level: 'info', event: 'push_sync_topics',
    rows_fetched_from_d1: fetched, subscribed_in_fcm: subscribed,
    invalid_deleted: invalid, transient_failures: failed,
    remaining_unsubscribed: remaining, rounds, limit }));
  if (failed > 0) {
    console.warn(JSON.stringify({ level: 'warn', event: 'push_sync_retry_needed', failed }));
  }
  return result;
}

/* -------------------------------------------------------------------------
   Stats / logs
   ------------------------------------------------------------------------- */
export async function pushTokenStats(env: Env): Promise<any> {
  await ensurePushSchema(env);
  const db: any = env.DB;
  const native: any = await db.prepare(`SELECT
      COUNT(*) AS total,
      COUNT(DISTINCT token) AS unique_tokens,
      SUM(CASE WHEN ${ELIGIBLE_WHERE} THEN 1 ELSE 0 END) AS eligible,
      SUM(CASE WHEN NOT (${ELIGIBLE_WHERE}) THEN 1 ELSE 0 END) AS opted_out,
      SUM(CASE WHEN ${ELIGIBLE_WHERE} AND COALESCE(topic_subscribed,0) = 1 THEN 1 ELSE 0 END) AS subscribed
    FROM fcm_tokens`).first().catch(() => ({}));
  const web: any = await db.prepare(`SELECT
      COUNT(*) AS total,
      COUNT(DISTINCT token) AS unique_tokens,
      SUM(CASE WHEN ${ELIGIBLE_WHERE} THEN 1 ELSE 0 END) AS eligible
    FROM web_tokens`).first().catch(() => ({}));
  const jobs: any = await db.prepare('SELECT COUNT(*) AS c FROM push_jobs WHERE done = 0').first().catch(() => ({}));
  const recent: any = await db.prepare(
    'SELECT COUNT(*) AS c FROM push_reg_log WHERE created_at >= ?',
  ).bind(nowSec() - 86400).first().catch(() => ({}));
  const eligible = Number(native?.eligible || 0);
  const subscribed = Number(native?.subscribed || 0);
  return {
    native_total: Number(native?.total || 0),
    native_unique: Number(native?.unique_tokens || 0),
    native_eligible: eligible,
    native_opted_out: Number(native?.opted_out || 0),
    native_subscribed: subscribed,
    native_unsubscribed: eligible - subscribed,
    web_total: Number(web?.total || 0),
    web_unique: Number(web?.unique_tokens || 0),
    web_eligible: Number(web?.eligible || 0),
    registrations_24h: Number(recent?.c || 0),
    pending_jobs: Number(jobs?.c || 0),
  };
}

/** Numbers to compare against the "1000 registered users" figure. */
export async function pushDiagnostics(env: Env): Promise<any> {
  const stats = await pushTokenStats(env);
  const byPlatform: any = await env.DB.prepare(
    'SELECT platform, COUNT(*) AS n FROM fcm_tokens GROUP BY platform ORDER BY n DESC',
  ).all().catch(() => ({ results: [] }));
  const byPermission: any = await env.DB.prepare(
    'SELECT permission, notifications_enabled, COUNT(*) AS n FROM fcm_tokens GROUP BY permission, notifications_enabled ORDER BY n DESC',
  ).all().catch(() => ({ results: [] }));
  return {
    ...stats,
    total_tokens: stats.native_total + stats.web_total,
    total_eligible: stats.native_eligible + stats.web_eligible,
    by_platform: byPlatform.results || [],
    by_permission: byPermission.results || [],
    note: 'Firebase Auth users without a row here have NO FCM token on any device and cannot receive push. Tokens can only be created on the device.',
  };
}

export async function listPushRegistrations(env: Env, limit = 30): Promise<any[]> {
  await ensurePushSchema(env);
  const rows: any = await env.DB.prepare(
    'SELECT * FROM push_reg_log ORDER BY created_at DESC LIMIT ?',
  ).bind(Math.max(1, Math.min(Number(limit) || 30, 100))).all().catch(() => ({ results: [] }));
  return rows.results || [];
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
