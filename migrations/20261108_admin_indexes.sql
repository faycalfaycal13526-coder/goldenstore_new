-- Golden Store — Admin dashboard / security audit indexes (2026-11-08)
-- Every statement is idempotent and safe on an existing D1 database.
-- `ensureAdminIndexes()` in api/[[...path]].ts runs the same list lazily.

-- Catalogue: category/type filters, sorting and date ranges.
CREATE INDEX IF NOT EXISTS idx_apps_category ON apps(category);
CREATE INDEX IF NOT EXISTS idx_apps_type ON apps(type);
CREATE INDEX IF NOT EXISTS idx_apps_created_at ON apps(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_apps_downloads ON apps(downloads DESC);
CREATE INDEX IF NOT EXISTS idx_apps_slug ON apps(slug);

-- Reviews / votes: app detail aggregates and per-user lookups.
CREATE INDEX IF NOT EXISTS idx_star_votes_app_id ON star_votes(app_id);
CREATE INDEX IF NOT EXISTS idx_star_votes_uid ON star_votes(uid);
CREATE INDEX IF NOT EXISTS idx_star_votes_app_uid ON star_votes(app_id, uid);
CREATE INDEX IF NOT EXISTS idx_review_reports_status ON review_reports(status, created_at DESC);

-- Requests & reports: pending queues in the admin dashboard.
CREATE INDEX IF NOT EXISTS idx_app_requests_status ON app_requests(status, ts DESC);
CREATE INDEX IF NOT EXISTS idx_app_requests_type ON app_requests(type, status);

-- Download analytics: 14-day series and per-app aggregation.
CREATE INDEX IF NOT EXISTS idx_download_events_day ON download_events(day);
CREATE INDEX IF NOT EXISTS idx_download_events_slug ON download_events(slug, day);

-- Users / devices: distinct-user counts and the users table.
CREATE INDEX IF NOT EXISTS idx_push_devices_uid ON push_devices(uid, channel, notifications_enabled);
CREATE INDEX IF NOT EXISTS idx_user_demographics_upd ON user_demographics(updated_at);
CREATE INDEX IF NOT EXISTS idx_support_threads_uid ON support_threads(uid, created_at DESC);
