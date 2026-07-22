let app: any = null;
let db: any = null;

type FirebaseCredentials = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function stripWrappingQuotes(raw: string): string {
  let value = raw.trim();
  while (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function maybeDecodeBase64(raw: string): string {
  const value = stripWrappingQuotes(raw);
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value) || value.length % 4 !== 0) return value;
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8').trim();
    if (
      decoded.includes('BEGIN') ||
      decoded.includes('PRIVATE KEY') ||
      decoded.startsWith('{')
    ) {
      return decoded;
    }
  } catch {}
  return value;
}

function normalizePrivateKey(raw: string): string {
  let key = maybeDecodeBase64(raw);
  if (!key.includes('BEGIN') && /^[A-Za-z0-9+/=\s]+$/.test(key.trim())) {
    try {
      const decoded = Buffer.from(key.trim(), 'base64').toString('utf8');
      if (decoded.includes('BEGIN') && decoded.includes('PRIVATE KEY')) key = decoded;
    } catch {}
  }
  key = stripWrappingQuotes(key);
  key = key.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r/g, '');
  key = key.trim();
  if (!key.endsWith('\n')) key += '\n';
  return key;
}

function parseServiceAccount(raw: string): FirebaseCredentials | null {
  const value = maybeDecodeBase64(raw);
  const candidates = [value, value.replace(/\n/g, '\\n')];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(stripWrappingQuotes(candidate)) as unknown;
      if (!parsed || typeof parsed !== 'object') continue;
      const serviceAccount = parsed as Record<string, unknown>;
      const projectId = serviceAccount.project_id;
      const clientEmail = serviceAccount.client_email;
      const privateKey = serviceAccount.private_key;
      if (
        typeof projectId === 'string' &&
        typeof clientEmail === 'string' &&
        typeof privateKey === 'string'
      ) {
        return {
          projectId,
          clientEmail,
          privateKey: normalizePrivateKey(privateKey),
        };
      }
    } catch {}
  }
  return null;
}

function getCredentials(): FirebaseCredentials {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccount) {
    const creds = parseServiceAccount(serviceAccount);
    if (!creds) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT is malformed. Paste the complete Firebase service account JSON.',
      );
    }
    return creds;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey = process.env.FIREBASE_PRIVATE_KEY_BASE64 || process.env.FIREBASE_PRIVATE_KEY;

  if (rawKey) {
    const creds = parseServiceAccount(rawKey);
    if (creds) return creds;
  }

  if (!projectId || !clientEmail || !rawKey) {
    throw new Error(
      'Firebase credentials missing. Set FIREBASE_SERVICE_ACCOUNT, or set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY (or FIREBASE_PRIVATE_KEY_BASE64).',
    );
  }
  const privateKey = normalizePrivateKey(rawKey);
  if (!privateKey.includes('BEGIN') || !privateKey.includes('PRIVATE KEY')) {
    throw new Error(
      'FIREBASE_PRIVATE_KEY is malformed. Paste the full PEM key including the BEGIN/END markers, set FIREBASE_PRIVATE_KEY_BASE64 to the base64-encoded PEM, or set FIREBASE_SERVICE_ACCOUNT to the complete JSON.',
    );
  }
  return { projectId, clientEmail, privateKey };
}

export async function firebaseApp() {
  if (app) return app;
  const { cert, getApps, initializeApp } = await import('firebase-admin/app');
  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0];
    return app;
  }
  const creds = getCredentials();
  app = initializeApp({
    credential: cert({
      projectId: creds.projectId,
      clientEmail: creds.clientEmail,
      privateKey: creds.privateKey,
    }),
    projectId: creds.projectId,
  });
  return app;
}

export async function firestore() {
  if (db) return db;
  const { getFirestore } = await import('firebase-admin/firestore');
  const fbApp = await firebaseApp();
  db = getFirestore(fbApp);
  db.settings({ ignoreUndefinedProperties: true, preferRest: true });
  return db;
}

export async function getFieldValue() {
  const { FieldValue } = await import('firebase-admin/firestore');
  return FieldValue;
}

export async function messaging() {
  const { getMessaging } = await import('firebase-admin/messaging');
  const fbApp = await firebaseApp();
  return getMessaging(fbApp);
}

export async function getAuthAdmin() {
  const { getAuth } = await import('firebase-admin/auth');
  const fbApp = await firebaseApp();
  return getAuth(fbApp);
}

export async function verifyFirebaseToken(idToken: string): Promise<{ uid: string; email?: string; name?: string } | null> {
  try {
    const { getAuth } = await import('firebase-admin/auth');
    const fbApp = await firebaseApp();
    const decoded = await getAuth(fbApp).verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email, name: decoded.name };
  } catch (err) {
    // Surface the real reason (missing/misconfigured Firebase Admin credentials,
    // project mismatch, expired token, …) in server logs. Silent failures here
    // make the points page look broken with an opaque 401.
    console.error('[firebase] verifyIdToken failed:', (err as any)?.message || err);
    return null;
  }
}
