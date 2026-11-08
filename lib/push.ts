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
  messaging, sendWebPush, sendFcmToEntries,
  subscribeTokenToTopic, unsubscribeTokenFromTopic, mapWithConcurrency,
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
  /* ---- UNIFIED NOTIFICATION SYSTEM (single device registry + exactly-once
     delivery ledger). These tables are the ONE source of truth for every
     channel: browser Web Push AND native Android/iOS FCM. ---- */
  `CREATE TABLE IF NOT EXISTS push_devices (
     token TEXT PRIMARY KEY,
     uid TEXT NOT NULL,
     channel TEXT NOT NULL,
     platform TEXT NOT NULL DEFAULT 'android',
     installation_id TEXT NOT NULL DEFAULT '',
     permission TEXT NOT NULL DEFAULT 'granted',
     notifications_enabled INTEGER NOT NULL DEFAULT 1,
     topic_subscribed INTEGER NOT NULL DEFAULT 0,
     last_seen_at INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS push_delivery (
     notification_id TEXT NOT NULL,
     token TEXT NOT NULL,
     channel TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (notification_id, token)
   )`,
  `CREATE TABLE IF NOT EXISTS push_receipts (
     id TEXT PRIMARY KEY,
     notification_id TEXT NOT NULL,
     uid_masked TEXT,
     channel TEXT,
     event TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  /* Shared by the segmentation engine; created here too so a pure push.ts
     deployment never fails on an `app` segment. */
  `CREATE TABLE IF NOT EXISTS app_subscriptions (
     uid TEXT NOT NULL,
     app_slug TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (uid, app_slug)
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
  `ALTER TABLE fcm_tokens ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE web_tokens ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE fcm_tokens ADD COLUMN installation_id TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE web_tokens ADD COLUMN installation_id TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE push_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy'`,
  `ALTER TABLE push_jobs ADD COLUMN tokens TEXT`,
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
  `CREATE INDEX IF NOT EXISTS idx_push_devices_uid
     ON push_devices(uid, channel, notifications_enabled)`,
  `CREATE INDEX IF NOT EXISTS idx_push_devices_install
     ON push_devices(uid, installation_id, channel, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_push_delivery_note
     ON push_delivery(notification_id, status)`,
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
  // Migrate pre-unification rows into the single device registry once per
  // Worker isolate. Without this, existing installations would keep being
  // addressed by two independent engines (the source of triple notifications).
  await backfillDevices(env).catch((e: any) =>
    console.warn('[notify] backfill skipped:', e?.message || String(e)));
}

/* -------------------------------------------------------------------------
   Canonical device registry
   -------------------------------------------------------------------------
   Before the unified engine, a single physical device could be present in
   `fcm_tokens` (topic + direct) AND `web_tokens` (Web Push), and token
   rotation left several stale FCM rows for the same uid. A broadcast then
   sent that user 2–3 separate FCM messages → 2–3 OS notifications.

   `push_devices` is the ONE source of truth. `backfillDevices()` copies the
   legacy rows into it, deletes cross-channel duplicates and unsubscribes the
   removed native rows from the FCM topic, so a device can never be reached
   by two delivery paths again.
   ------------------------------------------------------------------------- */
