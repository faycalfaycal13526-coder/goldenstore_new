import { AwsClient } from 'aws4fetch';
import type { Env } from './env.js';

const XML_NAMESPACE = 'http://s3.amazonaws.com/doc/2006-03-01/';

function r2Credentials(env: Env) {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials are missing. Configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.');
  }
  return { accountId, accessKeyId, secretAccessKey };
}

function clientFor(env: Env): AwsClient {
  const { accessKeyId, secretAccessKey } = r2Credentials(env);
  // aws4fetch retries a 5xx/429 ten times by default with exponential backoff,
  // which turns one failed delete into eleven requests and a false "still there"
  // verdict long after the admin request should have answered. Two retries is
  // enough for a transient blip; the caller reports the truth either way.
  return new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto', retries: 2, initRetryMs: 150 });
}

export function r2Bucket(env: Env): string {
  return env.R2_BUCKET || 'goldenstore';
}

function objectUrl(env: Env, key: string): URL {
  const { accountId } = r2Credentials(env);
  const bucket = encodeURIComponent(r2Bucket(env));
  const objectKey = key.split('/').map(encodeURIComponent).join('/');
  return new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${objectKey}`);
}

async function checkedFetch(env: Env, url: URL, init: RequestInit): Promise<Response> {
  const response = await clientFor(env).fetch(url, init);
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 800);
    throw new Error(`R2 request failed (${response.status}): ${detail || response.statusText}`);
  }
  return response;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function r2PublicUrl(key: string, env: Env): string {
  const base = (env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('R2_PUBLIC_URL is not configured.');
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function r2PresignPut(
  env: Env,
  key: string,
  contentType: string,
  expiresInSeconds = 600,
): Promise<string> {
  const url = objectUrl(env, key);
  url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
  const signed = await clientFor(env).sign(
    new Request(url, { method: 'PUT', headers: { 'Content-Type': contentType } }),
    { aws: { signQuery: true } },
  );
  return signed.url.toString();
}

export async function r2PresignGet(
  env: Env,
  key: string,
  expiresInSeconds = 600,
  responseContentDisposition?: string,
): Promise<string> {
  const url = objectUrl(env, key);
  url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
  if (responseContentDisposition) {
    url.searchParams.set('response-content-disposition', responseContentDisposition);
  }
  const signed = await clientFor(env).sign(new Request(url, { method: 'GET' }), {
    aws: { signQuery: true },
  });
  return signed.url.toString();
}

/**
 * Delete one object and REPORT what happened.
 *
 * The old version returned void, so every caller wrote `.catch(() => {})` and a
 * failed delete was indistinguishable from a successful one: the row vanished
 * from the dashboard while the APK stayed in the bucket (exactly what the owner
 * saw in the Cloudflare console). Returning a boolean lets the admin endpoint
 * tell the truth, count leftovers and retry them.
 *
 * S3/R2 DELETE is idempotent: deleting a missing key answers 204, so `true`
 * simply means "the object is not there any more".
 */
/**
 * Stream one object out of the bucket for the `/media/<key>` route.
 *
 * The Worker reads with its own credentials, so the picture never has to be
 * public: no r2.dev hostname in the HTML, no second origin for the phone to
 * connect to, and — most importantly — the route can set a Cache-Control the
 * bucket's public URL does not send at all (verified: an r2.dev object answers
 * with only ETag + Last-Modified).
 *
 * `null` means the object is not there; a 304 (from If-None-Match) is passed
 * through untouched so the browser keeps its copy.
 */
export async function r2GetObject(
  env: Env,
  key: string,
  range?: string,
  ifNoneMatch?: string,
): Promise<Response | null> {
  const headers: Record<string, string> = {};
  if (range) headers.range = range;
  if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;
  try {
    const response = await clientFor(env).fetch(objectUrl(env, key), { method: 'GET', headers });
    if (response.status === 404) return null;
    if (!response.ok && response.status !== 206 && response.status !== 304) return null;
    return response;
  } catch {
    return null;
  }
}

export async function r2DeleteStrict(env: Env, key: string): Promise<boolean> {
  try {
    const response = await clientFor(env).fetch(objectUrl(env, key), { method: 'DELETE' });
    // 404 = already gone (fine). Everything under 500 is "not there any more".
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export async function r2Delete(env: Env, key: string): Promise<void> {
  await r2DeleteStrict(env, key);
}

/**
 * Bulk delete (R2's DeleteObjects API, max 1000 keys per call).
 *
 * A stuck APK can be many hundreds of megabytes; deleting the same file twenty
 * times over the network, one request each, used to time out the admin request
 * halfway — which is why some objects survived a delete. One call per 1000 keys
 * keeps cleanup inside the Worker's CPU/network budget.
 * Returns the keys that could NOT be confirmed deleted.
 */
export async function r2DeleteMany(env: Env, keys: string[]): Promise<string[]> {
  const list = [...new Set(keys.filter(Boolean))];
  const failed: string[] = [];
  for (let i = 0; i < list.length; i += 1000) {
    const chunk = list.slice(i, i + 1000);
    const url = new URL(
      `https://${r2Credentials(env).accountId}.r2.cloudflarestorage.com/${encodeURIComponent(r2Bucket(env))}`,
    );
    url.searchParams.set('delete', '');
    const body = `<?xml version="1.0" encoding="UTF-8"?><Delete xmlns="${XML_NAMESPACE}">` +
      chunk.map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`).join('') +
      `<Quiet>false</Quiet></Delete>`;
    try {
      // Objects are addressed by key inside the XML, so the body must be signed
      // as-is (aws4fetch hashes it) — no per-key URL encoding here.
      const response = await clientFor(env).fetch(new URL(url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body,
      });
      if (!response.ok) { failed.push(...chunk); continue; }
      const xml = await response.text().catch(() => '');
      // Only keys R2 explicitly reports as failed are retried one by one.
      const reported = [...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((m) => m[1]
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
      for (const k of reported) {
        if (chunk.includes(k) && !(await r2DeleteStrict(env, k))) failed.push(k);
      }
    } catch {
      failed.push(...chunk);
    }
  }
  return failed;
}

/**
 * Every object key under a prefix, paginated (1000 per page).
 * Used by the orphan sweep: files that no database row points at any more.
 */
export async function r2List(env: Env, prefix: string, maxKeys = 5000): Promise<{ key: string; size: number; lastModified?: string }[]> {
  const out: { key: string; size: number; lastModified?: string }[] = [];
  let token: string | undefined;
  while (out.length < maxKeys) {
    const url = new URL(
      `https://${r2Credentials(env).accountId}.r2.cloudflarestorage.com/${encodeURIComponent(r2Bucket(env))}`,
    );
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', prefix);
    url.searchParams.set('max-keys', String(Math.min(1000, maxKeys - out.length)));
    if (token) url.searchParams.set('continuation-token', token);
    let xml = '';
    try {
      const response = await clientFor(env).fetch(url, { method: 'GET' });
      if (!response.ok) break;
      xml = await response.text();
    } catch { break; }
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = m[1];
      const key = (block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      const size = Number(block.match(/<Size>([\s\S]*?)<\/Size>/)?.[1] || 0);
      const lastModified = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1];
      if (key) out.push({ key, size, lastModified });
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml);
    token = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1];
    if (!truncated || !token) break;
  }
  return out;
}

