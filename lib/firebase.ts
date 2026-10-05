import { importPKCS8, SignJWT } from 'jose';
import type { Env } from './env.js';

type FirebaseCredentials = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

type FirestoreValue = Record<string, unknown>;
type FieldFilter = { field: string; operator: string; value: unknown };
type OrderClause = { field: string; direction: 'asc' | 'desc' };
type FieldTransformKind = 'increment' | 'serverTimestamp' | 'arrayUnion' | 'arrayRemove' | 'delete';

const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FIREBASE_AUTH_AUDIENCE =
  'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

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

function decodeBase64(raw: string): string {
  const normalized = raw.replace(/\s/g, '');
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function maybeDecodeBase64(raw: string): string {
  const value = stripWrappingQuotes(raw);
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value) || value.length % 4 !== 0) return value;
  try {
    const decoded = decodeBase64(value).trim();
    if (decoded.includes('BEGIN') || decoded.includes('PRIVATE KEY') || decoded.startsWith('{')) {
      return decoded;
    }
  } catch {
    // The input was not a valid base64-encoded credential.
  }
  return value;
}

function normalizePrivateKey(raw: string): string {
  let key = maybeDecodeBase64(raw);
  if (!key.includes('BEGIN') && /^[A-Za-z0-9+/=\s]+$/.test(key.trim())) {
    try {
      const decoded = decodeBase64(key.trim());
      if (decoded.includes('BEGIN') && decoded.includes('PRIVATE KEY')) key = decoded;
    } catch {
      // Keep the original so the validation below can produce a useful error.
    }
  }
  key = stripWrappingQuotes(key)
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .trim();
  return key.endsWith('\n') ? key : `${key}\n`;
}

function parseServiceAccount(raw: string): FirebaseCredentials | null {
  const value = maybeDecodeBase64(raw);
  for (const candidate of [value, value.replace(/\n/g, '\\n')]) {
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
    } catch {
      // Try the alternate newline representation.
    }
  }
  return null;
}

function getCredentials(env: Env): FirebaseCredentials {
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    const credentials = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
    if (!credentials) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is malformed; provide the complete service-account JSON.');
    }
    return credentials;
  }

  const rawKey = env.FIREBASE_PRIVATE_KEY_BASE64 || env.FIREBASE_PRIVATE_KEY || '';
  if (rawKey) {
    const serviceAccount = parseServiceAccount(rawKey);
    if (serviceAccount) return serviceAccount;
  }

  const projectId = env.FIREBASE_PROJECT_ID || '';
  const clientEmail = env.FIREBASE_CLIENT_EMAIL || '';
  if (!projectId || !clientEmail || !rawKey) {
    throw new Error(
      'Firebase credentials are missing. Set FIREBASE_SERVICE_ACCOUNT, or set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY (or FIREBASE_PRIVATE_KEY_BASE64).',
    );
  }
  const privateKey = normalizePrivateKey(rawKey);
  if (!privateKey.includes('BEGIN') || !privateKey.includes('PRIVATE KEY')) {
    throw new Error(
      'FIREBASE_PRIVATE_KEY is malformed; provide the complete PEM key, base64-encoded PEM, or complete service-account JSON.',
    );
  }
  return { projectId, clientEmail, privateKey };
}

async function getAccessToken(env: Env, scope: string): Promise<string> {
  const credentials = getCredentials(env);
  const cacheKey = `${credentials.projectId}:${credentials.clientEmail}:${scope}`;
  const cached = tokenCache.get(cacheKey);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 60) return cached.token;

  const key = await importPKCS8(credentials.privateKey, 'RS256');
  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(credentials.clientEmail)
    .setSubject(credentials.clientEmail)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(`Google OAuth token request failed (${response.status}): ${payload.error_description || 'no access token returned'}`);
  }
  const expiresIn = Number(payload.expires_in || 3600);
  tokenCache.set(cacheKey, { token: payload.access_token, expiresAt: now + expiresIn });
  return payload.access_token;
}

function encodeValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { doubleValue: String(value) };
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value instanceof Uint8Array) {
    let binary = '';
    for (let i = 0; i < value.length; i += 0x8000) {
      binary += String.fromCharCode(...value.subarray(i, i + 0x8000));
    }
    return { bytesValue: btoa(binary) };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.filter((item) => item !== undefined).map(encodeValue) } };
  }
  if (typeof value === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) fields[key] = encodeValue(item);
    }
    return { mapValue: { fields } };
  }
  throw new Error(`Unsupported Firestore value: ${typeof value}`);
}

function decodeValue(value: any): any {
  if (!value || typeof value !== 'object') return undefined;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('bytesValue' in value) {
    const binary = atob(value.bytesValue);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue?.fields || {});
  if ('referenceValue' in value) return value.referenceValue;
  return undefined;
}

function decodeFields(fields: Record<string, any> = {}): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(fields)) out[key] = decodeValue(value);
  return out;
}

function fieldPath(path: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(path) ? path : `\`${path.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``;
}

class FieldTransform {
  constructor(
    readonly kind: FieldTransformKind,
    readonly operand?: unknown,
  ) {}
}

const fieldValue = {
  increment: (by: number) => new FieldTransform('increment', by),
  serverTimestamp: () => new FieldTransform('serverTimestamp'),
  arrayUnion: (...values: unknown[]) => new FieldTransform('arrayUnion', values),
  arrayRemove: (...values: unknown[]) => new FieldTransform('arrayRemove', values),
  delete: () => new FieldTransform('delete'),
};

function splitWriteData(data: Record<string, unknown>) {
  const fields: Record<string, FirestoreValue> = {};
  const maskFields: string[] = [];
  const transforms: Record<string, unknown>[] = [];

  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    const path = fieldPath(key);
    if (value instanceof FieldTransform) {
      if (value.kind === 'delete') {
        maskFields.push(path);
      } else if (value.kind === 'increment') {
        transforms.push({ fieldPath: path, increment: encodeValue(value.operand) });
      } else if (value.kind === 'serverTimestamp') {
        transforms.push({ fieldPath: path, setToServerValue: 'REQUEST_TIME' });
      } else if (value.kind === 'arrayUnion') {
        transforms.push({
          fieldPath: path,
          appendMissingElements: {
            values: ((value.operand as unknown[]) || []).map(encodeValue),
          },
        });
      } else if (value.kind === 'arrayRemove') {
        transforms.push({
          fieldPath: path,
          removeAllFromArray: {
            values: ((value.operand as unknown[]) || []).map(encodeValue),
          },
        });
      }
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Uint8Array)) {
      for (const nested of Object.values(value as Record<string, unknown>)) {
        if (nested instanceof FieldTransform) {
          throw new Error('Nested Firestore FieldValue transforms are not supported by this adapter.');
        }
      }
    }
    fields[key] = encodeValue(value);
    maskFields.push(path);
  }

  return { fields, maskFields, transforms };
}

function httpError(message: string, status: number, code?: number): Error & { status?: number; code?: number } {
  const error = new Error(message) as Error & { status?: number; code?: number };
  error.status = status;
  error.code = code ?? status;
  return error;
}

async function responseError(response: Response, service: string): Promise<never> {
  const payload = (await response.json().catch(() => ({}))) as any;
  const detail = payload?.error?.message || payload?.message || response.statusText || 'request failed';
  const canonicalStatusCodes: Record<string, number> = {
    INVALID_ARGUMENT: 3,
    FAILED_PRECONDITION: 9,
    ABORTED: 10,
    UNAUTHENTICATED: 16,
    PERMISSION_DENIED: 7,
    NOT_FOUND: 5,
  };
  const canonicalCode = canonicalStatusCodes[String(payload?.error?.status || '')];
  const code = canonicalCode ?? Number(payload?.error?.code || response.status);
  throw httpError(`${service} request failed (${response.status}): ${detail}`, response.status, code);
}

function encodePath(path: string): string {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

class DocumentSnapshot {
  readonly id: string;
  readonly exists: boolean;
  readonly ref: DocumentReference;
  private readonly fields: Record<string, any> | undefined;

  constructor(ref: DocumentReference, document?: any) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = Boolean(document);
    this.fields = document ? decodeFields(document.fields || {}) : undefined;
  }

  data(): Record<string, any> | undefined {
    return this.fields ? { ...this.fields } : undefined;
  }
}

class QuerySnapshot {
  readonly docs: DocumentSnapshot[];
  readonly size: number;
  readonly empty: boolean;

  constructor(docs: DocumentSnapshot[]) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }

  forEach(callback: (doc: DocumentSnapshot) => void): void {
    this.docs.forEach(callback);
  }
}

class DocumentReference {
  constructor(readonly client: FirestoreClient, readonly path: string) {}

  get id(): string {
    return this.path.split('/').filter(Boolean).at(-1) || '';
  }

  async get(transaction?: string): Promise<DocumentSnapshot> {
    return this.client.getDocument(this, transaction);
  }

  collection(collectionId: string): CollectionReference {
    return new CollectionReference(this.client, `${this.path}/${collectionId}`);
  }

  async set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void> {
    return this.client.setDocument(this, data, options);
  }

  async update(data: Record<string, unknown>): Promise<void> {
    return this.client.updateDocument(this, data);
  }

  async delete(): Promise<void> {
    return this.client.deleteDocument(this);
  }
}

class Query {
  protected readonly filters: FieldFilter[];
  protected readonly ordering: OrderClause[];
  protected readonly maxResults?: number;
  protected readonly skipResults: number;
  protected readonly selectedFields?: string[];

  constructor(
    readonly client: FirestoreClient,
    readonly collectionPath: string,
    state?: { filters?: FieldFilter[]; ordering?: OrderClause[]; maxResults?: number; skipResults?: number; selectedFields?: string[] },
  ) {
    this.filters = state?.filters || [];
    this.ordering = state?.ordering || [];
    this.maxResults = state?.maxResults;
    this.skipResults = state?.skipResults || 0;
    this.selectedFields = state?.selectedFields;
  }

  protected clone(state: Partial<{ filters: FieldFilter[]; ordering: OrderClause[]; maxResults?: number; skipResults: number; selectedFields?: string[] }>): Query {
    return new Query(this.client, this.collectionPath, {
      filters: state.filters ?? this.filters,
      ordering: state.ordering ?? this.ordering,
      maxResults: state.maxResults ?? this.maxResults,
      skipResults: state.skipResults ?? this.skipResults,
      selectedFields: state.selectedFields ?? this.selectedFields,
    });
  }

  where(field: string, operator: string, value: unknown): Query {
    const operators: Record<string, string> = {
      '==': 'EQUAL',
      '!=': 'NOT_EQUAL',
      '<': 'LESS_THAN',
      '<=': 'LESS_THAN_OR_EQUAL',
      '>': 'GREATER_THAN',
      '>=': 'GREATER_THAN_OR_EQUAL',
      'array-contains': 'ARRAY_CONTAINS',
      'in': 'IN',
      'not-in': 'NOT_IN',
      'array-contains-any': 'ARRAY_CONTAINS_ANY',
    };
    const mapped = operators[operator];
    if (!mapped) throw new Error(`Unsupported Firestore query operator: ${operator}`);
    return this.clone({ filters: [...this.filters, { field, operator: mapped, value }] });
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): Query {
    return this.clone({ ordering: [...this.ordering, { field, direction }] });
  }

  limit(value: number): Query {
    return this.clone({ maxResults: Math.max(0, Math.trunc(value)) });
  }

  offset(value: number): Query {
    return this.clone({ skipResults: Math.max(0, Math.trunc(value)) });
  }

  select(...fields: string[]): Query {
    return this.clone({ selectedFields: fields });
  }

  count(): AggregationQuery {
    return new AggregationQuery(this);
  }

  async get(transaction?: string): Promise<QuerySnapshot> {
    return this.client.runQuery(this, transaction);
  }

  toStructuredQuery(): Record<string, unknown> {
    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId: this.collectionPath.split('/').filter(Boolean).at(-1) || '' }],
    };
    if (this.filters.length === 1) {
      const filter = this.filters[0];
      structuredQuery.where = {
        fieldFilter: {
          field: { fieldPath: fieldPath(filter.field) },
          op: filter.operator,
          value: encodeValue(filter.value),
        },
      };
    } else if (this.filters.length > 1) {
      structuredQuery.where = {
        compositeFilter: {
          op: 'AND',
          filters: this.filters.map((filter) => ({
            fieldFilter: {
              field: { fieldPath: fieldPath(filter.field) },
              op: filter.operator,
              value: encodeValue(filter.value),
            },
          })),
        },
      };
    }
    if (this.ordering.length) {
      structuredQuery.orderBy = this.ordering.map((item) => ({
        field: { fieldPath: fieldPath(item.field) },
        direction: item.direction === 'desc' ? 'DESCENDING' : 'ASCENDING',
      }));
    }
    if (this.maxResults !== undefined) structuredQuery.limit = this.maxResults;
    if (this.skipResults) structuredQuery.offset = this.skipResults;
    if (this.selectedFields?.length) {
      structuredQuery.select = { fields: this.selectedFields.map((field) => ({ fieldPath: fieldPath(field) })) };
    }
    return structuredQuery;
  }
}

class CollectionReference extends Query {
  doc(id?: string): DocumentReference {
    const documentId = id || crypto.randomUUID().replace(/-/g, '');
    return new DocumentReference(this.client, `${this.collectionPath}/${documentId}`);
  }

  async add(data: Record<string, unknown>): Promise<DocumentReference> {
    return this.client.addDocument(this, data);
  }
}

class AggregationQuery {
  constructor(private readonly query: Query) {}

  async get(): Promise<{ data: () => { count: number } }> {
    const count = await this.query.client.countQuery(this.query);
    return { data: () => ({ count }) };
  }
}

class WriteBatch {
  private readonly writes: Record<string, unknown>[] = [];

  constructor(private readonly client: FirestoreClient) {}

  update(ref: DocumentReference, data: Record<string, unknown>): this {
    this.writes.push(this.client.makeWrite(ref, data, { updateOnly: true }));
    return this;
  }

  set(ref: DocumentReference, data: Record<string, unknown>, options?: { merge?: boolean }): this {
    this.writes.push(this.client.makeWrite(ref, data, { merge: options?.merge, updateOnly: false }));
    return this;
  }

  delete(ref: DocumentReference): this {
    this.writes.push({ delete: this.client.documentName(ref) });
    return this;
  }

  async commit(): Promise<void> {
    await this.client.commitWrites(this.writes);
  }
}

class Transaction {
  readonly writes: Record<string, unknown>[] = [];

  constructor(private readonly client: FirestoreClient, private readonly transactionId: string) {}

  get(ref: DocumentReference): Promise<DocumentSnapshot> {
    return this.client.getDocument(ref, this.transactionId);
  }

  update(ref: DocumentReference, data: Record<string, unknown>): this {
    this.writes.push(this.client.makeWrite(ref, data, { updateOnly: true }));
    return this;
  }

  set(ref: DocumentReference, data: Record<string, unknown>, options?: { merge?: boolean }): this {
    this.writes.push(this.client.makeWrite(ref, data, { merge: options?.merge, updateOnly: false }));
    return this;
  }

  delete(ref: DocumentReference): this {
    this.writes.push({ delete: this.client.documentName(ref) });
    return this;
  }
}

class FirestoreClient {
  constructor(readonly env: Env) {}

  collection(path: string): CollectionReference {
    return new CollectionReference(this, path.replace(/^\/+|\/+$/g, ''));
  }

  batch(): WriteBatch {
    return new WriteBatch(this);
  }

  async runTransaction<T>(callback: (transaction: Transaction) => Promise<T>, maxAttempts = 3): Promise<T> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const transactionId = await this.beginTransaction();
      const transaction = new Transaction(this, transactionId);
      const result = await callback(transaction);
      try {
        if (transaction.writes.length) await this.commitWrites(transaction.writes, transactionId);
        return result;
      } catch (error) {
        if ((error as any)?.code !== 10 || attempt === maxAttempts - 1) throw error;
      }
    }
    throw new Error('Firestore transaction aborted.');
  }

  private get baseUrl(): string {
    const projectId = getCredentials(this.env).projectId;
    return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  }

  documentName(ref: DocumentReference): string {
    return `projects/${getCredentials(this.env).projectId}/databases/(default)/documents/${ref.path}`;
  }

  private async authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const accessToken = await getAccessToken(this.env, FIRESTORE_SCOPE);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return fetch(input, { ...init, headers });
  }

  private async checkedJson(response: Response, service = 'Firestore'): Promise<any> {
    if (!response.ok) return responseError(response, service);
    if (response.status === 204) return {};
    return response.json();
  }

  async getDocument(ref: DocumentReference, transaction?: string): Promise<DocumentSnapshot> {
    const url = new URL(`${this.baseUrl}/${encodePath(ref.path)}`);
    if (transaction) url.searchParams.set('transaction', transaction);
    const response = await this.authorizedFetch(url);
    if (response.status === 404) return new DocumentSnapshot(ref);
    const document = await this.checkedJson(response);
    return new DocumentSnapshot(ref, document);
  }

  async setDocument(ref: DocumentReference, data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void> {
    const payload = splitWriteData(data);
    if (payload.transforms.length) {
      const write = this.makeWrite(ref, data, { merge: options?.merge, updateOnly: false });
      await this.commitWrites([write]);
      return;
    }
    const url = new URL(`${this.baseUrl}/${encodePath(ref.path)}`);
    if (options?.merge) {
      for (const field of payload.maskFields) url.searchParams.append('updateMask.fieldPaths', field);
    }
    const body = { name: this.documentName(ref), fields: payload.fields };
    const response = await this.authorizedFetch(url, { method: 'PATCH', body: JSON.stringify(body) });
    await this.checkedJson(response);
  }

  async updateDocument(ref: DocumentReference, data: Record<string, unknown>): Promise<void> {
    const payload = splitWriteData(data);
    if (payload.transforms.length) {
      await this.commitWrites([this.makeWrite(ref, data, { updateOnly: true })]);
      return;
    }
    const url = new URL(`${this.baseUrl}/${encodePath(ref.path)}`);
    for (const field of payload.maskFields) url.searchParams.append('updateMask.fieldPaths', field);
    const response = await this.authorizedFetch(url, {
      method: 'PATCH',
      body: JSON.stringify({ name: this.documentName(ref), fields: payload.fields }),
    });
    await this.checkedJson(response);
  }

  async deleteDocument(ref: DocumentReference): Promise<void> {
    const response = await this.authorizedFetch(`${this.baseUrl}/${encodePath(ref.path)}`, { method: 'DELETE' });
    if (response.status === 404) return;
    await this.checkedJson(response);
  }

  async addDocument(collection: CollectionReference, data: Record<string, unknown>): Promise<DocumentReference> {
    const payload = splitWriteData(data);
    if (payload.transforms.length) {
      const ref = collection.doc();
      await this.setDocument(ref, data);
      return ref;
    }
    const response = await this.authorizedFetch(`${this.baseUrl}/${encodePath(collection.collectionPath)}`, {
      method: 'POST',
      body: JSON.stringify({ fields: payload.fields }),
    });
    const document = await this.checkedJson(response);
    const suffix = String(document.name || '').split('/documents/')[1] || '';
    return new DocumentReference(this, suffix || `${collection.collectionPath}/${crypto.randomUUID().replace(/-/g, '')}`);
  }

  async runQuery(query: Query, transaction?: string): Promise<QuerySnapshot> {
    const collectionSegments = query.collectionPath.split('/').filter(Boolean);
    const collectionId = collectionSegments.pop() || '';
    const parentPath = collectionSegments.join('/');
    const endpoint = `${this.baseUrl}${parentPath ? `/${encodePath(parentPath)}` : ''}:runQuery`;
    const body: Record<string, unknown> = { structuredQuery: query.toStructuredQuery() };
    if (transaction) body.transaction = transaction;
    const response = await this.authorizedFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
    const rows = (await this.checkedJson(response)) as any[];
    const docs = (rows || [])
      .filter((row) => row?.document)
      .map((row) => {
        const documentPath = String(row.document.name || '').split('/documents/')[1] || '';
        return new DocumentSnapshot(new DocumentReference(this, documentPath), row.document);
      });
    return new QuerySnapshot(docs);
  }

  async countQuery(query: Query): Promise<number> {
    const collectionSegments = query.collectionPath.split('/').filter(Boolean);
    collectionSegments.pop();
    const parentPath = collectionSegments.join('/');
    const endpoint = `${this.baseUrl}${parentPath ? `/${encodePath(parentPath)}` : ''}:runAggregationQuery`;
    const response = await this.authorizedFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        structuredAggregationQuery: {
          structuredQuery: query.toStructuredQuery(),
          aggregations: [{ alias: 'count', count: {} }],
        },
      }),
    });
    const result = (await this.checkedJson(response)) as any[];
    return Number(result?.[0]?.result?.aggregateFields?.count?.integerValue || 0);
  }

  makeWrite(
    ref: DocumentReference,
    data: Record<string, unknown>,
    options: { merge?: boolean; updateOnly: boolean },
  ): Record<string, unknown> {
    const payload = splitWriteData(data);
    const write: Record<string, unknown> = {
      update: { name: this.documentName(ref), fields: payload.fields },
    };
    if (options.updateOnly || options.merge || payload.transforms.length || payload.maskFields.length) {
      write.updateMask = { fieldPaths: payload.maskFields };
    }
    if (payload.transforms.length) write.updateTransforms = payload.transforms;
    if (options.updateOnly) write.currentDocument = { exists: true };
    return write;
  }

  async commitWrites(writes: Record<string, unknown>[], transaction?: string): Promise<any> {
    const body: Record<string, unknown> = { writes };
    if (transaction) body.transaction = transaction;
    const response = await this.authorizedFetch(`${this.baseUrl}:commit`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return this.checkedJson(response);
  }

  private async beginTransaction(): Promise<string> {
    const response = await this.authorizedFetch(`${this.baseUrl}:beginTransaction`, {
      method: 'POST',
      body: JSON.stringify({ options: { readWrite: {} } }),
    });
    const payload = await this.checkedJson(response);
    if (!payload.transaction) throw new Error('Firestore did not return a transaction id.');
    return payload.transaction;
  }
}

export function firestore(env: Env): Promise<FirestoreClient> {
  return Promise.resolve(new FirestoreClient(env));
}

export function getFieldValue() {
  return fieldValue;
}

async function identityToolkitRequest(env: Env, endpoint: string, body: Record<string, unknown>): Promise<any> {
  const apiKey = env.FIREBASE_API_KEY;
  if (!apiKey) throw new Error('FIREBASE_API_KEY is required for Firebase Auth REST verification.');
  const url = new URL(`https://identitytoolkit.googleapis.com/v1/${endpoint}`);
  url.searchParams.set('key', apiKey);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (payload as any)?.error?.message || response.statusText || 'Firebase Auth request failed';
    throw httpError(`Firebase Auth request failed (${response.status}): ${detail}`, response.status, response.status);
  }
  return payload;
}