export async function backfillDevices(env: Env): Promise<any> {
  const db: any = env.DB;
  const summary: any = { native: 0, web: 0, overlap_removed: 0, unsubscribed: 0 };

  // A token that is in BOTH tables is a browser token registered twice.
  // Keep the Web Push row (data-only payload) and drop the native row, because
  // sending an Android `notification` block to a Web Push endpoint is what
  // makes Chrome display a second, SDK-generated notification.
  const overlap: any = await db.prepare(
    `SELECT f.token AS token FROM fcm_tokens f
       INNER JOIN web_tokens w ON w.token = f.token`,
  ).all().catch(() => ({ results: [] }));
  const overlapTokens: string[] = (overlap.results || [])
    .map((r: any) => String(r.token || '')).filter(Boolean);
  if (overlapTokens.length) {
    await mapWithConcurrency(overlapTokens, 10, async (token: string) => {
      await db.prepare('DELETE FROM fcm_tokens WHERE token = ?').bind(token).run().catch(() => {});
      await db.prepare('DELETE FROM push_devices WHERE token = ? AND channel = ?')
        .bind(token, 'native').run().catch(() => {});
      await unsubscribeTokenFromTopic(env, token, FCM_TOPIC).catch(() => {});
      summary.overlap_removed++;
      summary.unsubscribed++;
    });
  }

  const n: any = await db.prepare(`INSERT OR IGNORE INTO push_devices
      (token, uid, channel, platform, installation_id, permission,
       notifications_enabled, topic_subscribed, last_seen_at, updated_at)
    SELECT token, uid, 'native', COALESCE(platform, 'android'),
      COALESCE(installation_id, ''), COALESCE(permission, 'granted'),
      COALESCE(notifications_enabled, 1), COALESCE(topic_subscribed, 0),
      COALESCE(NULLIF(last_seen_at, 0), updated_at, 0), COALESCE(updated_at, 0)
    FROM fcm_tokens WHERE token != ''`).run().catch((e: any) => {
      console.warn('[notify] native backfill skipped:', e?.message || String(e)); return null;
    });
  if (n) summary.native = Number(n.meta?.changes ?? n.changes ?? 0);

  const w: any = await db.prepare(`INSERT OR IGNORE INTO push_devices
      (token, uid, channel, platform, installation_id, permission,
       notifications_enabled, topic_subscribed, last_seen_at, updated_at)
    SELECT token, uid, 'web', 'web', COALESCE(installation_id, ''),
      COALESCE(permission, 'granted'), COALESCE(notifications_enabled, 1), 0,
      COALESCE(NULLIF(last_seen_at, 0), updatedAt, 0), COALESCE(updatedAt, 0)
    FROM web_tokens WHERE token != ''`).run().catch((e: any) => {
      console.warn('[notify] web backfill skipped:', e?.message || String(e)); return null;
    });
  if (w) summary.web = Number(w.meta?.changes ?? w.changes ?? 0);
  return summary;
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
  channel?: 'native' | 'web';   // unified-engine alias for `web`
  installation_id?: string;     // stable id of the physical device / browser profile
  platform?: string;
  permission?: string;
  enabled?: boolean;
  userAgent?: string;
};

