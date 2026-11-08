import type { Env } from './env.js';
import type { AppVideo } from './types.js';
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

/* =========================================================================
   Advanced search — GET /api/search and GET /api/search/suggest
   -------------------------------------------------------------------------
   All user values are bound parameters. Sort clauses come from a fixed
   whitelist, and LIKE wildcards are escaped so a query like "100%" is
   treated as literal text (no wildcard injection).
   ========================================================================= */

export interface SearchAppsOptions {
  q?: string;
  category?: string;
  type?: string;
  sort?: string;
  minRating?: number;
  limit?: number;
  offset?: number;
}

export const SEARCH_SORTS: Record<string, string> = {
  recent:    'created_at DESC, id DESC',
  newest:    'created_at DESC, id DESC',
  popular:   'downloads DESC, rating DESC, id DESC',
  downloads: 'downloads DESC, rating DESC, id DESC',
  rating:    'rating DESC, rating_count DESC, downloads DESC, id DESC',
  stars:     'rating DESC, rating_count DESC, downloads DESC, id DESC',
  name:      'name_lower ASC, id ASC',
  alpha:     'name_lower ASC, id ASC',
};

/** Escape %, _ and \ so LIKE treats the user's text literally. */
function likeEscape(raw: string): string {
  return raw.replace(/[\\%_]/g, (m) => '\\' + m);
}

/** One AND-group per whitespace token: every token must match at least one
 *  of name / developer / short description / description / search terms. */
function textConditions(q: string, params: any[]): string[] {
  const tokens = q.toLowerCase().split(/\s+/)
    .filter((w) => w.length > 0 && w.length <= 64).slice(0, 6);
  const conditions: string[] = [];
  for (const token of tokens) {
    const like = `%${likeEscape(token)}%`;
    conditions.push(
      "(name_lower LIKE ? ESCAPE '\\'" +
      " OR COALESCE(developer, '') LIKE ? ESCAPE '\\'" +
      " OR COALESCE(short_description, '') LIKE ? ESCAPE '\\'" +
      " OR COALESCE(description, '') LIKE ? ESCAPE '\\'" +
      " OR COALESCE(search_terms, '') LIKE ? ESCAPE '\\')"
    );
    params.push(like, like, like, like, like);
  }
  return conditions;
}

