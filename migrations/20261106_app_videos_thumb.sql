-- Golden Store — custom video thumbnails (2026-11-06)
-- Safe upgrade for databases where 20261106_app_videos.sql already ran before
-- the thumb_key column existed. It is OK if this fails with
-- "duplicate column name: thumb_key" — the column is already there.
--
-- Apply with:  wrangler d1 execute <DB_NAME> --file=./migrations/20261106_app_videos_thumb.sql

ALTER TABLE app_videos ADD COLUMN thumb_key TEXT;
