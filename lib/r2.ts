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
  return new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
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

export async function r2Head(env: Env, key: string): Promise<{ size: number; contentType: string } | null> {
  try {
    const response = await clientFor(env).fetch(objectUrl(env, key), { method: 'HEAD' });
    if (!response.ok) return null;
    return {
      size: Number(response.headers.get('content-length') || 0),
      contentType: response.headers.get('content-type') || 'application/octet-stream',
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