function decodeAuthUser(user: any): Record<string, any> {
  return {
    uid: String(user?.localId || user?.uid || ''),
    email: user?.email,
    name: user?.displayName,
    emailVerified: user?.emailVerified,
    photoURL: user?.photoUrl,
    phoneNumber: user?.phoneNumber,
  };
}

export async function getAuthAdmin(env: Env) {
  const credentials = getCredentials(env);
  const key = await importPKCS8(credentials.privateKey, 'RS256');

  return {
    async createCustomToken(uid: string, additionalClaims?: Record<string, unknown>): Promise<string> {
      const now = Math.floor(Date.now() / 1000);
      const payload = { uid, ...(additionalClaims ? { claims: additionalClaims } : {}) };
      return new SignJWT(payload)
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuer(credentials.clientEmail)
        .setSubject(credentials.clientEmail)
        .setAudience(FIREBASE_AUTH_AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(key);
    },

    async verifyIdToken(idToken: string): Promise<Record<string, any>> {
      const result = await identityToolkitRequest(env, 'accounts:lookup', { idToken });
      const user = result?.users?.[0];
      if (!user?.localId) throw new Error('Firebase ID token is invalid or expired.');
      return decodeAuthUser(user);
    },

    async signInWithCustomToken(token: string, returnSecureToken = true): Promise<any> {
      return identityToolkitRequest(env, 'accounts:signInWithCustomToken', { token, returnSecureToken });
    },

    async signUp(email?: string, password?: string, returnSecureToken = true): Promise<any> {
      return identityToolkitRequest(env, 'accounts:signUp', {
        ...(email ? { email } : {}),
        ...(password ? { password } : {}),
        returnSecureToken,
      });
    },

    async lookupUser(idToken: string): Promise<Record<string, any>> {
      const result = await identityToolkitRequest(env, 'accounts:lookup', { idToken });
      const user = result?.users?.[0];
      if (!user?.localId) throw new Error('Firebase user was not found.');
      return decodeAuthUser(user);
    },
  };
}

export async function verifyFirebaseToken(
  idToken: string,
  env: Env,
): Promise<{ uid: string; email?: string; name?: string } | null> {
  try {
    const auth = await getAuthAdmin(env);
    const decoded = await auth.verifyIdToken(idToken);
    return {
      uid: String(decoded.uid),
      ...(typeof decoded.email === 'string' ? { email: decoded.email } : {}),
      ...(typeof decoded.name === 'string' ? { name: decoded.name } : {}),
    };
  } catch (error) {
    console.error('[firebase] verifyIdToken failed:', (error as any)?.message || error);
    return null;
  }
}

export async function messaging(env: Env) {
  const credentials = getCredentials(env);
  const accessToken = await getAccessToken(env, FCM_SCOPE);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.projectId)}/messages:send`;

  const send = async (message: Record<string, unknown>): Promise<any> => {
    const normalizedMessage = { ...message };
    const android = message.android as Record<string, any> | undefined;
    if (android) {
      normalizedMessage.android = {
        ...android,
        ...(android.priority ? { priority: String(android.priority).toUpperCase() } : {}),
        ...(android.notification
          ? {
              notification: {
                ...android.notification,
                ...(android.notification.visibility
                  ? { visibility: String(android.notification.visibility).toUpperCase() }
                  : {}),
              },
            }
          : {}),
      };
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: normalizedMessage }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err: any = (payload as any)?.error || {};
      const detail = err.message || response.statusText || 'FCM request failed';
      const errorCode = Array.isArray(err.details)
        ? err.details.map((item: any) => String(item.errorCode || '')).join(',')
        : '';
      const code = errorCode.includes('UNREGISTERED')
        ? 'messaging/registration-token-not-registered'
        : errorCode.includes('INVALID_ARGUMENT') || err.status === 'INVALID_ARGUMENT'
          ? 'messaging/invalid-argument'
          : `messaging/${String(err.status || 'unknown').toLowerCase()}`;
      const failure: any = new Error(detail);
      failure.code = code;
      failure.status = response.status;
      throw failure;
    }
    return payload;
  };

  return {
    send,
    async sendEachForMulticast(input: {
      tokens: string[];
      data?: Record<string, string>;
      notification?: Record<string, string>;
      android?: Record<string, unknown>;
    }): Promise<{ successCount: number; failureCount: number; responses: any[] }> {
      const responses = await Promise.all(input.tokens.map(async (token) => {
        try {
          await send({
            token,
            ...(input.data ? { data: input.data } : {}),
            ...(input.notification ? { notification: input.notification } : {}),
            ...(input.android ? { android: input.android } : {}),
          });
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: {
              code: (error as any)?.code || 'messaging/unknown-error',
              message: (error as any)?.message || String(error),
            },
          };
        }
      }));
      const successCount = responses.filter((response) => response.success).length;
      return { successCount, failureCount: responses.length - successCount, responses };
    },
  };
}