/**
 * Multipart uploads that were started and never finished.
 *
 * This is the one kind of storage the dashboard's «Bucket Size» counts but the
 * object list cannot see: a 4 GB APK uploads in parts, and every part is already
 * billed and already contributes to the bucket size while it is still invisible
 * to ListObjects. A browser that is closed (or a mobile connection that drops)
 * halfway through leaves those parts behind for ever — that is how a bucket with
 * a catalogue of zero items reports hundreds of megabytes.
 *
 * Owner: «من اين اتى ذالك الحجم من التخزين» — this makes it countable and
 * deletable instead of a number in the Cloudflare console with no explanation.
 */
export async function r2MultipartUploads(env: Env): Promise<{ key: string; uploadId: string; initiated?: string }[]> {
  const out: { key: string; uploadId: string; initiated?: string }[] = [];
  let marker: string | undefined;
  for (let page = 0; page < 20; page++) {
    const url = new URL(
      `https://${r2Credentials(env).accountId}.r2.cloudflarestorage.com/${encodeURIComponent(r2Bucket(env))}`,
    );
    url.searchParams.set('uploads', '');
    if (marker) url.searchParams.set('key-marker', marker);
    let xml = '';
    try {
      const response = await clientFor(env).fetch(url, { method: 'GET' });
      if (!response.ok) break;
      xml = await response.text();
    } catch { break; }
    for (const m of xml.matchAll(/<Upload>([\s\S]*?)<\/Upload>/g)) {
      const block = m[1];
      const key = (block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      const uploadId = block.match(/<UploadId>([\s\S]*?)<\/UploadId>/)?.[1] || '';
      const initiated = block.match(/<Initiated>([\s\S]*?)<\/Initiated>/)?.[1];
      if (key && uploadId) out.push({ key, uploadId, initiated });
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml);
    marker = xml.match(/<NextKeyMarker>([\s\S]*?)<\/NextKeyMarker>/)?.[1];
    if (!truncated || !marker) break;
  }
  return out;
}

/** Drop the leftover parts of one unfinished multipart upload. */
export async function r2AbortMultipartUploadByKey(env: Env, key: string, uploadId: string): Promise<boolean> {
  try {
    const url = new URL(
      `https://${r2Credentials(env).accountId}.r2.cloudflarestorage.com/${encodeURIComponent(r2Bucket(env))}/${key.split('/').map(encodeURIComponent).join('/')}`,
    );
    url.searchParams.set('uploadId', uploadId);
    const response = await clientFor(env).fetch(url, { method: 'DELETE' });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

export async function r2Head(
  env: Env, key: string,
): Promise<{ size: number; contentType: string; etag?: string | null } | null> {
  try {
    const response = await clientFor(env).fetch(objectUrl(env, key), { method: 'HEAD' });
    if (!response.ok) return null;
    return {
      size: Number(response.headers.get('content-length') || 0),
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      // R2 answers with an ETag for every object. The storage sweep uses it as a
      // content fingerprint: two keys with the same ETag and size are the same
      // file, without downloading either of them.
      etag: response.headers.get('etag'),
    };
  } catch {
    return null;
  }
}

// --- Multipart upload helpers for large files ---

export async function r2CreateMultipartUpload(
  env: Env,
  key: string,
  contentType: string,
): Promise<string> {
  const url = objectUrl(env, key);
  url.searchParams.set('uploads', '');
  const response = await checkedFetch(env, url, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
  });
  const xml = await response.text();
  const uploadId = xml.match(/<UploadId>([\s\S]*?)<\/UploadId>/i)?.[1];
  if (!uploadId) throw new Error('R2 multipart initiation did not return an upload id.');
  return uploadId.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export async function r2PresignUploadPart(
  env: Env,
  key: string,
  uploadId: string,
  partNumber: number,
  expiresInSeconds = 3600,
): Promise<string> {
  const url = objectUrl(env, key);
  url.searchParams.set('partNumber', String(partNumber));
  url.searchParams.set('uploadId', uploadId);
  url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
  const signed = await clientFor(env).sign(new Request(url, { method: 'PUT' }), {
    aws: { signQuery: true },
  });
  return signed.url.toString();
}

export async function r2CompleteMultipartUpload(
  env: Env,
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[],
): Promise<void> {
  const url = objectUrl(env, key);
  url.searchParams.set('uploadId', uploadId);
  const partsXml = [...parts]
    .sort((a, b) => a.PartNumber - b.PartNumber)
    .map((part) => `<Part><PartNumber>${Math.trunc(part.PartNumber)}</PartNumber><ETag>${escapeXml(part.ETag)}</ETag></Part>`)
    .join('');
  const body = `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload xmlns="${XML_NAMESPACE}">${partsXml}</CompleteMultipartUpload>`;
  await checkedFetch(env, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body,
  });
}

export async function r2AbortMultipartUpload(env: Env, key: string, uploadId: string): Promise<void> {
  try {
    const url = objectUrl(env, key);
    url.searchParams.set('uploadId', uploadId);
    await checkedFetch(env, url, { method: 'DELETE' });
  } catch {
    // Best-effort cleanup, matching the prior Admin SDK helper behavior.
  }
}

export async function r2ConfigureCors(env: Env, allowedOrigins: string[]): Promise<void> {
  if (!allowedOrigins.length) throw new Error('No allowed origins were configured for the R2 bucket.');
  const { accountId } = r2Credentials(env);
  const bucketUrl = new URL(
    `https://${accountId}.r2.cloudflarestorage.com/${encodeURIComponent(r2Bucket(env))}`,
  );
  bucketUrl.searchParams.set('cors', '');
  const originsXml = allowedOrigins.map((origin) => `<AllowedOrigin>${escapeXml(origin)}</AllowedOrigin>`).join('');
  const body =
    `<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration xmlns="${XML_NAMESPACE}">` +
    `<CORSRule>${originsXml}<AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod>` +
    `<AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader>` +
    `<MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
  await checkedFetch(env, bucketUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/xml' },
    body,
  });
}

/* ── R2 object organisation ───────────────────────────────────────────────────
 * Every upload used to be stored as `<folder>/<slug>-<epoch>-<hex>.<ext>`, so a
 * single game ended up as three unrelated timestamped names. There is no way to
 * tell from the key what an object belongs to, and re-publishing the same item
 * silently accumulated more of them.
 *
 * organiseKey() turns a key into `<folder>/<slug>.<ext>` — deterministic, stable
 * and human-readable. Moving is a server-side copy + delete, so the bytes never
 * travel through the Worker and the public URL keeps working immediately after
 * the row is updated.
 */
export async function r2Copy(env: Env, from: string, to: string): Promise<boolean> {
  const client = clientFor(env);
  try {
    const head = await client.fetch(objectUrl(env, from), { method: 'HEAD' });
    if (!head.ok) return false;
    const contentType = head.headers.get('content-type') || 'application/octet-stream';
    const body = await client.fetch(objectUrl(env, from), { method: 'GET' });
    if (!body.ok) return false;
    const bytes = await body.arrayBuffer();
    const put = await client.fetch(objectUrl(env, to), {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: bytes,
    });
    return put.ok;
  } catch {
    return false;
  }
}

/** `<folder>/<slug>-1795700575988-8e7c9e.apk` → `apk/subway-surfers.apk`.
 *  Keys that are already organised come back unchanged. */
export function organiseKey(key: string, slug: string, ext?: string): string {
  const clean = String(key || '').trim();
  if (!clean) return clean;
  const slash = clean.lastIndexOf('/');
  const folder = slash >= 0 ? clean.slice(0, slash) : '';
  const base = slash >= 0 ? clean.slice(slash + 1) : clean;
  const dot = base.lastIndexOf('.');
  const realExt = (ext || (dot >= 0 ? base.slice(dot + 1) : '')).toLowerCase();
  const safeSlug = String(slug || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
  const wanted = `${folder ? folder + '/' : ''}${safeSlug}${realExt ? '.' + realExt : ''}`;
  return wanted;
}

/** Moves `from` to `to`, then removes the old object. Returns the final key. */
export async function r2Move(env: Env, from: string, to: string): Promise<{ ok: boolean; key: string; error?: string }> {
  if (from === to) return { ok: true, key: to };
  const head = await r2Head(env, from).catch(() => null);
  if (!head) return { ok: false, key: from, error: 'source_missing' };
  const copied = await r2Copy(env, from, to).catch(() => false);
  if (!copied) return { ok: false, key: from, error: 'copy_failed' };
  // Verify the destination really exists before deleting the original.
  const check = await r2Head(env, to).catch(() => null);
  if (!check || !check.size) return { ok: false, key: from, error: 'copy_unverified' };
  const removed = await r2DeleteStrict(env, from);
  if (!removed) return { ok: true, key: to, error: 'old_object_left_behind' };
  return { ok: true, key: to };
}
