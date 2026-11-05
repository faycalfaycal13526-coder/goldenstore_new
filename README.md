فهمت. يبدو أن الملف الذي نسخته لم يكتمل، وآخره مقطوع عند كود CORS.

تفضل، هذا هو الكود الكامل والنهائي لملف `README.md` من البداية إلى النهاية. انسخه بالكامل وضعه في GitHub:

```markdown
# Goldenstore

**Goldenstore** is a modern Android app store built on **Cloudflare Workers**, **Cloudflare D1**, **Cloudflare R2**, and **Firebase**.

* The frontend is built with vanilla HTML/CSS/JavaScript and does not require modification when migrating the API.
* The Worker uses standard Web APIs and Hono; it does not depend on Vercel Functions, Firebase Admin SDK, or AWS SDK.
* APK and file uploads go directly from the browser to R2 via pre-signed URLs, including multipart support for large files.
* All existing `/api/*` routes retain their response contracts; `/api/*` on the site domain is routed to the Worker via a Cloudflare Route.

## About this Store

Goldenstore is a distribution platform for:
- Our own in-house developed applications.
- Open-source applications whose licenses permit redistribution.
- Applications for which we have obtained explicit permission from their developers.

We are committed to respecting intellectual property rights and only distribute content that we have the legal right to share.

## Existing Features

* **Download Cancel:** A separate "Cancel Download" button appears only during APK transfer; it does not replace the "Install" button. Browser downloads are cancelled via `AbortController`. On Android, the web layer calls `GSAndroid.cancelDownload(slug)` when available; implementing the native bridge itself requires the Android app source.
* **Store APK Download Counter:** `/download` displays total downloads, and the download button routes through `/api/app-update/download`. The counter is stored in `app_updates/current.downloads`.
* **Publication Notifications:** New publication settings are separate from manual announcements and store update notifications.
* **Languages:** Arabic, English, French, and Spanish only.
* **Account Switching:** A switch icon next to the email shows addresses saved on this device (up to 8). The list is local and does not store passwords; selecting a saved address passes it as a hint to Google, and Google may request identity confirmation.
* **WhatsApp Subscription:** Contact `+213 551 30 41 68`; subscription is completed manually.

---

## 1. Firebase and R2 Requirements

### Firebase
1. Enable Firestore in Native mode in your Firebase project.
2. Enable Firebase Authentication and the sign-in provider used by the app.
3. Create a service-account JSON from **Project settings → Service accounts**.
4. Save the JSON as a Worker secret named `FIREBASE_SERVICE_ACCOUNT`, or use the separate key variables described below.
5. Copy the **Web API key** from your Firebase app settings; the Worker uses it with the Identity Toolkit REST API to verify sign-in tokens via `accounts:lookup`.

### Cloudflare R2
1. Create a bucket (default `goldenstore-apks`) and enable Public Access or connect a CDN domain.
2. Create an R2 API token with Object Read & Write permissions on this bucket only.
3. Prepare the Account ID, Access Key ID, Secret Access Key, and public read URL.
4. Allow uploads from the site origin in the bucket → **CORS Policy**. Example:

```json
[
  {
    "AllowedOrigins": ["https://goldenstore.online", "https://www.goldenstore.online", "https://goldenstore-new.pages.dev"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

This rule can also be configured via `POST /api/setup-r2-cors` with the `x-admin-password` header; the Worker uses the `ALLOWED_ORIGINS` list and does not set a wildcard automatically.

---

## 2. Local Worker Setup

Requires Node.js 22 or newer for Wrangler development tools only. Copy the example file to the local Wrangler file, then fill in values locally and do not push them to Git:

```bash
cp .env.example .dev.vars
npm ci
npm run dev
```

Wrangler serves the API locally at `http://localhost:8787`; test `http://localhost:8787/api/store`. Run the static frontend in the usual way separately. To allow local browser requests, add the development origin to `ALLOWED_ORIGINS` in `.dev.vars`, e.g. `http://localhost:5500`.

`npm run build` remains a TypeScript check only (`tsc --noEmit`). To verify the bundle setup before publishing:

```bash
npm run build
npx wrangler deploy --dry-run
```

---

## 3. Setup and Deployment on Cloudflare Workers

1. Edit `wrangler.toml` as needed: Worker name, Cloudflare domain, CORS origins, Firebase Project ID, R2 Account ID, and R2 Public URL. Private values in the file are placeholders only.
2. Log in to Wrangler:

```bash
npx wrangler login
```

3. Store secrets via Wrangler. For the first deploy, create a local untracked file named `.secrets.env` containing only the six secret keys below, then pass it to `deploy` so the first version is not published without credentials. Do not put real values in Git or in shell commands:

```text
ADMIN_PASSWORD=...
JWT_SECRET=...
FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'
FIREBASE_API_KEY=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

`FIREBASE_SERVICE_ACCOUNT` is the full JSON compressed into a single line. `.secrets.env` is listed in `.gitignore`. For a later update or rotating an existing secret, use Wrangler interactively, e.g. `npx wrangler secret put JWT_SECRET`, without writing the value in the command. `FIREBASE_API_KEY` is a public Firebase setting, not a service key, but it is stored here as a secret so it does not need to be included in the config file.

If you prefer separate Firebase keys instead of the full JSON, set `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` (or `FIREBASE_PRIVATE_KEY_BASE64`) the same way, keeping `FIREBASE_PROJECT_ID` in the Worker variables.

4. Build and deploy the Worker with secrets:

```bash
npm run build
npx wrangler deploy --secrets-file .secrets.env
```

To follow logs:

```bash
npx wrangler tail goldenstore-api
```

### Production Routing Without Modifying the Frontend

`wrangler.toml` contains Routes for `goldenstore.online/api/*` and `www.goldenstore.online/api/*`, plus a Custom Domain `api.goldenstore.online` for the Worker interface. The `goldenstore.online` domain must be active in the same Cloudflare account and DNS must pass through Cloudflare. On the site domain, the Route passes current relative calls like `/api/apps` directly to the Worker. Since `goldenstore-new.pages.dev` is not within your DNS domain, the project contains a small Pages Function in `functions/api/[[path]].ts` acting as a same-origin proxy to `https://api.goldenstore.online/api/*`. If the frontend continues to deploy on Vercel, `vercel.json` uses the same Custom Domain as an external proxy only (no Vercel Function). **The `ALLOWED_ORIGINS` list is for CORS only and does not perform proxy or routing itself.** Add any other production or preview origin to `ALLOWED_ORIGINS` before deploying.

The static frontend file is not deployed by this Worker; the existing static hosting can remain separate.

---

## 4. Environment Variables

| Variable | Type / Usage |
|---|---|
| `ADMIN_USERNAME` | Non-secret variable; default `admin` |
| `ADMIN_PASSWORD`, `JWT_SECRET` | Wrangler secrets for admin panel and JWT session |
| `ALLOWED_ORIGINS` | Comma-separated origins, e.g. site domain and `www` |
| `STORE_NAME`, `STORE_DOMAIN`, `STORE_LOGO_URL` | Public store settings |
| `FIREBASE_SERVICE_ACCOUNT` | Service account JSON secret, or use separate service fields |
| `FIREBASE_PROJECT_ID` | Project ID; can be extracted from the full service account JSON |
| `FIREBASE_API_KEY` | Web API key required for Firebase Auth REST `accounts:lookup` |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_PUBLIC_URL` | Non-secret R2 configuration variables |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 secrets with minimal permissions |

---

## 5. Routes and Features

Hono remains under `basePath('/api')`. Existing families include: store info, update and download, guest token issuance, notifications and FCM token registration/removal and testing, translation and categories and apps, slug pages for download/rating/reviews/update requests/reports, login/logout sessions and `/me`, and admin and multipart upload routes.

Firestore access relies on REST (`runQuery`, `runAggregationQuery`, `PATCH`, `DELETE`, `commit`, and transactions) with Firestore value conversion and FieldValue operations required by current routes. Firebase Auth Identity Toolkit REST is used for verification, and FCM HTTP v1 for sending. R2 operations and Presigned URLs and multipart are signed via `aws4fetch`.

---

## 6. Project Structure

```text
goldenstore/
├── api/
│   └── [[...path]].ts       # Worker entry point: Hono basePath('/api')
├── functions/
│   └── api/[[path]].ts      # Pages same-origin proxy to api.goldenstore.online
├── lib/
│   ├── env.ts               # Cloudflare Worker bindings
│   ├── firebase.ts          # Firestore/Auth/FCM REST adapters
│   ├── r2.ts                # aws4fetch + presigned/multipart operations
│   ├── auth.ts              # JWT via jose + credential comparison
│   ├── types.ts             # Data types and categories
│   └── utils.ts             # Web Crypto and sanitization/search operations
├── public/                  # Existing static frontend
├── wrangler.toml
├── package.json
└── tsconfig.json
```

## 7. Operational and Security Notes

* Pre-signed upload links specify the R2 key, content type, and expiration; the `Content-Type` sent by the browser must match the link.
* The current rate limiter is stored in Worker isolate memory, so it is best-effort local and not a distributed or persistent limit. Do not use it as a substitute for Cloudflare WAF/Rate Limiting when a reliable limit across all requests is needed.
* FCM HTTP v1 does not offer a single multicast; sending messages to multiple tokens requires one request per token. Current public notifications send to a single topic.
* Cloudflare, Firebase, and R2 plans have usage quotas and limits; they are not assumed to be free or unlimited at any scale.
* Do not place service data, passwords, or R2 keys in Git or in `wrangler.toml`.

© goldenstore.online — Goldenstore
```
