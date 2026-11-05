-- ============================================================================
-- Golden Store — indexes for GET /api/search  (Cloudflare D1 / SQLite)
-- Run:  npx wrangler d1 execute <DB_NAME> --file=./migrations/20261105_search_indexes.sql
--       (add --remote for production)
--
-- IMPORTANT: the `apps` table has NO `title` column. The display name lives in
-- `name` (and its lowercase copy `name_lower`), so the "title" index requested
-- is created on `name` / `name_lower` instead. If a different deployment really
-- has a `title` column, the optional statement at the bottom covers it.
-- ============================================================================

-- 1) Requested columns -------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_apps_name        ON apps(name);
CREATE INDEX IF NOT EXISTS idx_apps_name_lower  ON apps(name_lower);   -- used by LIKE / ORDER BY name
CREATE INDEX IF NOT EXISTS idx_apps_category    ON apps(category);
CREATE INDEX IF NOT EXISTS idx_apps_developer   ON apps(developer);

-- 2) Composite indexes for the actual filter + sort paths of /api/search -----
CREATE INDEX IF NOT EXISTS idx_apps_type_category        ON apps(type, category);
CREATE INDEX IF NOT EXISTS idx_apps_cat_created_desc     ON apps(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_apps_cat_downloads_desc   ON apps(category, downloads DESC);
CREATE INDEX IF NOT EXISTS idx_apps_cat_rating_desc      ON apps(category, rating DESC, rating_count DESC);
CREATE INDEX IF NOT EXISTS idx_apps_created_desc         ON apps(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_apps_downloads_desc       ON apps(downloads DESC);
CREATE INDEX IF NOT EXISTS idx_apps_rating_desc          ON apps(rating DESC, rating_count DESC);

-- 3) Optional planner statistics. D1 maintains these automatically on writes;
--    uncomment only if your local SQLite tooling supports ANALYZE.
-- ANALYZE;

-- 4) Optional: only for deployments that genuinely have a `title` column -----
-- CREATE INDEX IF NOT EXISTS idx_apps_title ON apps(title);
--
-- NOTE ON FUZZY SEARCH: a B-tree index cannot accelerate `LIKE '%word%'` with a
-- leading wildcard. The indexes above speed up category/type/rating equality,
-- sorting and pagination; the text predicate still scans. For large catalogs
-- see the OPTIONAL FTS5 migration in 20261105_search_fts_optional.sql.
