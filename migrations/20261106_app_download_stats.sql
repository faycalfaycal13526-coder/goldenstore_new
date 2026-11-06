-- Golden Store — durable APK download counter + one-time historic restore
-- (2026-11-06). Safe to run more than once.
-- The API also calls ensureDownloadStatsSchema(), which issues the same
-- statements, so a fresh deployment works without applying this manually.
--
-- Apply with:  wrangler d1 execute <DB_NAME> --file=./migrations/20261106_app_download_stats.sql

CREATE TABLE IF NOT EXISTS app_download_stats (
  id TEXT PRIMARY KEY,
  downloads INTEGER NOT NULL DEFAULT 0,
  restored INTEGER NOT NULL DEFAULT 0
);

-- Safe upgrade for databases created before `restored` existed. It is OK if
-- this reports "duplicate column name: restored".
ALTER TABLE app_download_stats ADD COLUMN restored INTEGER NOT NULL DEFAULT 0;

-- An older admin publish used INSERT OR REPLACE and reset the counter. The
-- owner confirmed the real total had already passed 4,000. Add that floor
-- exactly once, preserving every real download recorded since the reset.
INSERT OR IGNORE INTO app_download_stats (id, downloads, restored)
  SELECT 'current',
         4000 + COALESCE((SELECT downloads FROM app_updates WHERE id = 'current'), 0),
         1;

UPDATE app_download_stats
   SET downloads = downloads + CASE WHEN restored = 0 AND downloads < 4000 THEN 4000 ELSE 0 END,
       restored = 1
 WHERE id = 'current';

-- Running this file again adds nothing, because restored = 1.
