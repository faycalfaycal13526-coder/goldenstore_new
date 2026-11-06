-- Golden Store — Advanced Push System (2026-11-06)
-- The Worker creates/upgrades all of these via
-- lib/advanced-push.ts → ensureAdvancedSchema(), so this file is optional.
-- Safe to run more than once.
--
-- Apply: wrangler d1 execute goldenstore-db --file=./migrations/20261106_advanced_push.sql

CREATE TABLE IF NOT EXISTS scheduled_pushes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  image_url TEXT,
  click_url TEXT,
  segment_json TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | sending | sent | failed | cancelled
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  error TEXT,
  result_json TEXT
);

CREATE TABLE IF NOT EXISTS push_clicks (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL,
  uid TEXT,
  platform TEXT,
  clicked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_subscriptions (
  uid TEXT NOT NULL,
  app_slug TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (uid, app_slug)
);

-- Activity (users active in the last 7 days) + queue columns for segments.
-- Each ALTER is safe to fail with "duplicate column name".
ALTER TABLE fcm_tokens ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE web_tokens ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE push_jobs   ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE push_jobs   ADD COLUMN tokens TEXT;

-- Indexes MUST come AFTER the ALTERs (legacy-DB regression).
CREATE INDEX IF NOT EXISTS idx_scheduled_pending ON scheduled_pushes(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_push_clicks_note ON push_clicks(notification_id);
CREATE INDEX IF NOT EXISTS idx_app_subs_slug ON app_subscriptions(app_slug);
CREATE INDEX IF NOT EXISTS idx_fcm_last_seen ON fcm_tokens(last_seen_at);

-- Firebase REST consumption (lib/usage.ts)
CREATE TABLE IF NOT EXISTS firebase_usage (
  day TEXT PRIMARY KEY,
  reads INTEGER NOT NULL DEFAULT 0,
  writes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Useful checks
-- SELECT status, COUNT(*) FROM scheduled_pushes GROUP BY status;
-- SELECT notification_id, COUNT(*) FROM push_clicks GROUP BY notification_id;
-- SELECT app_slug, COUNT(*) FROM app_subscriptions GROUP BY app_slug;
-- SELECT date(created_at,'unixepoch') day, COUNT(*) FROM push_send_log GROUP BY day;
