export interface Env {
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  JWT_SECRET?: string;

  ALLOWED_ORIGINS?: string;
  STORE_NAME?: string;
  STORE_DOMAIN?: string;
  STORE_LOGO_URL?: string;

  FIREBASE_API_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  FIREBASE_PRIVATE_KEY_BASE64?: string;
  FIREBASE_SERVICE_ACCOUNT?: string;

  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  R2_PUBLIC_URL?: string;

  // Cloudflare GraphQL Analytics (set as Worker SECRETS, never in wrangler.toml)
  CF_API_TOKEN?: string;   // token with Account or Zone "Analytics: Read"
  CLOUDFLARE_API_TOKEN?: string; // accepted aliases (dashboard naming varies)
  CF_ANALYTICS_TOKEN?: string;
  CF_ACCOUNT_ID?: string;  // account-level tag (falls back to R2_ACCOUNT_ID)
  CF_ZONE_ID?: string;     // zone-level tag (needed for zone-scoped tokens)

  // ============================================================
  // D1 Database Binding (للتخزين الجديد بدلاً من Firestore)
  // ============================================================
  DB: D1Database;
}