export async function registerPushToken(env: Env, input: TokenRegistration): Promise<any> {
  await ensurePushSchema(env);
  // Unified callers pass `channel`; legacy callers pass `web`. Normalise once
  // so every registration goes through the exact same dedupe path.
  if (input.channel === 'web' && !input.web) (input as any).web = true;
  const db: any = env.DB;
  const token = String(input.token || '').trim();
  const installationId = String(input.installation_id || '').slice(0, 120);
  const permission = normalizePermission(input.permission);
  // The token is ALWAYS stored. Consent is a SEPARATE field used only when
  // building the audience — deleting a device because the user once tapped
  // "no" makes that user permanently unreachable from the server side.
  const enabled = input.enabled !== false && permission !== 'denied';
  const platform = input.web ? 'web' : String(input.platform || 'android').slice(0, 40);

  const id = await sha256Hex(token);
  let topicSubscribed = false;
  const channel: 'native' | 'web' = input.web ? 'web' : 'native';

  /* ---- EXACTLY ONE DEVICE = ONE ACTIVE TOKEN -----------------------------
     Two independent registrations used to run on the same page: the Web Push
     client (/register-web) and the native bridge (/register-token). Both rows
     stayed in D1 forever, and FCM token rotation added even more rows for the
     same uid. Every row got its own FCM message → 3 identical notifications.

     Here we (1) remove the same token from the opposite channel and (2) keep
     only the newest token per (uid, installation_id, channel). Deleted native
     rows are unsubscribed from the topic so they cannot receive a topic
     message after being removed from our registry. */
  if (input.web) {
    const cross: any = await db.prepare('SELECT token FROM fcm_tokens WHERE token = ?')
      .bind(token).first().catch(() => null);
    if (cross) {
      await db.prepare('DELETE FROM fcm_tokens WHERE token = ?').bind(token).run().catch(() => {});
      await unsubscribeTokenFromTopic(env, token, FCM_TOPIC).catch(() => {});
    }
    await db.prepare('DELETE FROM push_devices WHERE token = ? AND channel = ?')
      .bind(token, 'native').run().catch(() => {});
  } else {
    await db.prepare('DELETE FROM web_tokens WHERE token = ?').bind(token).run().catch(() => {});
    await db.prepare('DELETE FROM push_devices WHERE token = ? AND channel = ?')
      .bind(token, 'web').run().catch(() => {});
  }
  if (installationId) {
    // Device-level exclusivity: a phone that has BOTH a native FCM token and a
    // WebView Web Push token must keep only the newest one, otherwise the two
    // channels would each display an OS notification for the same message.
    const stale: any = await db.prepare(
      `SELECT token, channel FROM push_devices
        WHERE uid = ? AND installation_id = ? AND token != ?`,
    ).bind(input.uid, installationId, token).all().catch(() => ({ results: [] }));
    for (const old of (stale.results || []) as any[]) {
      const oldToken = String(old.token || '');
      if (!oldToken) continue;
      await db.prepare('DELETE FROM push_devices WHERE token = ?').bind(oldToken).run().catch(() => {});
      if (old.channel === 'native') {
        await db.prepare('DELETE FROM fcm_tokens WHERE token = ?').bind(oldToken).run().catch(() => {});
        await unsubscribeTokenFromTopic(env, oldToken, FCM_TOPIC).catch(() => {});
      } else {
        await db.prepare('DELETE FROM web_tokens WHERE token = ?').bind(oldToken).run().catch(() => {});
      }
    }
  }

  if (input.web) {
    await db.prepare(`INSERT OR REPLACE INTO web_tokens
        (uid, token, platform, userAgent, updatedAt, permission, notifications_enabled)
        VALUES (?, ?, 'web', ?, ?, ?, ?)`)
      .bind(input.uid, token, String(input.userAgent || '').slice(0, 300),
        nowSec(), permission, enabled ? 1 : 0).run();
    await db.prepare('UPDATE web_tokens SET installation_id = ? WHERE uid = ?')
      .bind(installationId, input.uid).run().catch(() => {});
    await db.prepare('UPDATE web_tokens SET last_seen_at = ? WHERE uid = ?')
      .bind(nowSec(), input.uid).run().catch(() => {});
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
    await db.prepare('UPDATE fcm_tokens SET installation_id = ? WHERE id = ?')
      .bind(installationId, id).run().catch(() => {});
    await db.prepare('UPDATE fcm_tokens SET last_seen_at = ? WHERE id = ?')
      .bind(nowSec(), id).run().catch(() => {});
  }

  // Canonical registry row — the unified delivery engine reads ONLY this.
  await db.prepare(`INSERT OR REPLACE INTO push_devices
      (token, uid, channel, platform, installation_id, permission,
       notifications_enabled, topic_subscribed, last_seen_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(token, input.uid, channel, platform, installationId, permission,
      enabled ? 1 : 0, topicSubscribed ? 1 : 0, nowSec(), nowSec()).run().catch(() => {});

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
  await db.prepare(`UPDATE push_devices SET permission = ?, notifications_enabled = ?,
      last_seen_at = ? WHERE uid = ? AND channel = ?`)
    .bind(permission, enabled, nowSec(), uid, isWeb ? 'web' : 'native').run().catch(() => {});
  if (isWeb) {
    await db.prepare('UPDATE web_tokens SET permission = ?, notifications_enabled = ?, last_seen_at = ? WHERE uid = ?')
      .bind(permission, enabled, nowSec(), uid).run().catch(() => {
        // Column may not exist yet on a legacy DB; retry without it.
        return db.prepare('UPDATE web_tokens SET permission = ?, notifications_enabled = ? WHERE uid = ?')
          .bind(permission, enabled, uid).run().catch(() => {});
      });
    return { ok: true, platform: 'web', permission, notifications_enabled: !!enabled };
  }

  await db.prepare('UPDATE fcm_tokens SET permission = ?, notifications_enabled = ?, last_seen_at = ? WHERE uid = ?')
    .bind(permission, enabled, nowSec(), uid).run().catch(async () => {
      await db.prepare('UPDATE fcm_tokens SET permission = ?, notifications_enabled = ? WHERE uid = ?')
        .bind(permission, enabled, uid).run().catch(() => {});
    });

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
      if (sub?.ok) {
        await db.prepare('UPDATE fcm_tokens SET topic_subscribed = 1 WHERE token = ?').bind(token).run().catch(() => {});
        await db.prepare("UPDATE push_devices SET topic_subscribed = 1 WHERE token = ? AND channel = 'native'")
          .bind(token).run().catch(() => {});
      }
    } else {
      await unsubscribeTokenFromTopic(env, token, FCM_TOPIC).catch(() => {});
      await db.prepare('UPDATE fcm_tokens SET topic_subscribed = 0 WHERE token = ?').bind(token).run().catch(() => {});
      await db.prepare("UPDATE push_devices SET topic_subscribed = 0 WHERE token = ? AND channel = 'native'")
        .bind(token).run().catch(() => {});
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
  await db.prepare('DELETE FROM push_devices WHERE token = ?').bind(token).run().catch(() => {});
  await unsubscribeTokenFromTopic(env, token, FCM_TOPIC).catch(() => {});
}

/* -------------------------------------------------------------------------
   Payload
   ------------------------------------------------------------------------- */
function storeLogoUrl(env: Env): string {
  return env.STORE_LOGO_URL || `https://${env.STORE_DOMAIN || 'goldenstore.online'}/images/logo.png`;
}

/** Only same-origin relative paths and http(s) absolute URLs are allowed in
    a push payload — never javascript:, data: or an external open redirect. */
export function safeUrl(raw: unknown): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.charAt(0) === '/' && value.charAt(1) !== '/') return value.slice(0, 2000);
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString().slice(0, 2000);
  } catch { return ''; }
}

