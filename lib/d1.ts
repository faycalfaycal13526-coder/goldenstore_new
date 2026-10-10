// ============================================================
// lib/d1.ts — طبقة التعامل مع Cloudflare D1
// ============================================================

import type { Env } from './env.js';

// ============================================================
// تحويل صف D1 إلى كائن يشبه ما كان Firestore يعيده
// ============================================================
export function rowToApp(row: any): any {
  let search_terms: any[] = [];
  try {
    search_terms = JSON.parse(row.search_terms || '[]');
  } catch {
    search_terms = [];
  }
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    name_lower: row.name_lower,
    search_terms,
    package_name: row.package_name,
    short_description: row.short_description,
    description: row.description,
    category: row.category,
    type: row.type,
    developer: row.developer,
    version_name: row.version_name,
    version_code: row.version_code,
    min_sdk: row.min_sdk,
    size_bytes: row.size_bytes,
    apk_key: row.apk_key,
    icon_key: row.icon_key,
    feature_key: row.feature_key,
    stars: row.stars,
    rating_sum: row.rating_sum,
    rating_count: row.rating_count,
    rating: row.rating,
    downloads: row.downloads,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ============================================================
// خيارات listApps
// ============================================================
export interface ListAppsOptions {
  q?: string;
  category?: string;
  type?: string;
  sort?: string;
  starredOnly?: boolean;
  limit?: number;
  offset?: number;
}

// ============================================================
// listApps — جلب التطبيقات من D1 مع فلترة وترتيب في SQL
// بديل: db.collection('apps').get()
// ============================================================
export async function listApps(
  env: Env,
  opts: ListAppsOptions = {}
): Promise<{ apps: any[]; total: number }> {
  const limit = Math.min(opts.limit ?? 24, 60);
  const offset = Math.max(opts.offset ?? 0, 0);

  // بناء شرط WHERE
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.type === 'game') {
    conditions.push("type = 'game'");
  } else if (opts.type === 'app') {
    conditions.push("type != 'game'");
  }

  if (opts.category) {
    conditions.push('category = ?');
    params.push(opts.category);
  }

  if (opts.starredOnly) {
    conditions.push('stars > 0');
  }

  // البحث النصي: نستخدم LIKE على name_lower و search_terms
  if (opts.q) {
    const token = opts.q.split(/\s+/).filter((w) => w.length >= 2)[0];
    if (token) {
      conditions.push('(name_lower LIKE ? OR search_terms LIKE ?)');
      params.push(`%${token}%`, `%${token}%`);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // بناء ORDER BY
  let orderBy = 'ORDER BY created_at DESC';
  if (opts.sort === 'popular') {
    orderBy = 'ORDER BY downloads DESC, rating DESC';
  } else if (opts.sort === 'stars' || opts.sort === 'rating') {
    orderBy = 'ORDER BY rating DESC, rating_count DESC';
  } else if (opts.sort === 'name') {
    orderBy = 'ORDER BY name_lower ASC';
  }

  // استعلام العدد الإجمالي
  const countSql = `SELECT COUNT(*) as total FROM apps ${whereClause}`;
  const countResult = await env.DB.prepare(countSql).bind(...params).first();
  const total = Number(countResult?.total ?? 0);

  // استعلام البيانات مع LIMIT / OFFSET
  const dataSql = `SELECT * FROM apps ${whereClause} ${orderBy} LIMIT ? OFFSET ?`;
  const dataResult = await env.DB.prepare(dataSql).bind(...params, limit, offset).all();
  const apps = (dataResult.results || []).map(rowToApp);

  return { apps, total };
}