export async function searchApps(env: Env, opts: SearchAppsOptions = {}): Promise<{ apps: any[]; total: number }> {
  const limit = Math.min(Math.max(Number(opts.limit) || 24, 1), 60);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const conditions: string[] = [];
  const params: any[] = [];

  const q = (opts.q || '').trim();
  if (q) conditions.push(...textConditions(q, params));

  const category = (opts.category || '').trim();
  if (category && /^[a-z0-9_-]{1,60}$/i.test(category)) {
    conditions.push('category = ?');
    params.push(category);
  }

  const type = (opts.type || '').trim();
  if (type === 'game') conditions.push("type = 'game'");
  else if (type === 'app') conditions.push("type != 'game'");

  const minRating = Number(opts.minRating) || 0;
  if (minRating > 0) {
    conditions.push('COALESCE(rating, 0) >= ?');
    params.push(Math.min(minRating, 5));
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = `ORDER BY ${SEARCH_SORTS[(opts.sort || '').trim()] || SEARCH_SORTS.recent}`;

  const countRow: any = await env.DB.prepare(`SELECT COUNT(*) AS total FROM apps ${where}`)
    .bind(...params).first();
  const total = Number(countRow?.total ?? 0);
  const result = await env.DB.prepare(`SELECT * FROM apps ${where} ${orderBy} LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset).all();
  return { apps: (result.results || []).map(rowToApp), total };
}

/** Lightweight autocomplete rows (no description / keys in the payload). */
export async function suggestApps(env: Env, q: string, limit = 8): Promise<any[]> {
  const query = (q || '').trim().toLowerCase();
  if (!query) return [];
  const n = Math.min(Math.max(Number(limit) || 8, 1), 12);
  const params: any[] = [];
  const conditions = textConditions(query, params);
  if (!conditions.length) return [];
  const result = await env.DB.prepare(
    `SELECT id, slug, name, developer, category, type, icon_key, rating
       FROM apps WHERE ${conditions.join(' AND ')}
       ORDER BY downloads DESC, rating DESC, name_lower ASC LIMIT ?`
  ).bind(...params, n).all();
  return result.results || [];
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

/** Delete a review (star_votes row) and every row that references it:
 *  review_likes and review_reports. Also recomputes the parent app's rating
 *  aggregates, since a star_votes row carries both the comment and its vote.
 *  All four writes are executed in one D1 batch (a single transaction). */
export async function deleteReview(env: Env, reviewId: string): Promise<{ deleted: boolean; likes: number; reports: number }> {
  const review: any = await env.DB.prepare('SELECT id, app_id FROM star_votes WHERE id = ?').bind(reviewId).first();
  if (!review) return { deleted: false, likes: 0, reports: 0 };

  // Count dependent rows and compute the app's aggregates AFTER the deletion,
  // i.e. over the remaining votes of that app.
  const [likesRow, reportsRow, aggRow]: any[] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM review_likes WHERE review_id = ?').bind(reviewId).first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM review_reports WHERE review_id = ?').bind(reviewId).first(),
    env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(rating), 0) AS s FROM star_votes WHERE app_id = ? AND id <> ?')
      .bind(review.app_id, reviewId).first(),
  ]);
  const likes = Number(likesRow?.n || 0);
  const reports = Number(reportsRow?.n || 0);
  const count = Number(aggRow?.n || 0);
  const sum = Number(aggRow?.s || 0);
  const rating = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;

  await env.DB.batch([
    env.DB.prepare('DELETE FROM review_likes WHERE review_id = ?').bind(reviewId),
    env.DB.prepare('DELETE FROM review_reports WHERE review_id = ?').bind(reviewId),
    env.DB.prepare('DELETE FROM star_votes WHERE id = ?').bind(reviewId),
    env.DB.prepare('UPDATE apps SET rating = ?, rating_count = ?, rating_sum = ?, stars = ? WHERE id = ?')
      .bind(rating, count, sum, count, review.app_id),
  ]);

  return { deleted: true, likes, reports };
}

/* =========================================================================
 * Support chat (2026-11) — user ↔ admin text conversation stored in D1.
 * Voice notes, images, camera uploads and their storage were removed; only
 * ordered text messages remain. Deleting a thread removes messages + counters.
 * ========================================================================= */

export interface SupportThread {
  id: string;
  uid: string;
  user_email: string;
  user_name: string;
  subject: string;
  status: 'open' | 'closed';
  created_at: number;
  updated_at: number;
  last_message_at: number;
  last_message?: string;
  message_count?: number;
  unread_admin: number;
  unread_user: number;
  messages?: SupportMessage[];
}

export interface SupportMessage {
  id: string;
  thread_id: string;
  sender: 'user' | 'admin';
  body: string;
  created_at: number;
}

const SUPPORT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS support_threads (
     id TEXT PRIMARY KEY,
     uid TEXT NOT NULL,
     user_email TEXT,
     user_name TEXT,
     subject TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'open',
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     last_message_at INTEGER NOT NULL,
     unread_admin INTEGER NOT NULL DEFAULT 0,
     unread_user INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS support_messages (
     id TEXT PRIMARY KEY,
     thread_id TEXT NOT NULL,
     sender TEXT NOT NULL,
     body TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_support_threads_uid ON support_threads(uid, last_message_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_support_threads_admin ON support_threads(last_message_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id, created_at)`,
];

// Remember which D1 binding already has the schema (per isolate / per test DB).
const supportSchemaReady = new WeakSet<object>();

export async function ensureSupportSchema(env: Env): Promise<void> {
  const db: any = env.DB;
  if (supportSchemaReady.has(db)) return;
  for (const sql of SUPPORT_SCHEMA) await db.prepare(sql).run();
  supportSchemaReady.add(db);
}

function supportThreadFromRow(r: any): SupportThread {
  return {
    id: String(r.id), uid: String(r.uid),
    user_email: r.user_email || '', user_name: r.user_name || '',
    subject: r.subject || '', status: r.status === 'closed' ? 'closed' : 'open',
    created_at: Number(r.created_at) || 0, updated_at: Number(r.updated_at) || 0,
    last_message_at: Number(r.last_message_at) || 0,
    last_message: r.last_message || undefined,
    message_count: r.message_count != null ? Number(r.message_count) : undefined,
    unread_admin: Number(r.unread_admin) || 0, unread_user: Number(r.unread_user) || 0,
  };
}

function supportMessageFromRow(r: any): SupportMessage {
  return {
    id: String(r.id), thread_id: String(r.thread_id),
    sender: r.sender === 'admin' ? 'admin' : 'user',
    body: String(r.body || ''), created_at: Number(r.created_at) || 0,
  };
}

async function supportMessagesFor(env: Env, ids: string[]): Promise<Record<string, SupportMessage[]>> {
  const out: Record<string, SupportMessage[]> = {};
  if (!ids.length) return out;
  const placeholders = ids.map(() => '?').join(',');
  const res: any = await env.DB.prepare(
    `SELECT id, thread_id, sender, body, created_at FROM support_messages
     WHERE thread_id IN (${placeholders}) ORDER BY created_at ASC, rowid ASC`
  ).bind(...ids).all();
  for (const r of res.results || []) {
    const m = supportMessageFromRow(r);
    (out[m.thread_id] ||= []).push(m);
  }
  return out;
}

export async function createSupportThread(
  env: Env,
  input: {
    uid: string; email?: string; name?: string; subject: string; message: string;
  },
): Promise<{ thread: SupportThread; messages: SupportMessage[] }> {
  await ensureSupportSchema(env);
  const ts = nowSec();
  const threadId = randomId();
  const messageId = randomId();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO support_threads
       (id, uid, user_email, user_name, subject, status, created_at, updated_at, last_message_at, unread_admin, unread_user)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, 1, 0)`
    ).bind(threadId, input.uid, input.email || '', input.name || '', input.subject, ts, ts, ts),
    env.DB.prepare(
      `INSERT INTO support_messages (id, thread_id, sender, body, created_at) VALUES (?, ?, 'user', ?, ?)`
    ).bind(messageId, threadId, input.message, ts),
  ]);
  const thread: SupportThread = {
    id: threadId, uid: input.uid, user_email: input.email || '', user_name: input.name || '',
    subject: input.subject, status: 'open', created_at: ts, updated_at: ts, last_message_at: ts,
    unread_admin: 1, unread_user: 0,
  };
  const messages: SupportMessage[] = [{
    id: messageId, thread_id: threadId, sender: 'user', body: input.message,
    created_at: ts,
  }];
  return { thread, messages };
}

/** Threads belonging to one user, newest activity first, with all messages. */
export async function listUserSupportThreads(env: Env, uid: string, limit = 20): Promise<SupportThread[]> {
  await ensureSupportSchema(env);
  const res: any = await env.DB.prepare(
    `SELECT * FROM support_threads WHERE uid = ? ORDER BY last_message_at DESC, rowid DESC LIMIT ?`
  ).bind(uid, Math.min(Math.max(limit, 1), 50)).all();
  const threads: SupportThread[] = (res.results || []).map(supportThreadFromRow);
  const map = await supportMessagesFor(env, threads.map((t: SupportThread) => t.id));
  threads.forEach((t: SupportThread) => { t.messages = map[t.id] || []; t.message_count = (map[t.id] || []).length; });
  return threads;
}

/** All threads for the admin panel, with a preview of the last message. */
export async function listAdminSupportThreads(env: Env, limit = 100): Promise<SupportThread[]> {
  await ensureSupportSchema(env);
  const res: any = await env.DB.prepare(
    `SELECT t.*,
       (SELECT body FROM support_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_message,
       (SELECT COUNT(*) FROM support_messages m WHERE m.thread_id = t.id) AS message_count
     FROM support_threads t ORDER BY t.last_message_at DESC, t.rowid DESC LIMIT ?`
  ).bind(Math.min(Math.max(limit, 1), 200)).all();
  return (res.results || []).map(supportThreadFromRow);
}

export async function getSupportThread(env: Env, threadId: string): Promise<{ thread: SupportThread; messages: SupportMessage[] } | null> {
  await ensureSupportSchema(env);
  const r: any = await env.DB.prepare('SELECT * FROM support_threads WHERE id = ?').bind(threadId).first();
  if (!r) return null;
  const thread = supportThreadFromRow(r);
  const map = await supportMessagesFor(env, [threadId]);
  const messages = map[threadId] || [];
  thread.messages = messages;
  thread.message_count = messages.length;
  return { thread, messages };
}

/** Append a text message. `sender='user'` verifies ownership + open status. */
export async function addSupportMessage(
  env: Env,
  threadId: string,
  sender: 'user' | 'admin',
  body: string,
  uid = '',
): Promise<{ thread: SupportThread; messages: SupportMessage[] } | null> {
  await ensureSupportSchema(env);
  const r: any = await env.DB.prepare('SELECT * FROM support_threads WHERE id = ?').bind(threadId).first();
  if (!r) return null;
  if (sender === 'user' && (String(r.uid) !== uid || r.status === 'closed')) return null;
  const ts = nowSec();
  const messageId = randomId();
  const unreadAdmin = sender === 'user' ? 1 : 0;
  const unreadUser = sender === 'admin' ? 1 : 0;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO support_messages (id, thread_id, sender, body, created_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(messageId, threadId, sender, body, ts),
    env.DB.prepare(
      `UPDATE support_threads SET last_message_at = ?, updated_at = ?,
         unread_admin = CASE WHEN ? = 1 THEN unread_admin + 1 ELSE 0 END,
         unread_user  = CASE WHEN ? = 1 THEN unread_user + 1 ELSE 0 END
       WHERE id = ?`
    ).bind(ts, ts, unreadAdmin, unreadUser, threadId),
  ]);
  return getSupportThread(env, threadId);
}

export async function setSupportThreadStatus(env: Env, threadId: string, status: 'open' | 'closed'): Promise<boolean> {
  await ensureSupportSchema(env);
  const existing: any = await env.DB.prepare('SELECT id FROM support_threads WHERE id = ?').bind(threadId).first();
  if (!existing) return false;
  await env.DB.prepare('UPDATE support_threads SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, nowSec(), threadId).run();
  return true;
}

/* SQL-injection audit: the ONLY interpolated identifiers in this module are
   chosen from compile-time constant maps below (never from request data).
   Every value from a caller goes through .bind(). */
const SUPPORT_UNREAD_COLUMNS: Record<'user' | 'admin', string> = {
  user: 'unread_user', admin: 'unread_admin',
};
export async function markSupportThreadRead(env: Env, threadId: string, who: 'user' | 'admin'): Promise<void> {
  await ensureSupportSchema(env);
  const column = SUPPORT_UNREAD_COLUMNS[who] || SUPPORT_UNREAD_COLUMNS.user;
  await env.DB.prepare(`UPDATE support_threads SET ${column} = 0 WHERE id = ?`).bind(threadId).run();
}

/** Hard delete: thread + every message. */
export async function deleteSupportThread(env: Env, threadId: string): Promise<boolean> {
  await ensureSupportSchema(env);
  const existing: any = await env.DB.prepare('SELECT id FROM support_threads WHERE id = ?').bind(threadId).first();
  if (!existing) return false;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM support_messages WHERE thread_id = ?').bind(threadId),
    env.DB.prepare('DELETE FROM support_threads WHERE id = ?').bind(threadId),
  ]);
  return true;
}


/* =========================================================================
   App videos (YouTube + Shorts) — 2026-11-06
   ========================================================================= */
const VIDEO_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS app_videos (
     id TEXT PRIMARY KEY,
     app_id TEXT NOT NULL,
     video_id TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'video',
     url TEXT NOT NULL,
     title TEXT,
     thumb_key TEXT,
     position INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_app_videos_app ON app_videos(app_id, position ASC)`,
];
// CREATE TABLE IF NOT EXISTS cannot add a column to a table created by the
// first deployment, so the upgrade ALTER runs separately and is allowed to
// fail with "duplicate column name" on fresh databases.
const VIDEO_UPGRADES = [`ALTER TABLE app_videos ADD COLUMN thumb_key TEXT`];
const videoSchemaReady = new WeakSet<object>();

export async function ensureVideosSchema(env: Env): Promise<void> {
  const db: any = env.DB;
  if (videoSchemaReady.has(db)) return;
  for (const sql of VIDEO_SCHEMA) await db.prepare(sql).run();
  for (const sql of VIDEO_UPGRADES) { try { await db.prepare(sql).run(); } catch { /* already present */ } }
  videoSchemaReady.add(db);
}

function videoFromRow(r: any): AppVideo {
  return {
    id: String(r.id), app_id: String(r.app_id), video_id: String(r.video_id),
    kind: r.kind === 'short' ? 'short' : 'video', url: String(r.url),
    title: String(r.title || ''), thumb_key: r.thumb_key ? String(r.thumb_key) : null,
    position: Number(r.position) || 0,
    created_at: Number(r.created_at) || 0,
  };
}

export async function listAppVideos(env: Env, app_id: string): Promise<AppVideo[]> {
  await ensureVideosSchema(env);
  const r = await env.DB.prepare('SELECT * FROM app_videos WHERE app_id = ? ORDER BY position ASC, created_at ASC').bind(app_id).all();
  return (r.results || []).map(videoFromRow);
}

export async function addAppVideo(env: Env, app_id: string, v: {
  video_id: string; kind: 'video' | 'short'; url: string;
  title?: string; thumb_key?: string | null; position?: number;
}): Promise<AppVideo> {
  await ensureVideosSchema(env);
  const row: AppVideo = {
    id: randomId(), app_id, video_id: v.video_id, kind: v.kind, url: v.url,
    title: v.title || '', thumb_key: v.thumb_key || null,
    position: Number(v.position) || 0, created_at: nowSec(),
  };
  await env.DB.prepare('INSERT INTO app_videos (id, app_id, video_id, kind, url, title, thumb_key, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(row.id, row.app_id, row.video_id, row.kind, row.url, row.title,
      row.thumb_key, row.position, row.created_at).run();
  return row;
}

export async function updateAppVideo(env: Env, app_id: string, id: string, patch: {
  thumb_key?: string | null; title?: string;
}): Promise<AppVideo | null> {
  await ensureVideosSchema(env);
  const old: any = await env.DB.prepare('SELECT * FROM app_videos WHERE id = ? AND app_id = ?').bind(id, app_id).first();
  if (!old) return null;
  const thumb_key = patch.thumb_key === undefined ? (old.thumb_key || null) : patch.thumb_key;
  const title = patch.title === undefined ? String(old.title || '') : String(patch.title).slice(0, 120);
  await env.DB.prepare('UPDATE app_videos SET thumb_key = ?, title = ? WHERE id = ? AND app_id = ?')
    .bind(thumb_key, title, id, app_id).run();
  return { ...videoFromRow(old), thumb_key, title };
}

export async function listVideoThumbKeys(env: Env, app_id: string): Promise<string[]> {
  await ensureVideosSchema(env);
  const r = await env.DB.prepare('SELECT thumb_key FROM app_videos WHERE app_id = ? AND thumb_key IS NOT NULL').bind(app_id).all();
  return (r.results || []).map((x: any) => String(x.thumb_key)).filter(Boolean);
}

export async function deleteAppVideo(env: Env, app_id: string, id: string): Promise<boolean> {
  await ensureVideosSchema(env);
  const row = await env.DB.prepare('SELECT id FROM app_videos WHERE id = ? AND app_id = ?').bind(id, app_id).first();
  if (!row) return false;
  await env.DB.prepare('DELETE FROM app_videos WHERE id = ? AND app_id = ?').bind(id, app_id).run();
  return true;
}

export async function deleteAppVideos(env: Env, app_id: string): Promise<void> {
  await ensureVideosSchema(env);
  await env.DB.prepare('DELETE FROM app_videos WHERE app_id = ?').bind(app_id).run();
}
