-- Golden Store — audience completeness (2026-11-06)
-- Creates the sync cursor + registration-log tables used by lib/push.ts.
-- The Worker also creates them automatically via ensurePushSchema().
-- Safe to run more than once.
--
-- Apply: wrangler d1 execute goldenstore-db --file=./migrations/20261106_push_audience.sql

CREATE TABLE IF NOT EXISTS push_sync_state (
  id TEXT PRIMARY KEY,
  cursor TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_reg_log (
  id TEXT PRIMARY KEY,
  uid_masked TEXT,
  platform TEXT,
  permission TEXT,
  enabled INTEGER,
  token_tail TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_reg_log_created ON push_reg_log(created_at DESC);

-- =====================================================================
-- DIAGNOSTIC QUERIES (run these to find why only 70 of 1000 are targeted)
-- =====================================================================
-- 1) How many tokens really exist? Unique vs total:
-- SELECT COUNT(*) AS total, COUNT(DISTINCT token) AS unique_tokens,
--        COUNT(DISTINCT uid) AS unique_users FROM fcm_tokens;
--
-- 2) How many are eligible (opted in, not denied)? NULL-safe:
-- SELECT SUM(CASE WHEN COALESCE(notifications_enabled,1)=1
--                   AND COALESCE(permission,'granted')!='denied'
--                  THEN 1 ELSE 0 END) AS eligible,
--        SUM(CASE WHEN NOT (COALESCE(notifications_enabled,1)=1
--                   AND COALESCE(permission,'granted')!='denied')
--                  THEN 1 ELSE 0 END) AS excluded
-- FROM fcm_tokens;
--
-- 3) Breakdown by permission / platform / topic state:
-- SELECT platform, permission, notifications_enabled, topic_subscribed,
--        COUNT(*) AS n FROM fcm_tokens
-- GROUP BY platform, permission, notifications_enabled, topic_subscribed
-- ORDER BY n DESC;
--
-- 4) Web tokens (same table sendWebPush reads):
-- SELECT COUNT(*) AS total,
--        SUM(CASE WHEN COALESCE(notifications_enabled,1)=1
--                   AND COALESCE(permission,'granted')!='denied'
--                  THEN 1 ELSE 0 END) AS eligible FROM web_tokens;
--
-- 5) Are devices registering at all? (last 24h)
-- SELECT platform, permission, COUNT(*) AS n FROM push_reg_log
-- WHERE created_at >= strftime('%s','now') - 86400
-- GROUP BY platform, permission;
--
-- NOTE: users that exist ONLY in Firebase Auth cannot be "migrated" into D1
-- with a token — an FCM registration token is created on the DEVICE only.
-- The mobile app must POST it; see MOBILE_REGISTRATION.md.
