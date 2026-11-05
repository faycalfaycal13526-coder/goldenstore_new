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
