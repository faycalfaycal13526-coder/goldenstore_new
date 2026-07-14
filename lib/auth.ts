import crypto from 'node:crypto';

const COOKIE_NAME = 'gs_admin';

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Buffer {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds = 7 * 24 * 60 * 60,
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const h = base64UrlEncode(Buffer.from(JSON.stringify(header), 'utf8'));
  const p = base64UrlEncode(Buffer.from(JSON.stringify(fullPayload), 'utf8'));
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  return `${h}.${p}.${base64UrlEncode(sig)}`;
}

export function verifyJwt(token: string, secret: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const expected = base64UrlEncode(
      crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest(),
    );
    if (!constantTimeEqual(expected, s)) return null;
    const payload = JSON.parse(base64UrlDecode(p).toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export { COOKIE_NAME };
