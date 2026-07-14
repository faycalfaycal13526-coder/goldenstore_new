export function slugify(input: string): string {
  return (input || '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'app';
}

export function searchTerms(...inputs: (string | undefined | null)[]): string[] {
  const set = new Set<string>();
  for (const raw of inputs) {
    if (!raw) continue;
    const words = raw
      .toString()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && w.length <= 30);
    for (const w of words) set.add(w);
  }
  return Array.from(set).slice(0, 80);
}

export function safeExt(filename: string, fallback = 'bin'): string {
  const m = (filename || '').match(/\.([a-zA-Z0-9]{1,8})$/);
  return m ? m[1].toLowerCase() : fallback;
}

export function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// --- Security: Input sanitization ---

/** Strip HTML tags, control chars, and limit length to prevent XSS/injection. */
export function sanitizeText(input: unknown, maxLength = 5000): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[<>]/g, '') // strip angle brackets (anti-XSS)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // remove control chars
    .trim()
    .slice(0, maxLength);
}

/** Sanitize a URL — only allow http/https protocols. */
export function sanitizeUrl(input: unknown, maxLength = 2048): string {
  if (typeof input !== 'string') return '';
  const cleaned = input.trim().slice(0, maxLength);
  if (!cleaned) return '';
  try {
    const url = new URL(cleaned);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

/** Validate that a value is a safe integer within bounds. */
export function safeInt(input: unknown, min = 0, max = 2147483647): number {
  const n = Number(input);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** Prevent NoSQL injection: strip $ and . prefixed keys from objects. */
export function sanitizeQuery(obj: unknown): Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    // Block keys starting with $ (operator injection) or containing ..
    if (key.startsWith('$') || key.includes('..')) continue;
    if (typeof val === 'string') {
      safe[key] = val.slice(0, 1000);
    } else if (typeof val === 'number' && Number.isFinite(val)) {
      safe[key] = val;
    } else if (typeof val === 'boolean') {
      safe[key] = val;
    }
    // Ignore nested objects/arrays to prevent deep injection
  }
  return safe;
}
