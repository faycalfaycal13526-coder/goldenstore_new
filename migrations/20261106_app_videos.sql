-- Golden Store — YouTube videos / Shorts for app pages (2026-11-06)
-- Safe to run more than once. The API also calls ensureVideosSchema(), which
-- issues the same CREATE TABLE IF NOT EXISTS statements, so a fresh
-- deployment works even before this migration is applied manually.
--
-- Apply with:  wrangler d1 execute <DB_NAME> --file=./migrations/20261106_app_videos.sql

CREATE TABLE IF NOT EXISTS app_videos (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  video_id TEXT NOT NULL,              -- the 11-character YouTube id
  kind TEXT NOT NULL DEFAULT 'video',  -- 'video' | 'short'
  url TEXT NOT NULL,                   -- canonical watch/shorts URL
  title TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_videos_app ON app_videos(app_id, position ASC);
