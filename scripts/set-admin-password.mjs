/* Writes the admin password HASH into D1, straight through the Cloudflare API.
 *
 * Used because the Worker's HTTP route (/api/admin/password) needs a live Worker
 * session — and D1 is a separate service that stays reachable even when the
 * Worker itself is unavailable. The plain password is NEVER written anywhere:
 * only a PBKDF2-SHA256 hash (100k iterations, random salt).
 *
 * Required env: CLOUDFLARE_API_TOKEN (D1 Edit), CLOUDFLARE_ACCOUNT_ID,
 *               D1_DATABASE_ID, ADMIN_PASSWORD_SALT, ADMIN_PASSWORD_HASH
 *               — all supplied as GitHub Actions secrets, never in the repo.
 */
import { webcrypto } from 'node:crypto';

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB = process.env.D1_DATABASE_ID;
const SALT = (process.env.ADMIN_PASSWORD_SALT || '').trim();
const HASH = (process.env.ADMIN_PASSWORD_HASH || '').trim();

if (!ACCOUNT || !TOKEN || !DB) {
  console.error('missing CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID');
  process.exit(1);
}
if (!/^[0-9a-f]{32}$/.test(SALT) || !/^[0-9a-f]{64}$/.test(HASH)) {
  console.error('ADMIN_PASSWORD_SALT must be 32 hex chars and ADMIN_PASSWORD_HASH 64');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const statements = [
  `CREATE TABLE IF NOT EXISTS admin_preferences (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)`,
  `INSERT INTO admin_preferences (key, value, updated_at) VALUES ('admin_password_hash', '${HASH}', ${now}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  `INSERT INTO admin_preferences (key, value, updated_at) VALUES ('admin_password_salt', '${SALT}', ${now}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  `INSERT INTO admin_preferences (key, value, updated_at) VALUES ('admin_password_iterations', '100000', ${now}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  `INSERT INTO admin_preferences (key, value, updated_at) VALUES ('admin_password_updated_at', '${now}', ${now}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  `SELECT key, substr(value, 1, 12) AS value_prefix, updated_at FROM admin_preferences WHERE key LIKE 'admin_password%'`,
];

const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`;
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ sql: statements.join(';\n') }),
});
const body = await res.json().catch(() => null);
console.log('HTTP', res.status);
console.log(JSON.stringify(body, null, 1).slice(0, 2000));
if (!res.ok || !body?.success) process.exit(1);
const last = body.result?.[body.result.length - 1]?.results || [];
console.log('rows now in D1:', last.length);
for (const r of last) console.log('  ', r.key, '→', r.value_prefix + '…', 'at', r.updated_at);
