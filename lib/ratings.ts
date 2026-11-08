/* =========================================================================
   Golden Store — Authoritative rating engine (2026-11-08)
   -------------------------------------------------------------------------
   Problem this file fixes
   -----------------------
   `apps.rating / rating_count / rating_sum / stars` were maintained only by
   incremental arithmetic (`old + 1`), so any row deleted outside that one
   code path, any legacy imported app_id, or an app re-created with a new id
   left a permanently stale average. `deleteReview()` used to UPDATE
   `apps WHERE id = review.app_id`; when that app_id was a slug or an old id,
   the UPDATE matched ZERO rows — the comment disappeared but the rating never
   changed.

   Design
   ------
   * `star_votes` is the single source of truth. Every aggregate is computed
     from real rows, never from the stored counters.
   * An app can be addressed by its id, its slug, or a legacy id recovered
     from review_reports -> star_votes. All aliases are merged.
   * Deleting a review is ONE transaction; recomputation is a SEPARATE step,
     so a schema problem in `apps` can never roll back / keep the comment.
   * `recomputeAllRatings()` repairs pre-existing drift in one batch.
   * Read paths can overlay authoritative values without writing, so the
     storefront is correct even before a repair is run.
   ========================================================================= */
import type { Env } from './env.js';

export interface VoteAggregate {
  count: number;         // valid votes (rating 1..5), comments optional
  sum: number;
  rating: number;        // rounded to one decimal
  dist: Record<string, number>;
  reviews_count: number; // votes that actually carry a comment
}

const EMPTY_DIST = (): Record<string, number> => ({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 });
const reviewSchemaReady = new WeakSet<object>();

/** Likes/reports tables are created lazily. A deletion must never fail just
    because nobody ever liked or reported a review on a fresh database. */
export async function ensureReviewTables(env: Env): Promise<void> {
  const db: any = (env as any)?.DB;
  if (!db || reviewSchemaReady.has(db)) return;
  reviewSchemaReady.add(db);
  const ddl = [
    `CREATE TABLE IF NOT EXISTS review_likes (
       id TEXT PRIMARY KEY, review_id TEXT, user_id TEXT, created_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS review_reports (
       id TEXT PRIMARY KEY, review_id TEXT, app_slug TEXT, user_id TEXT,
       reason TEXT, status TEXT DEFAULT 'pending', created_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_review_likes_review ON review_likes(review_id)`,
    `CREATE INDEX IF NOT EXISTS idx_review_reports_review ON review_reports(review_id)`,
  ];
  for (const sql of ddl) { try { await db.prepare(sql).run(); } catch { /* already exists / legacy */ } }
}

export function normalizeAliases(input: string | string[] | { id?: string; slug?: string } | undefined): string[] {
  const raw = Array.isArray(input) ? input
    : typeof input === 'string' ? [input]
      : input ? [String(input.id || ''), String(input.slug || '')] : [];
  return Array.from(new Set(raw.map((v) => String(v || '').trim()).filter(Boolean)));
}

/** Every identifier that may legitimately hold this app's votes. */
export async function appAliases(env: Env, app: { id?: string; slug?: string }): Promise<string[]> {
  const aliases = new Set(normalizeAliases(app));
  const db: any = (env as any).DB;
  if (app.slug) {
    // Legacy votes may live under an id that no longer exists; a report keeps
    // the app_slug, so it lets us recover that old id.
    try {
      const rows: any = await db.prepare(
        `SELECT DISTINCT v.app_id AS alias
           FROM review_reports r JOIN star_votes v ON v.id = r.review_id
          WHERE r.app_slug = ?`,
      ).bind(app.slug).all();
      for (const r of rows?.results || []) if (r.alias) aliases.add(String(r.alias));
    } catch { /* table absent is fine */ }
  }
  return Array.from(aliases).filter(Boolean);
}

function inSql(aliases: string[]): string { return aliases.map(() => '?').join(','); }

