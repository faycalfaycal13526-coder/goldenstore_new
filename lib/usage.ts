/* =========================================================================
   Resource-usage tracking — D1 counters + optional Cloudflare GraphQL API.
   Kept independent of lib/push.ts / lib/firebase.ts to avoid import cycles.
   ========================================================================= */
import type { Env } from './env.js';
import { nowSec } from './utils.js';

const USAGE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS firebase_usage (
     day TEXT PRIMARY KEY,
     reads INTEGER NOT NULL DEFAULT 0,
     writes INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL
   )`,
];
const usageSchemaReady = new WeakSet<object>();

export async function ensureUsageSchema(env: Env): Promise<void> {
  const db: any = env.DB;
  if (usageSchemaReady.has(db)) return;
  for (const sql of USAGE_SCHEMA) await db.prepare(sql).run();
  usageSchemaReady.add(db);
}

/** Fire-and-forget-friendly counter. Never throws into the caller. */
export async function recordFirebaseUsage(env: Env, kind: 'reads' | 'writes', count = 1): Promise<void> {
  try {
    await ensureUsageSchema(env);
    const day = new Date().toISOString().slice(0, 10);
    const column = kind === 'reads' ? 'reads' : 'writes';
    await env.DB.prepare(`INSERT INTO firebase_usage (day, reads, writes, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET ${column} = ${column} + excluded.${column},
          updated_at = excluded.updated_at`)
      .bind(day, kind === 'reads' ? count : 0, kind === 'writes' ? count : 0, nowSec()).run();
  } catch (error: any) {
    console.warn('[usage] firebase counter failed:', error?.message || error);
  }
}

export async function firebaseUsage(env: Env, days = 7): Promise<any[]> {
  await ensureUsageSchema(env);
  const rows: any = await env.DB.prepare(
    'SELECT day, reads, writes FROM firebase_usage ORDER BY day DESC LIMIT ?',
  ).bind(Math.max(1, Math.min(days, 31))).all().catch(() => ({ results: [] }));
  return rows.results || [];
}

/** Cloudflare GraphQL Analytics API. Requires a CF_API_TOKEN secret.
    Without it we return { configured:false } so the dashboard degrades
    gracefully instead of failing the whole analytics request. */
export async function cloudflareUsage(env: Env): Promise<any> {
  const token = String((env as any).CF_API_TOKEN || '').trim();
  const accountTag = String((env as any).CF_ACCOUNT_ID || (env as any).R2_ACCOUNT_ID || '').trim();
  if (!token || !accountTag) {
    return { configured: false, requests: 0, bytes: 0, series: [],
      hint: 'Set CF_API_TOKEN (and optionally CF_ACCOUNT_ID) as Worker secrets to enable Cloudflare Analytics.' };
  }
  const until = new Date();
  const since = new Date(until.getTime() - 7 * 86400 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const query = `query GsUsage($account: String!, $since: Date!, $until: Date!) {
    viewer {
      accounts(filter: { accountTag: $account }) {
        httpRequests1dGroups(limit: 7, filter: { date_geq: $since, date_leq: $until }) {
          dimensions { date }
          sum { requests bytes }
        }
      }
    }
  }`;
  try {
    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { account: accountTag, since: iso(since), until: iso(until) } }),
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok || payload?.errors?.length) throw new Error(String(payload?.errors?.[0]?.message || response.statusText));
    const groups = payload?.data?.viewer?.accounts?.[0]?.httpRequests1dGroups || [];
    const series = groups.map((g: any) => ({
      date: String(g?.dimensions?.date || ''),
      requests: Number(g?.sum?.requests || 0),
      bytes: Number(g?.sum?.bytes || 0),
    }));
    return {
      configured: true,
      requests: series.reduce((a: number, b: any) => a + b.requests, 0),
      bytes: series.reduce((a: number, b: any) => a + b.bytes, 0),
      series,
    };
  } catch (error: any) {
    console.error('[usage] Cloudflare GraphQL failed:', error?.message || error);
    return { configured: true, error: String(error?.message || error), requests: 0, bytes: 0, series: [] };
  }
}
