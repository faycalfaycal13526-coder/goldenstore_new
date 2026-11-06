-- Golden Store — durable APK download counter (2026-11-06)
-- Safe to run more than once. The API also calls ensureDownloadStatsSchema(),
-- which issues the same CREATE TABLE IF NOT EXISTS statement, so a fresh
-- deployment works even before this migration is applied manually.
--
-- This table is NEVER replaced when a new build is published, so the real
-- accumulated download total is preserved across releases.
--
-- Apply with:  wrangler d1 execute <DB_NAME> --file=./migrations/20261106_app_download_stats.sql

CREATE TABLE IF NOT EXISTS app_download_stats (
  id TEXT PRIMARY KEY,
  downloads INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO app_download_stats (id, downloads) VALUES ('current', 0);
