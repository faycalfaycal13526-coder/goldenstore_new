import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const COOKIE_NAME = 'gs_admin';
const encoder = new TextEncoder();

type AdminJwtPayload = JWTPayload & Record<string, unknown>;

export async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds = 7 * 24 * 60 * 60,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(encoder.encode(secret));
}

export async function verifyJwt(token: string, secret: string): Promise<AdminJwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      algorithms: ['HS256'],
    });
    return payload as AdminJwtPayload;
  } catch {
    return null;
  }
}

/** Constant-work UTF-8 comparison for credentials of potentially different lengths. */
export function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let difference = aBytes.length ^ bBytes.length;
  const length = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < length; i++) {
    difference |= (aBytes[i] || 0) ^ (bBytes[i] || 0);
  }
  return difference === 0;
}

export { COOKIE_NAME };
