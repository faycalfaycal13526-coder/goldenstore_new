// ============================================================
// lib/d1.ts — طبقة التعامل مع Cloudflare D1
// بديل lib/firebase.ts بالنسبة لجداول البيانات
// ============================================================

import type { Env } from './env.js';

// ============================================================
// تحويل صف D1 إلى كائن يشبه ما كان Firestore يعيده
// ============================================================
export function rowToApp(row: any): any {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    name_lower: row.name_lower,
    search_terms: JSON.parse(row.search_terms || '[]'),
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
// listApps — جلب كل التطبيقات من D1
// بديل: db.collection('apps').get()
// ============================================================
export async function listApps(env: Env): Promise<any[]> {
  const result = await env.DB
    .prepare('SELECT * FROM apps ORDER BY created_at DESC')
    .all();

  return (result.results || []).map(rowToApp);
}
