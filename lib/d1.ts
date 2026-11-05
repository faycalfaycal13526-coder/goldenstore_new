import type { Env } from './env.js';

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

// --- تم التعديل: حساب الإعجابات ديناميكياً ---
export async function listReviews(env: Env, app_id: string, limit: number): Promise<any[]> {
  const result = await env.DB.prepare(`
    SELECT 
      v.*, 
      (SELECT COUNT(*) FROM review_likes rl WHERE rl.review_id = v.id) AS likes_count
    FROM star_votes v 
    WHERE v.app_id = ? 
    ORDER BY v.ts DESC 
    LIMIT ?
  `).bind(app_id, limit).all();
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

// ============================================================
// دوال التعليقات الجديدة (إعجاب، بلاغات)
// ============================================================

export async function getReviewById(env: Env, reviewId: string) {
  const row = await env.DB.prepare('SELECT * FROM star_votes WHERE id = ?').bind(reviewId).first();
  return row || null;
}

export async function toggleReviewLike(env: Env, reviewId: string, userId: string) {
  const existing = await env.DB.prepare('SELECT id FROM review_likes WHERE review_id = ? AND user_id = ?').bind(reviewId, userId).first();
  let liked = false;
  
  if (existing) {
    await env.DB.prepare('DELETE FROM review_likes WHERE id = ?').bind(existing.id).run();
    liked = false;
  } else {
    await env.DB.prepare('INSERT INTO review_likes (id, review_id, user_id, created_at) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), reviewId, userId, Math.floor(Date.now() / 1000)).run();
    liked = true;
  }
  
  const countRow: any = await env.DB.prepare('SELECT COUNT(*) as count FROM review_likes WHERE review_id = ?').bind(reviewId).first();
  return { liked, likes_count: Number(countRow?.count || 0) };
}

export async function reportReview(env: Env, reviewId: string, appSlug: string, userId: string, reason: string) {
  await env.DB.prepare('INSERT INTO review_reports (id, review_id, app_slug, user_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), reviewId, appSlug, userId, reason, Math.floor(Date.now() / 1000)).run();
  return { success: true };
}

export async function getAllReports(env: Env) {
  const result = await env.DB.prepare(`
    SELECT r.*, v.comment as review_text, v.name as review_author
    FROM review_reports r
    LEFT JOIN star_votes v ON r.review_id = v.id
    ORDER BY r.created_at DESC
  `).all();
  return result.results || [];
}

export async function deleteReport(env: Env, reportId: string) {
  await env.DB.prepare('DELETE FROM review_reports WHERE id = ?').bind(reportId).run();
  return { success: true };
}
