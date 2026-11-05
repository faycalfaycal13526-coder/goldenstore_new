import type { Env } from './env.js';
import { nowSec, randomId } from './utils.js';

export function rowToApp(row: any): any {
  let search_terms: any[] = [];
  try { search_terms = JSON.parse(row.search_terms || '[]'); } catch { search_terms = []; }
  return {
    id: row.id, slug: row.slug, name: row.name, name_lower: row.name_lower,
    search_terms, package_name: row.package_name, short_description: row.short_description,
    description: row.description, category: row.category, type: row.type,
    developer: row.developer, version_name: row.version_name, version_code: row.version_code,
    min_sdk: row.min_sdk, size_bytes: row.size_bytes, apk_key: row.apk_key,
    icon_key: row.icon_key, feature_key: row.feature_key, stars: row.stars,
    rating_sum: row.rating_sum, rating_count: row.rating_count, rating: row.rating,
    downloads: row.downloads, created_at: row.created_at, updated_at: row.updated_at,
  };
}

export interface ListAppsOptions {
  q?: string; category?: string; type?: string; sort?: string;
  starredOnly?: boolean; limit?: number; offset?: number;
}

export async function listApps(env: Env, opts: ListAppsOptions = {}): Promise<{ apps: any[]; total: number }> {
  const limit = Math.min(opts.limit ?? 24, 60);
  const offset = Math.max(opts.offset ?? 0, 0);
  const conditions: string[] = [];
  const params: any[] = [];
  if (opts.type === 'game') conditions.push("type = 'game'");
  else if (opts.type === 'app') conditions.push("type != 'game'");
  if (opts.category) { conditions.push('category = ?'); params.push(opts.category); }
  if (opts.starredOnly) conditions.push('stars > 0');
  if (opts.q) {
    const token = opts.q.split(/\s+/).filter((w) => w.length >= 2)[0];
    if (token) { conditions.push('(name_lower LIKE ? OR search_terms LIKE ?)'); params.push(`%${token}%`, `%${token}%`); }
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  let orderBy = 'ORDER BY created_at DESC';
  if (opts.sort === 'popular') orderBy = 'ORDER BY downloads DESC, rating DESC';
  else if (opts.sort === 'stars' || opts.sort === 'rating') orderBy = 'ORDER BY rating DESC, rating_count DESC';
  else if (opts.sort === 'name') orderBy = 'ORDER BY name_lower ASC';

  const countResult = await env.DB.prepare(`SELECT COUNT(*) as total FROM apps ${whereClause}`).bind(...params).first();
  const total = Number(countResult?.total ?? 0);
  const dataResult = await env.DB.prepare(`SELECT * FROM apps ${whereClause} ${orderBy} LIMIT ? OFFSET ?`).bind(...params, limit, offset).all();
  return { apps: (dataResult.results || []).map(rowToApp), total };
}

export async function getAppBySlug(env: Env, slug: string): Promise<any | null> {
  const row = await env.DB.prepare('SELECT * FROM apps WHERE slug = ?').bind(slug).first();
  return row ? rowToApp(row) : null;
}

export async function listScreenshots(env: Env, app_id: string): Promise<any[]> {
  const result = await env.DB.prepare('SELECT * FROM screenshots WHERE app_id = ? ORDER BY position ASC').bind(app_id).all();
  return result.results || [];
}

export async function listNotifications(env: Env, limit?: number): Promise<any[]> {
  let sql = 'SELECT * FROM notifications ORDER BY created_at DESC';
  if (limit) sql += ' LIMIT ?';
  const stmt = env.DB.prepare(sql);
  const result = limit ? await stmt.bind(limit).all() : await stmt.all();
  return result.results || [];
}

export async function getStoreSettings(env: Env): Promise<{ notify_new_publications: boolean }> {
  const row: any = await env.DB.prepare('SELECT * FROM store_settings WHERE id = ?').bind('general').first();
  return { notify_new_publications: row ? row.notify_new_publications === 1 : true };
}

/* =========================================================================
   Reviews (star_votes) — likes & reports
   -------------------------------------------------------------------------
   star_votes columns: id, app_id, hash, server_hash, uid, rating,
                       comment, name, photo_url, ts
   The `uid` column is the author identifier and `comment` holds the text.
   Likes live in review_likes (review_id, user_id) and reports in
   review_reports (review_id, app_slug, user_id, reason, status).
   ========================================================================= */

/** Public review rows for one app, newest first, with like counts and the
 *  current viewer's like state. Only rows that actually contain a comment
 *  are returned; internal fields (hash, server_hash, uid) are never exposed. */
export async function listReviews(env: Env, app_id: string, limit: number, viewerId = ''): Promise<any[]> {
  const result = await env.DB.prepare(`
    SELECT
      v.id,
      v.name,
      v.rating,
      v.comment,
      v.photo_url,
      v.ts,
      (SELECT COUNT(DISTINCT rl.user_id) FROM review_likes rl WHERE rl.review_id = v.id) AS likes_count,
      COALESCE(
        (SELECT 1 FROM review_likes rl2 WHERE rl2.review_id = v.id AND rl2.user_id = ? LIMIT 1),
        0
      ) AS liked_by_me
    FROM star_votes v
    WHERE v.app_id = ?
      AND v.comment IS NOT NULL
      AND TRIM(v.comment) <> ''
    ORDER BY v.ts DESC, v.id DESC
    LIMIT ?
  `).bind(viewerId, app_id, limit).all();
  return result.results || [];
}

/** Total number of written reviews (independent of the page limit). */
export async function countReviews(env: Env, app_id: string): Promise<number> {
  const row: any = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM star_votes
    WHERE app_id = ? AND comment IS NOT NULL AND TRIM(comment) <> ''
  `).bind(app_id).first();
  return Number(row?.total || 0);
}

/** Rating distribution across ALL votes (including votes without a comment). */
export async function getRatingDistribution(env: Env, app_id: string): Promise<Record<string, number>> {
  const result = await env.DB.prepare(`
    SELECT rating, COUNT(*) AS total
    FROM star_votes
    WHERE app_id = ?
    GROUP BY rating
  `).bind(app_id).all();
  const dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const row of (result.results || []) as any[]) {
    const key = String(Math.round(Number(row.rating) || 0));
    if (key in dist) dist[key] = Number(row.total || 0);
  }
  return dist;
}

/** Fetch a single vote. Used to verify that a like/report targets a real
 *  review belonging to the app in the URL. */
export async function getReviewById(env: Env, reviewId: string): Promise<any | null> {
  const row = await env.DB.prepare('SELECT id, app_id, uid, comment FROM star_votes WHERE id = ?').bind(reviewId).first();
  return row || null;
}

/** Toggle a like for (review, viewer). The DELETE-first / conditional-INSERT
 *  sequence keeps the toggle idempotent even without a UNIQUE constraint and
 *  avoids duplicate rows from double taps. */
export async function toggleReviewLike(env: Env, reviewId: string, userId: string): Promise<{ liked: boolean; likes_count: number }> {
  const removed: any = await env.DB.prepare('DELETE FROM review_likes WHERE review_id = ? AND user_id = ?')
    .bind(reviewId, userId).run();
  const wasLiked = Number(removed?.meta?.changes || 0) > 0;

  if (!wasLiked) {
    await env.DB.prepare(`
      INSERT INTO review_likes (id, review_id, user_id, created_at)
      SELECT ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM review_likes WHERE review_id = ? AND user_id = ?
      )
    `).bind(randomId(), reviewId, userId, nowSec(), reviewId, userId).run();
  }

  const countRow: any = await env.DB.prepare('SELECT COUNT(DISTINCT user_id) AS count FROM review_likes WHERE review_id = ?')
    .bind(reviewId).first();
  return { liked: !wasLiked, likes_count: Number(countRow?.count || 0) };
}

/** Store a report. One active report per (review, reporter) prevents spam. */
export async function reportReview(env: Env, reviewId: string, appSlug: string, userId: string, reason: string): Promise<{ success: boolean; duplicate: boolean }> {
  const existing = await env.DB.prepare('SELECT id FROM review_reports WHERE review_id = ? AND user_id = ? LIMIT 1')
    .bind(reviewId, userId).first();
  if (existing) return { success: true, duplicate: true };

  await env.DB.prepare(`
    INSERT INTO review_reports (id, review_id, app_slug, user_id, reason, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).bind(randomId(), reviewId, appSlug, userId, reason, nowSec()).run();
  return { success: true, duplicate: false };
}