/** THE single payload builder. Both the "normal" and the "advanced" engines
    now use this exact object, so a device gets one identical message no
    matter which admin screen published it. */
export function buildPushPayload(env: Env, n: any) {
  const image = safeUrl(n.image_url || n.image);
  const click = safeUrl(n.click_url || (n.app_slug ? `/app?slug=${encodeURIComponent(n.app_slug)}` : ''));
  const data: Record<string, string> = {
    title: String(n.title || ''), body: String(n.body || ''),
    type: String(n.type || 'announcement'), app_slug: String(n.app_slug || ''),
    notification_id: String(n.id || ''), image,
    click_url: click,
    store_logo: storeLogoUrl(env),
  };
  if (n.data) { try { data.extra = JSON.stringify(n.data); } catch { /* ignore */ } }
  const androidNotification: Record<string, unknown> = {
    title: String(n.title || ''), body: String(n.body || ''),
    channelId: 'goldenstore_notifications', color: '#f4c01f', visibility: 'public',
  };
  if (image) androidNotification.image = image;
  return {
    data,
    notification: { title: String(n.title || ''), body: String(n.body || '') },
    android: { priority: 'high', notification: androidNotification },
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
    await db.batch(unique.flatMap((token) => [
      db.prepare('DELETE FROM fcm_tokens WHERE token = ?').bind(token),
      db.prepare('DELETE FROM push_devices WHERE token = ?').bind(token),
    ]));
  } catch {
    // Some D1 shims do not implement batch(); fall back to sequential deletes.
    for (const token of unique) {
      await db.prepare('DELETE FROM fcm_tokens WHERE token = ?').bind(token).run().catch(() => {});
      await db.prepare('DELETE FROM web_tokens WHERE token = ?').bind(token).run().catch(() => {});
      await db.prepare('DELETE FROM push_devices WHERE token = ?').bind(token).run().catch(() => {});
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
        await db.prepare("UPDATE push_devices SET topic_subscribed = 1 WHERE token = ? AND channel = 'native'")
          .bind(token).run().catch(() => {});
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

/* =========================================================================
   UNIFIED NOTIFICATION ENGINE — the ONE delivery pipeline
   -------------------------------------------------------------------------
   Every publisher (normal notification, advanced/segmented send, scheduled
   push, app upload, app update, admin self-test, Cron) goes through
   `deliverNotification()`. There is exactly ONE audience resolver, ONE
   payload builder, ONE delivery ledger and ONE queue processor.

   Guarantees:
   * one physical device = one active token (rotation + cross-channel dedupe)
   * one notification = at most ONE FCM message per device (push_delivery PK)
   * Web Push is ALWAYS data-only → no SDK auto-display + SW display double
   * native messages carry a stable collapse_key/tag → OS replaces duplicates
   * retries / Cron / manual flush are idempotent
   * overflow is queued and drained automatically by the Cron trigger
   ========================================================================= */
export type DeliverySegment = {
  mode?: 'all' | 'uid' | 'token' | 'platform' | 'app' | 'active';
  uid?: string; token?: string; platform?: string; app_slug?: string; days?: number;
};
export type DeliveryOptions = {
  force?: boolean;           // bypass the "already delivered" short-circuit
  limit?: number;            // max direct sends in this Worker invocation
  retry_failed?: boolean;    // re-send rows previously marked failed
};
export type DeliveryDevice = {
  token: string; uid: string; channel: 'native' | 'web';
  platform: string; installation_id: string; topic_subscribed: boolean;
};

export async function resolveUnifiedAudience(
  env: Env, segment: DeliverySegment = { mode: 'all' },
): Promise<{ entries: DeliveryDevice[]; native_count: number; web_count: number;
  targeted: number; duplicates_suppressed: number }> {
  await ensurePushSchema(env);
  await backfillDevices(env);
  const db: any = env.DB;
  const modes = ['all', 'uid', 'token', 'platform', 'app', 'active'];
  const mode = modes.includes(String(segment.mode || 'all')) ? String(segment.mode || 'all') : 'all';
  let where = `COALESCE(notifications_enabled, 1) = 1
    AND COALESCE(permission, 'granted') != 'denied' AND token != ''`;
  const args: any[] = [];
  if (mode === 'uid') { where += ' AND uid = ?'; args.push(String(segment.uid || '')); }
  else if (mode === 'token') { where += ' AND token = ?'; args.push(String(segment.token || '')); }
  else if (mode === 'platform') {
    const pl = String(segment.platform || 'android').toLowerCase();
    if (pl === 'web') where += " AND channel = 'web'";
    else { where += " AND channel = 'native' AND LOWER(COALESCE(platform, 'android')) = ?"; args.push(pl); }
  } else if (mode === 'app') {
    where += ' AND uid IN (SELECT uid FROM app_subscriptions WHERE app_slug = ?)';
    args.push(String(segment.app_slug || ''));
  } else if (mode === 'active') {
    const days = Math.max(1, Math.min(Number(segment.days) || 7, 90));
    where += ' AND COALESCE(NULLIF(last_seen_at, 0), updated_at, 0) >= ?';
    args.push(nowSec() - days * 86400);
  }
  const rows: any = await db.prepare(
    `SELECT token, uid, channel, platform, installation_id, topic_subscribed,
       updated_at, last_seen_at FROM push_devices
      WHERE ${where} ORDER BY updated_at DESC, token`,
  ).bind(...args).all().catch(() => ({ results: [] }));

  const seenTokens = new Set<string>();
  const seenInstall = new Set<string>();
  const entries: DeliveryDevice[] = [];
  let duplicates = 0;
  for (const r of (rows.results || []) as any[]) {
    const token = String(r.token || '').trim();
    if (!token) continue;
    const install = String(r.installation_id || '');
    if (install) {
      const key = `${r.uid}|${install}|${r.channel}`;
      if (seenInstall.has(key)) { duplicates++; continue; }
      seenInstall.add(key);
    }
    if (seenTokens.has(token)) { duplicates++; continue; }
    seenTokens.add(token);
    entries.push({
      token, uid: String(r.uid || ''),
      channel: String(r.channel) === 'web' ? 'web' : 'native',
      platform: String(r.platform || 'android'), installation_id: install,
      topic_subscribed: Number(r.topic_subscribed || 0) === 1,
    });
  }
  return {
    entries, targeted: entries.length,
    native_count: entries.filter((e) => e.channel === 'native').length,
    web_count: entries.filter((e) => e.channel === 'web').length,
    duplicates_suppressed: duplicates,
  };
}

/** Atomically reserve (notification_id, token) pairs. A token that is already
    `sent` is never sent again — this is the exact-once guarantee behind
    retries, Cron drains and the manual flush button. */
async function reserveDelivery(
  env: Env, notificationId: string, devices: DeliveryDevice[], retryFailed = false,
): Promise<DeliveryDevice[]> {
  if (!devices.length) return [];
  const db: any = env.DB;
  const now = nowSec();
  const stmt = `INSERT OR IGNORE INTO push_delivery
      (notification_id, token, channel, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)`;
  try {
    await db.batch(devices.map((d) =>
      db.prepare(stmt).bind(notificationId, d.token, d.channel, now, now)));
  } catch {
    for (const d of devices) {
      await db.prepare(stmt).bind(notificationId, d.token, d.channel, now, now).run().catch(() => {});
    }
  }
  const rows: any = await db.prepare(
    'SELECT token, status FROM push_delivery WHERE notification_id = ?',
  ).bind(notificationId).all().catch(() => ({ results: [] }));
  const status = new Map<string, string>();
  for (const r of (rows.results || []) as any[]) status.set(String(r.token), String(r.status));
  return devices.filter((d) => {
    const st = status.get(d.token);
    return st !== 'sent' && (retryFailed || st === 'pending');
  });
}

async function markDelivery(
  env: Env, notificationId: string, tokens: string[], status: 'sent' | 'failed',
): Promise<void> {
  if (!tokens.length) return;
  const db: any = env.DB;
  const stmt = 'UPDATE push_delivery SET status = ?, updated_at = ? WHERE notification_id = ? AND token = ?';
  try {
    await db.batch(tokens.map((t) => db.prepare(stmt).bind(status, nowSec(), notificationId, t)));
  } catch {
    for (const t of tokens) {
      await db.prepare(stmt).bind(status, nowSec(), notificationId, t).run().catch(() => {});
    }
  }
}

/** ONE queue processor for every kind of job (`unified` and legacy
    `advanced`). Cursor + ledger together guarantee no device is skipped and
    no device is sent twice. */
export async function processDeliveryJob(
  env: Env, jobId: string, limit = FCM_MAX_DIRECT_PER_SEND,
): Promise<any> {
  await ensurePushSchema(env);
  const db: any = env.DB;
  const job: any = await db.prepare('SELECT * FROM push_jobs WHERE id = ?').bind(jobId).first();
  if (!job) {
    return { processed: 0, success: 0, failure: 0, invalid_removed: 0,
      pending: 0, done: true, errors: ['job_not_found'] };
  }
  let entries: DeliveryDevice[] = [];
  try { entries = JSON.parse(String(job.tokens || '[]')); } catch { entries = []; }
  // Legacy `push_jobs` rows store no token list; keep their original cursor
  // behaviour so imported/old jobs still drain.
  if (!entries.length) return processPushJob(env, jobId, limit);

  let payload: any = {};
  try { payload = JSON.parse(String(job.payload || '{}')); } catch { payload = {}; }
  const notificationId = String(job.notification_id || payload?.data?.notification_id || jobId);
  const cap = Math.max(1, Math.min(Number(limit) || FCM_MAX_DIRECT_PER_SEND, FCM_MAX_DIRECT_PER_SEND));
  const offset = Number(job.cursor || 0);
  const slice = entries.slice(offset, offset + cap);
  const eligible = await reserveDelivery(env, notificationId, slice);
  const duplicatesSuppressed = slice.length - eligible.length;
  const sent = await sendFcmToEntries(
    env,
    eligible.map((e) => ({ token: e.token, channel: e.channel })),
    payload, { notification_id: notificationId },
  );
  const invalid = new Set(sent.invalid);
  await markDelivery(env, notificationId,
    eligible.filter((e) => !invalid.has(e.token)).map((e) => e.token), 'sent');
  if (invalid.size) {
    await markDelivery(env, notificationId, Array.from(invalid), 'failed');
  }
  const invalidRemoved = invalid.size ? await deleteDeadTokens(env, Array.from(invalid)) : 0;
  const next = offset + slice.length;
  const pending = Math.max(0, entries.length - next);
  await db.prepare('UPDATE push_jobs SET cursor = ?, done = ?, updated_at = ? WHERE id = ?')
    .bind(String(next), pending > 0 ? 0 : 1, nowSec(), jobId).run();
  return {
    processed: slice.length, success: sent.success, failure: sent.failure,
    invalid_removed: invalidRemoved, errors: sent.errors,
    error_counts: sent.error_counts || {}, pending, done: pending === 0,
    duplicates_suppressed: duplicatesSuppressed,
  };
}

/** Drain every pending unified job — called by the Cron trigger so a large
    audience finishes without the admin pressing "flush" manually. */
export async function drainDeliveryJobs(env: Env, maxJobs = 6): Promise<any> {
  await ensurePushSchema(env);
  const db: any = env.DB;
  const jobs: any = await db.prepare(
    `SELECT id FROM push_jobs WHERE done = 0 AND COALESCE(kind, 'legacy') IN ('unified', 'advanced')
       AND COALESCE(tokens, '') != '' ORDER BY created_at ASC LIMIT ?`,
  ).bind(Math.max(1, Math.min(Number(maxJobs) || 6, 30))).all().catch(() => ({ results: [] }));
  let processed = 0, done = 0;
  for (const j of (jobs.results || []) as any[]) {
    const r = await processDeliveryJob(env, String(j.id)).catch(() => null);
    if (r) { processed += Number(r.processed || 0); if (r.done) done++; }
  }
  return { jobs: (jobs.results || []).length, processed, done };
}

export async function deliverNotification(
  env: Env, note: any,
  segment: DeliverySegment = { mode: 'all' },
  options: DeliveryOptions = {},
): Promise<any> {
  const started = Date.now();
  await ensurePushSchema(env);
  await backfillDevices(env);
  const db: any = env.DB;
  const id = String(note.id || randomId());
  const mode = String(segment?.mode || 'all');
  const payload = buildPushPayload(env, { ...note, id });
  const result: any = {
    id, segment, channel: 'unified',
    targeted: 0, topic_targeted: 0, direct_targeted: 0, web_targeted: 0,
    success: 0, failure: 0, invalid_removed: 0, pending: 0, topic_sent: false,
    errors: [], error_counts: {}, job_id: null, duration_ms: 0,
    duplicates_suppressed: 0, native_count: 0, web_count: 0, logged: true,
  };

  // Idempotency short-circuit: a replayed webhook / double click / Cron retry
  // must not publish the same notification twice.
  if (!options.force) {
    const prior: any = await db.prepare(
      "SELECT COUNT(*) AS c FROM push_delivery WHERE notification_id = ? AND status = 'sent'",
    ).bind(id).first().catch(() => ({ c: 0 }));
    if (Number(prior?.c || 0) > 0) {
      result.skipped = 'already_delivered';
      result.duration_ms = Date.now() - started;
      return result;
    }
  }

  const audience = await resolveUnifiedAudience(env, segment);
  result.duplicates_suppressed = audience.duplicates_suppressed;
  result.native_count = audience.native_count;
  result.web_count = audience.web_count;

  // A) ONE topic message covers native devices already subscribed. Topic
  //    membership is native-only, so browser tokens are NEVER in this path.
  const topicAll = mode === 'all'
    ? audience.entries.filter((e) => e.channel === 'native' && e.topic_subscribed)
    : [];
  const topicReserved = await reserveDelivery(env, id, topicAll, !!options.retry_failed);
  result.topic_targeted = topicReserved.length;
  if (topicReserved.length) {
    try {
      const msg = await messaging(env);
      const collapseKey = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      const android: any = (payload.android || {}) as any;
      await msg.send({
        topic: FCM_TOPIC,
        ...payload,
        android: {
          ...android,
          collapse_key: collapseKey,
          notification: { ...(android.notification || {}), tag: collapseKey },
        },
      });
      result.topic_sent = true;
      result.success += topicReserved.length;
      await markDelivery(env, id, topicReserved.map((e) => e.token), 'sent');
    } catch (error: any) {
      result.failure += topicReserved.length;
      const code = String(error?.code || 'topic_send_failed');
      result.error_counts[code] = (result.error_counts[code] || 0) + 1;
      result.errors.push(`topic_send_failed: ${error?.message || String(error)}`);
      await markDelivery(env, id, topicReserved.map((e) => e.token), 'failed');
      console.error('[notify] topic send failed', { code, message: error?.message });
    }
  }

  // B) Everything else (native unsubscribed + ALL browser devices, plus every
  //    segmented target) is delivered DIRECTLY. topicAll tokens are excluded
  //    even when already delivered, so no device is ever on two paths.
  const topicTokens = new Set(topicAll.map((e) => e.token));
  const directAll = audience.entries.filter((e) => !topicTokens.has(e.token));
  const direct = await reserveDelivery(env, id, directAll, !!options.retry_failed);
  result.duplicates_suppressed += directAll.length - direct.length;
  const nativeDirect = direct.filter((e) => e.channel === 'native');
  const webDirect = direct.filter((e) => e.channel === 'web');
  result.direct_targeted = nativeDirect.length;
  result.web_targeted = webDirect.length;

  const cap = Math.max(1, Math.min(Number(options.limit) || FCM_MAX_DIRECT_PER_SEND,
    FCM_MAX_DIRECT_PER_SEND));
  if (direct.length > cap) {
    const jobId = randomId();
    await db.prepare(`INSERT INTO push_jobs
        (id, notification_id, payload, cursor, done, created_at, updated_at, kind, tokens)
        VALUES (?, ?, ?, '0', 0, ?, ?, 'unified', ?)`)
      .bind(jobId, id, JSON.stringify(payload), nowSec(), nowSec(), JSON.stringify(direct)).run();
    result.job_id = jobId;
    const chunk: any = await processDeliveryJob(env, jobId, cap);
    // Only the chunk processed in THIS invocation counts as targeted now;
    // the rest is reported as `pending`. Otherwise targeted would count the
    // same device twice (once in web_targeted and once in pending).
    const processedSlice = direct.slice(0, cap);
    result.direct_targeted = processedSlice.filter((e) => e.channel === 'native').length;
    result.web_targeted = processedSlice.filter((e) => e.channel === 'web').length;
    result.success += chunk.success;
    result.failure += chunk.failure;
    result.invalid_removed += chunk.invalid_removed;
    result.pending = chunk.pending;
    result.errors.push(...chunk.errors);
    for (const [code, count] of Object.entries(chunk.error_counts || {})) {
      result.error_counts[code] = (result.error_counts[code] || 0) + Number(count);
    }
  } else if (direct.length) {
    const sent = await sendFcmToEntries(
      env, direct.map((e) => ({ token: e.token, channel: e.channel })),
      payload, { notification_id: id },
    );
    result.success += sent.success;
    result.failure += sent.failure;
    result.errors.push(...sent.errors);
    for (const [code, count] of Object.entries(sent.error_counts || {})) {
      result.error_counts[code] = (result.error_counts[code] || 0) + Number(count);
    }
    const invalid = new Set(sent.invalid);
    await markDelivery(env, id, direct.filter((e) => !invalid.has(e.token))
      .map((e) => e.token), 'sent');
    if (invalid.size) {
      await markDelivery(env, id, Array.from(invalid), 'failed');
      result.invalid_removed = await deleteDeadTokens(env, Array.from(invalid));
    }
  }

  result.targeted = result.topic_targeted + result.direct_targeted
    + result.web_targeted + result.pending;
  result.duration_ms = Date.now() - started;
  await recordPushLog(env, id, result);
  console.log(JSON.stringify({
    level: 'info', event: 'notify_delivery', notification_id: id, mode,
    targeted: result.targeted, topic_targeted: result.topic_targeted,
    direct_targeted: result.direct_targeted, web_targeted: result.web_targeted,
    success: result.success, failure: result.failure,
    duplicates_suppressed: result.duplicates_suppressed,
    pending: result.pending, duration_ms: result.duration_ms,
  }));
  return result;
}

/** Unified status used by the admin Notification Center and support. */
export async function notificationDiagnostics(env: Env): Promise<any> {
  await ensurePushSchema(env);
  await backfillDevices(env);
  const db: any = env.DB;
  const byChannel: any = await db.prepare(
    `SELECT channel, COUNT(*) AS total,
       SUM(CASE WHEN COALESCE(notifications_enabled,1)=1
         AND COALESCE(permission,'granted') != 'denied' THEN 1 ELSE 0 END) AS eligible
       FROM push_devices GROUP BY channel`,
  ).all().catch(() => ({ results: [] }));
  const dupes: any = await db.prepare(
    `SELECT COUNT(*) AS c FROM push_devices WHERE installation_id != ''`,
  ).first().catch(() => ({ c: 0 }));
  const delivery: any = await db.prepare(
    `SELECT status, COUNT(*) AS c FROM push_delivery GROUP BY status`,
  ).all().catch(() => ({ results: [] }));
  const jobs: any = await db.prepare(
    `SELECT COUNT(*) AS c FROM push_jobs WHERE done = 0 AND COALESCE(kind,'legacy') = 'unified'`,
  ).first().catch(() => ({ c: 0 }));
  const stats = await pushTokenStats(env);
  const channels: Record<string, any> = {};
  for (const r of (byChannel.results || []) as any[]) {
    channels[String(r.channel)] = { total: Number(r.total || 0), eligible: Number(r.eligible || 0) };
  }
  return {
    ok: true, engine: 'unified',
    channels,
    devices_total: (channels.native?.total || 0) + (channels.web?.total || 0),
    devices_eligible: (channels.native?.eligible || 0) + (channels.web?.eligible || 0),
    installations_tracked: Number(dupes?.c || 0),
    delivery: Object.fromEntries((delivery.results || []).map((r: any) =>
      [String(r.status), Number(r.c || 0)])),
    pending_jobs: Number(jobs?.c || 0),
    legacy: stats,
    note: 'A device is present once in push_devices; push_delivery guarantees one FCM message per notification per device.',
  };
}

/** Client receipt (displayed / clicked / dismissed) for real diagnostics. */
export async function recordPushReceipt(
  env: Env, notificationId: string, uid = '', channel = '', event = 'displayed',
): Promise<void> {
  await ensurePushSchema(env);
  await env.DB.prepare(`INSERT INTO push_receipts
      (id, notification_id, uid_masked, channel, event, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(randomId(), String(notificationId).slice(0, 120), String(uid).slice(0, 8),
      String(channel).slice(0, 20), String(event).slice(0, 30), nowSec()).run().catch(() => {});
}

/* -------------------------------------------------------------------------
   Compatibility wrappers — "normal" and "advanced" are now the SAME engine.
   ------------------------------------------------------------------------- */
export type BroadcastResult = {
  targeted: number; topic_targeted: number; direct_targeted: number; web_targeted: number;
  success: number; failure: number; invalid_removed: number; pending: number;
  topic_sent: boolean; errors: string[]; error_counts: Record<string, number>;
  job_id: string | null; duration_ms: number;
};
export async function broadcastPush(env: Env, n: any): Promise<BroadcastResult> {
  const r = await deliverNotification(env, n, { mode: 'all' });
  return r as BroadcastResult;
}


/** Unified alias used by /api/notifications/register-device. */
export const registerDevice = registerPushToken;
