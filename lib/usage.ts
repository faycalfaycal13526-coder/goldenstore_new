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
  const limit = Math.max(1, Math.min(days, 31));
  const rows: any = await env.DB.prepare(
    'SELECT day, reads, writes FROM firebase_usage ORDER BY day DESC LIMIT ?',
  ).bind(limit).all().catch(() => ({ results: [] }));
  const byDay = new Map<string, any>();
  for (const r of (rows.results || []) as any[]) byDay.set(String(r.day), r);
  // ALWAYS return `days` rows so the dashboard explicitly shows 0 instead of
  // an empty section on a quiet day (and right after deployment).
  const out: any[] = [];
  const today = new Date();
  for (let i = 0; i < limit; i++) {
    const day = new Date(today.getTime() - i * 86400 * 1000).toISOString().slice(0, 10);
    const r = byDay.get(day);
    out.push({ day, reads: Number(r?.reads || 0), writes: Number(r?.writes || 0) });
  }
  return out;
}

/* -------------------------------------------------------------------
   Cloudflare GraphQL Analytics API
   -------------------------------------------------------------------
   Cloudflare's daily HTTP dataset uses `date_geq` + `date_lt` (NOT
   `date_leq`), String variables and lives either under viewer.accounts or
   viewer.zones depending on the API token scope. A zone-scoped token returns
   an EMPTY accounts array, which used to be silently reported as zero usage.
   ------------------------------------------------------------------- */
const CF_GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const CF_METRICS = `dimensions { date }
          sum { requests bytes cachedRequests cachedBytes pageViews threats }`;

const CF_ACCOUNT_QUERY = `query GsUsage($tag: String!, $since: String!, $until: String!) {
  viewer {
    accounts(filter: { accountTag: $tag }) {
      httpRequests1dGroups(limit: 31, filter: { date_geq: $since, date_lt: $until }, orderBy: [date_ASC]) {
        ${CF_METRICS}
      }
    }
  }
}`;
const CF_ZONE_QUERY = `query GsUsage($tag: String!, $since: String!, $until: String!) {
  viewer {
    zones(filter: { zoneTag: $tag }) {
      httpRequests1dGroups(limit: 31, filter: { date_geq: $since, date_lt: $until }, orderBy: [date_ASC]) {
        ${CF_METRICS}
      }
    }
  }
}`;

function cfConfig(env: Env) {
  const token = String(env.CF_API_TOKEN || '').trim();
  const accountTag = String(env.CF_ACCOUNT_ID || env.R2_ACCOUNT_ID || '').trim();
  const zoneTag = String(env.CF_ZONE_ID || '').trim();
  return { token, accountTag, zoneTag, config: {
    endpoint: CF_GRAPHQL_ENDPOINT,
    has_token: !!token,
    token_tail: token ? token.slice(-4) : '',   // never expose the secret
    has_account: !!accountTag,
    account_source: env.CF_ACCOUNT_ID ? 'CF_ACCOUNT_ID' : (env.R2_ACCOUNT_ID ? 'R2_ACCOUNT_ID' : null),
    has_zone: !!zoneTag,
  } };
}

async function cfRequest(token: string, query: string, variables: Record<string, string>) {
  const response = await fetch(CF_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  let payload: any = {};
  try { payload = JSON.parse(text); } catch { /* non-JSON error page */ }
  return { status: response.status, ok: response.ok, payload, raw: text.slice(0, 600) };
}

/** Returns explicit zeros + a precise reason when it cannot fetch data. */
export async function cloudflareUsage(env: Env, opts: { debug?: boolean } = {}): Promise<any> {
  const { token, accountTag, zoneTag, config } = cfConfig(env);
  const empty = { configured: false, requests: 0, bytes: 0, cached_requests: 0,
    cached_bytes: 0, page_views: 0, threats: 0, series: [], source: null as string | null,
    config, attempts: [] as any[] };
  if (!token || (!accountTag && !zoneTag)) {
    return { ...empty, error: 'missing_configuration',
      hint: 'Run `npx wrangler secret put CF_API_TOKEN` on the goldenstore-api Worker, plus CF_ACCOUNT_ID (or CF_ZONE_ID for a zone-scoped token). Secrets belong on the Worker, not only the Pages project.' };
  }

  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const since = iso(new Date(now.getTime() - 7 * 86400 * 1000));
  const until = iso(new Date(now.getTime() + 86400 * 1000)); // exclusive date_lt
  const attempts: any[] = [];
  let groups: any[] = [], source: string | null = null, lastError = '';

  const trySource = async (name: 'accounts' | 'zones', tag: string, query: string) => {
    try {
      const r = await cfRequest(token, query, { tag, since, until });
      const errors = Array.isArray(r.payload?.errors)
        ? r.payload.errors.map((e: any) => String(e?.message || e)) : [];
      const nodes = r.payload?.data?.viewer?.[name];
      attempts.push({
        source: name, status: r.status, errors,
        nodes: Array.isArray(nodes) ? nodes.length : null,
        ...(opts.debug ? { raw: r.raw } : {}),
      });
      if (!r.ok) { lastError = `HTTP ${r.status}: ${errors[0] || r.raw.slice(0, 160)}`; return; }
      if (errors.length) { lastError = errors[0]; return; }
      if (Array.isArray(nodes) && nodes.length) {
        groups = nodes[0]?.httpRequests1dGroups || [];
        source = name;
      } else if (!lastError) {
        lastError = 'no_visible_account_or_zone';
      }
    } catch (error: any) {
      attempts.push({ source: name, status: 0, errors: [String(error?.message || error)] });
      lastError = String(error?.message || error);
    }
  };

  if (accountTag) await trySource('accounts', accountTag, CF_ACCOUNT_QUERY);
  if (!source && zoneTag) await trySource('zones', zoneTag, CF_ZONE_QUERY);

  if (!source) {
    return { ...empty, configured: true, attempts,
      error: lastError || 'no_data',
      hint: 'The token cannot see any account/zone analytics. Create a token with "Account → Analytics: Read" (or "Zone → Analytics: Read" + CF_ZONE_ID), then set it with: npx wrangler secret put CF_API_TOKEN.' };
  }

  const series = (groups || []).map((g: any) => ({
    date: String(g?.dimensions?.date || '').slice(0, 10),
    requests: Number(g?.sum?.requests || 0),
    bytes: Number(g?.sum?.bytes || 0),
    cachedRequests: Number(g?.sum?.cachedRequests || 0),
    cachedBytes: Number(g?.sum?.cachedBytes || 0),
    pageViews: Number(g?.sum?.pageViews || 0),
    threats: Number(g?.sum?.threats || 0),
  }));
  const sum = (key: string) => series.reduce((a: number, b: any) => a + Number(b[key] || 0), 0);
  return {
    configured: true, source, from: since, until_exclusive: until,
    requests: sum('requests'), bytes: sum('bytes'),
    cached_requests: sum('cachedRequests'), cached_bytes: sum('cachedBytes'),
    page_views: sum('pageViews'), threats: sum('threats'),
    series, config, ...(opts.debug ? { attempts } : { attempts: [] }),
  };
}