/** Admin listing: report data joined with the app name and review text. */
export async function getAllReports(env: Env): Promise<any[]> {
  const result = await env.DB.prepare(`
    SELECT
      r.id,
      r.review_id,
      r.app_slug,
      r.user_id,
      r.reason,
      r.status,
      r.created_at,
      COALESCE(a.name, r.app_slug) AS app_name,
      v.comment AS review_text,
      v.name     AS review_author,
      v.rating   AS review_rating
    FROM review_reports r
    LEFT JOIN apps a       ON a.slug = r.app_slug
    LEFT JOIN star_votes v ON v.id = r.review_id
    ORDER BY r.created_at DESC, r.id DESC
  `).all();
  return (result.results || []).map((row: any) => ({
    id: row.id,
    review_id: row.review_id,
    app_slug: row.app_slug || '',
    app_name: row.app_name || row.app_slug || '—',
    review_text: row.review_text || '',
    review_author: row.review_author || '',
    review_rating: Number(row.review_rating || 0),
    user_id: row.user_id || '',
    reason: row.reason || '',
    status: row.status || 'pending',
    created_at: Number(row.created_at || 0),
  }));
}

/** Delete a report. Returns false when the id no longer exists. */
export async function deleteReport(env: Env, reportId: string): Promise<boolean> {
  const result: any = await env.DB.prepare('DELETE FROM review_reports WHERE id = ?').bind(reportId).run();
  return Number(result?.meta?.changes || 0) > 0;
}