/** Read-only, authoritative snapshot for one app (or a set of aliases). */
export async function ratingSnapshot(env: Env, aliases: string[]): Promise<VoteAggregate> {
  const keys = normalizeAliases(aliases);
  if (!keys.length) return { count: 0, sum: 0, rating: 0, dist: EMPTY_DIST(), reviews_count: 0 };
  const db: any = (env as any).DB;
  const inList = inSql(keys);
  const [agg, distRows, comments]: any[] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(rating), 0) AS s
                  FROM star_votes
                 WHERE rating BETWEEN 1 AND 5 AND app_id IN (${inList})`)
      .bind(...keys).first().catch(() => ({ n: 0, s: 0 })),
    db.prepare(`SELECT rating, COUNT(*) AS n
                  FROM star_votes
                 WHERE rating BETWEEN 1 AND 5 AND app_id IN (${inList})
                 GROUP BY rating`)
      .bind(...keys).all().catch(() => ({ results: [] })),
    db.prepare(`SELECT COUNT(*) AS n
                  FROM star_votes
                 WHERE app_id IN (${inList}) AND comment IS NOT NULL AND TRIM(comment) <> ''`)
      .bind(...keys).first().catch(() => ({ n: 0 })),
  ]);
  const count = Number(agg?.n || 0);
  const sum = Number(agg?.s || 0);
  const dist = EMPTY_DIST();
  for (const r of distRows?.results || []) {
    const key = String(Math.round(Number(r.rating) || 0));
    if (key in dist) dist[key] = Number(r.n || 0);
  }
  return {
    count, sum,
    rating: count > 0 ? Math.round((sum / count) * 10) / 10 : 0,
    dist, reviews_count: Number(comments?.n || 0),
  };
}

/** All apps in ONE query. Returns null when star_votes is unavailable, so
    callers can skip the overlay instead of zeroing legitimate stored values. */
export async function allVoteAggregates(env: Env): Promise<Map<string, { count: number; sum: number }> | null> {
  const db: any = (env as any).DB;
  try {
    const rows: any = await db.prepare(
      `SELECT app_id, COUNT(*) AS n, COALESCE(SUM(rating), 0) AS s
         FROM star_votes WHERE rating BETWEEN 1 AND 5 GROUP BY app_id`,
    ).all();
    const map = new Map<string, { count: number; sum: number }>();
    for (const r of rows?.results || []) {
      map.set(String(r.app_id), { count: Number(r.n || 0), sum: Number(r.s || 0) });
    }
    return map;
  } catch { return null; }
}

/** Pure helper: merge the id + slug buckets for one app. */
export function mergeAggregate(
  map: Map<string, { count: number; sum: number }>,
  aliases: string[],
): { count: number; sum: number; rating: number } {
  let count = 0, sum = 0;
  for (const key of new Set(normalizeAliases(aliases))) {
    const v = map.get(key);
    if (v) { count += v.count; sum += v.sum; }
  }
  return { count, sum, rating: count > 0 ? Math.round((sum / count) * 10) / 10 : 0 };
}

/** Recompute and persist one app's four counters. */
export async function recomputeAppRating(
  env: Env, app: { id: string; slug?: string }, aliases?: string[],
): Promise<VoteAggregate> {
  await ensureReviewTables(env);
  const keys = aliases && aliases.length ? aliases : await appAliases(env, app);
  const snap = await ratingSnapshot(env, keys);
  await (env as any).DB.prepare(
    'UPDATE apps SET rating = ?, rating_count = ?, rating_sum = ?, stars = ? WHERE id = ?',
  ).bind(snap.rating, snap.count, snap.sum, snap.count, app.id).run();
  return snap;
}

/** Repair drift for every app (only rows that actually differ are written). */
export async function recomputeAllRatings(env: Env): Promise<{ apps: number; changed: number; votes: number }> {
  await ensureReviewTables(env);
  const map = await allVoteAggregates(env);
  const db: any = (env as any).DB;
  const apps: any = await db.prepare(
    'SELECT id, slug, rating, rating_count, rating_sum, stars FROM apps',
  ).all().catch(() => ({ results: [] }));
  const rows: any[] = apps?.results || [];
  const statements: any[] = [];
  let changed = 0;
  for (const a of rows) {
    if (!map) break;
    const snap = mergeAggregate(map, [String(a.id), String(a.slug || '')]);
    if (Number(a.rating || 0) !== snap.rating
      || Number(a.rating_count || 0) !== snap.count
      || Number(a.rating_sum || 0) !== snap.sum
      || Number(a.stars || 0) !== snap.count) {
      statements.push(db.prepare(
        'UPDATE apps SET rating = ?, rating_count = ?, rating_sum = ?, stars = ? WHERE id = ?',
      ).bind(snap.rating, snap.count, snap.sum, snap.count, a.id));
      changed++;
    }
  }
  for (let i = 0; i < statements.length; i += 100) {
    try { await db.batch(statements.slice(i, i + 100)); } catch { /* best effort */ }
  }
  let votes = 0;
  if (map) for (const v of map.values()) votes += v.count;
  return { apps: rows.length, changed, votes };
}

/** Resolve a vote's app_id to a real app row, tolerating slug/legacy ids. */
export async function resolveRatingsApp(
  env: Env, rawAppId: string, reviewId?: string,
): Promise<{ id: string; slug: string } | null> {
  const key = String(rawAppId || '').trim();
  if (!key) return null;
  const db: any = (env as any).DB;
  let row: any = await db.prepare(
    'SELECT id, slug FROM apps WHERE id = ? OR slug = ? LIMIT 1',
  ).bind(key, key).first().catch(() => null);
  if (!row && reviewId) {
    row = await db.prepare(
      `SELECT a.id, a.slug FROM review_reports r
         JOIN apps a ON a.slug = r.app_slug
        WHERE r.review_id = ? LIMIT 1`,
    ).bind(reviewId).first().catch(() => null);
  }
  return row ? { id: String(row.id), slug: String(row.slug || '') } : null;
}

/* =========================================================================
   Admin visibility for "silent" votes (rating given without a comment).
   They stay part of the average, but the owner must be able to see and remove
   them: otherwise deleting the last written comment leaves a number that looks
   like a ghost of the deleted review.
   ========================================================================= */
export async function listAllReviewsForAdmin(env: Env, limit = 1000): Promise<any[]> {
  await ensureReviewTables(env);
  const db: any = (env as any).DB;
  const rows: any = await db.prepare(`
    SELECT v.id, v.app_id, v.rating, v.comment, v.name, v.uid, v.ts,
      COALESCE((SELECT a.slug FROM apps a WHERE a.id = v.app_id OR a.slug = v.app_id LIMIT 1), v.app_id) AS app_slug,
      COALESCE((SELECT a.name FROM apps a WHERE a.id = v.app_id OR a.slug = v.app_id LIMIT 1), v.app_id) AS app_name
    FROM star_votes v
    ORDER BY v.ts DESC, v.id DESC
    LIMIT ?
  `).bind(Math.min(Math.max(limit, 1), 2000)).all().catch(() => ({ results: [] }));
  return (rows?.results || []).map((r: any) => ({
    id: String(r.id), app_id: String(r.app_id || ''),
    app_slug: String(r.app_slug || ''), app_name: String(r.app_name || r.app_slug || '—'),
    rating: Number(r.rating || 0),
    comment: String(r.comment || '').trim(),
    silent: !String(r.comment || '').trim(),
    author: String(r.name || ''), uid: String(r.uid || ''), ts: Number(r.ts || 0),
  }));
}

/** Remove every vote that carries no written comment, then recompute.
    Explicit admin action: the counting RULE is unchanged, only these rows go. */
export async function purgeSilentVotes(env: Env): Promise<{ deleted: number; apps: number; changed: number }> {
  await ensureReviewTables(env);
  const db: any = (env as any).DB;
  const rows: any = await db.prepare(
    `SELECT id FROM star_votes WHERE comment IS NULL OR TRIM(comment) = ''`,
  ).all().catch(() => ({ results: [] }));
  const ids: string[] = (rows?.results || []).map((r: any) => String(r.id));
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const stmts: any[] = [];
    for (const id of chunk) {
      stmts.push(db.prepare('DELETE FROM review_likes WHERE review_id = ?').bind(id));
      stmts.push(db.prepare('DELETE FROM review_reports WHERE review_id = ?').bind(id));
      stmts.push(db.prepare('DELETE FROM star_votes WHERE id = ?').bind(id));
    }
    try { await db.batch(stmts); } catch { /* best effort */ }
  }
  const repair = await recomputeAllRatings(env);
  return { deleted: ids.length, apps: repair.apps, changed: repair.changed };
}
