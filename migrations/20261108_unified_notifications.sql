-- Golden Store — UNIFIED NOTIFICATION SYSTEM (2026-11-08)
-- One device registry, one exactly-once delivery ledger, one payload, one engine.
-- Safe to run on an existing D1 database: every statement is idempotent.

CREATE TABLE IF NOT EXISTS push_devices (
  token TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  channel TEXT NOT NULL,                       -- 'native' | 'web'
  platform TEXT NOT NULL DEFAULT 'android',
  installation_id TEXT NOT NULL DEFAULT '',   -- stable per physical device
  permission TEXT NOT NULL DEFAULT 'granted',
  notifications_enabled INTEGER NOT NULL DEFAULT 1,
  topic_subscribed INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS push_delivery (
  notification_id TEXT NOT NULL,
  token TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | sent | failed
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (notification_id, token)
);

CREATE TABLE IF NOT EXISTS push_receipts (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL,
  uid_masked TEXT,
  channel TEXT,
  event TEXT NOT NULL,                        -- displayed | clicked | registered
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_devices_uid
  ON push_devices(uid, channel, notifications_enabled);
CREATE INDEX IF NOT EXISTS idx_push_devices_install
  ON push_devices(uid, installation_id, channel, updated_at);
CREATE INDEX IF NOT EXISTS idx_push_delivery_note
  ON push_delivery(notification_id, status);
CREATE INDEX IF NOT EXISTS idx_push_receipts_note
  ON push_receipts(notification_id, created_at);

-- Legacy compatibility columns (each ALTER may already exist).
ALTER TABLE fcm_tokens ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE web_tokens ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fcm_tokens ADD COLUMN installation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE web_tokens ADD COLUMN installation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE push_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE push_jobs ADD COLUMN tokens TEXT;

-- Backfill: one canonical row per token. `INSERT OR IGNORE` keeps the Web Push
-- row when a token was (wrongly) stored in both tables before the unification.
INSERT OR IGNORE INTO push_devices
  (token, uid, channel, platform, installation_id, permission,
   notifications_enabled, topic_subscribed, last_seen_at, updated_at)
SELECT token, uid, 'native', COALESCE(platform, 'android'),
  COALESCE(installation_id, ''), COALESCE(permission, 'granted'),
  COALESCE(notifications_enabled, 1), COALESCE(topic_subscribed, 0),
  COALESCE(NULLIF(last_seen_at, 0), updated_at, 0), COALESCE(updated_at, 0)
FROM fcm_tokens WHERE token != '';

INSERT OR IGNORE INTO push_devices
  (token, uid, channel, platform, installation_id, permission,
   notifications_enabled, topic_subscribed, last_seen_at, updated_at)
SELECT token, uid, 'web', 'web', COALESCE(installation_id, ''),
  COALESCE(permission, 'granted'), COALESCE(notifications_enabled, 1), 0,
  COALESCE(NULLIF(last_seen_at, 0), updatedAt, 0), COALESCE(updatedAt, 0)
FROM web_tokens WHERE token != '';
