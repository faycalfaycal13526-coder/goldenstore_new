-- Golden Store — reliable FCM broadcast (2026-11-06)
-- The Worker also creates/upgrades these tables automatically via
-- lib/push.ts → ensurePushSchema(), so applying this file manually is
-- optional. Safe to run more than once.
--
-- Apply with: wrangler d1 execute goldenstore-db --file=./migrations/20261106_push_delivery.sql

CREATE TABLE IF NOT EXISTS fcm_tokens (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  uid TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  permission TEXT NOT NULL DEFAULT 'granted',       -- Android 13+ POST_NOTIFICATIONS
  notifications_enabled INTEGER NOT NULL DEFAULT 1, -- explicit opt-in flag
  topic_subscribed INTEGER NOT NULL DEFAULT 0,      -- subscribed to topic `all`
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS web_tokens (
  uid TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'web',
  userAgent TEXT,
  updatedAt INTEGER NOT NULL,
  permission TEXT NOT NULL DEFAULT 'granted',
  notifications_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS push_jobs (
  id TEXT PRIMARY KEY,
  notification_id TEXT,
  payload TEXT NOT NULL,
  cursor TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_send_log (
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
);

CREATE INDEX IF NOT EXISTS idx_fcm_tokens_eligible
  ON fcm_tokens(notifications_enabled, topic_subscribed, id);
CREATE INDEX IF NOT EXISTS idx_web_tokens_eligible
  ON web_tokens(notifications_enabled, permission, uid);
CREATE INDEX IF NOT EXISTS idx_push_send_log_created
  ON push_send_log(created_at DESC);

-- Upgrades for databases created before the consent/topic columns existed.
-- Each statement is safe to fail with "duplicate column name".
ALTER TABLE fcm_tokens ADD COLUMN permission TEXT NOT NULL DEFAULT 'granted';
ALTER TABLE fcm_tokens ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE fcm_tokens ADD COLUMN topic_subscribed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE web_tokens ADD COLUMN permission TEXT NOT NULL DEFAULT 'granted';
ALTER TABLE web_tokens ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 1;
