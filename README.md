# Goldenstore

**المتجر الذهبي الحصري للتطبيقات المهكرة** — استضافة على **Vercel**، قاعدة بيانات **Firebase Firestore**، وتخزين الملفات على **Cloudflare R2**.

* خفيف وسريع (لا توجد عملية بناء، HTML/CSS/JS مباشرة + Vercel Function واحدة).
* تصميم أسود صافٍ مع ذهبي مدروس (بدون مبالغة).
* رفع APK يصل مباشرة من المتصفح إلى R2 (بدون المرور عبر Vercel) لدعم ملفات كبيرة.
* دخول إدارة مباشر بكلمة سر واحدة (JWT) — لا يوجد رابط أو زر عام للإدارة؛ الوصول فقط عبر `/admin`.
* RTL وعربية بالكامل.

---

## 1) إنشاء المشاريع الخارجية

### Firebase
1. افتح [https://console.firebase.google.com](https://console.firebase.google.com) وأنشئ مشروعاً جديداً.
2. من القائمة الجانبية افتح **Build → Firestore Database → Create database**.
3. اختر **Native mode** والمنطقة الأقرب لك (مثلاً `eur3` أو `nam5`).
4. اذهب إلى **Project Settings → Service Accounts → Generate new private key**.
5. سيتحمّل ملف JSON. ستحتاج منه ثلاث قيم: `project_id` و `client_email` و `private_key`.

### Cloudflare R2
1. افتح [https://dash.cloudflare.com](https://dash.cloudflare.com) → **R2**.
2. أنشئ Bucket باسم `goldenstore-apks` (أو الاسم الذي تريده).
3. من تبويب **Settings** للـ Bucket، فعّل **Public Access** (أو اربط دومين مخصص مثل `cdn.goldenstore.me`).
4. من **R2 → Manage R2 API Tokens** أنشئ Token بصلاحيات **Object Read & Write** على هذا الـ Bucket فقط.
5. احفظ القيم: `Account ID` و `Access Key ID` و `Secret Access Key` و `Public R2.dev URL`.

> **مهم — CORS:** يجب السماح بـ PUT من المتصفح. اذهب إلى الـ Bucket → **Settings → CORS Policy** والصق:
> ```json
> [
>   {
>     "AllowedOrigins": ["*"],
>     "AllowedMethods": ["GET", "PUT", "HEAD"],
>     "AllowedHeaders": ["*"],
>     "ExposeHeaders": ["ETag"],
>     "MaxAgeSeconds": 3600
>   }
> ]
> ```
> بعد النشر، استبدل `*` بدومينك (مثل `https://goldenstore.me`).

---

## 2) إعداد متغيرات البيئة

انسخ `.env.example` إلى `.env.local` وعبّئ القيم:

```bash
cp .env.example .env.local
```

ثم افتح `.env.local` وعبّئ:

| المتغير | الوصف |
|---|---|
| `STORE_NAME` | اسم المتجر — `Goldenstore` |
| `STORE_DOMAIN` | الدومين — `goldenstore.me` |
| `ADMIN_USERNAME` | اسم المستخدم للوحة الإدارة — `admin` |
| `ADMIN_PASSWORD` | كلمة مرور قوية للإدارة |
| `JWT_SECRET` | نص عشوائي ≥ 32 حرفاً — `openssl rand -hex 32` |
| `FIREBASE_PROJECT_ID` | من JSON الذي حمّلته |
| `FIREBASE_CLIENT_EMAIL` | من JSON الذي حمّلته |
| `FIREBASE_PRIVATE_KEY` | المفتاح PEM — يقبل أسطر حقيقية أو `\n` المهروبة، باقتباس أو بدونه |
| `FIREBASE_PRIVATE_KEY_BASE64` | بديل أنظف لـ `FIREBASE_PRIVATE_KEY` — السلسلة بصيغة base64 (انظر القسم 4) |
| `FIREBASE_SERVICE_ACCOUNT` | بديل آخر: ملف Firebase service account JSON كاملاً في متغير واحد |
| `R2_ACCOUNT_ID` | Account ID من Cloudflare |
| `R2_ACCESS_KEY_ID` | من R2 API Token |
| `R2_SECRET_ACCESS_KEY` | من R2 API Token |
| `R2_BUCKET` | اسم الـ Bucket — `goldenstore-apks` |
| `R2_PUBLIC_URL` | رابط R2.dev العام، بدون شرطة في النهاية |

---

## 3) التشغيل المحلي

```bash
npm install
npm run dev
```

ثم افتح [http://localhost:3000](http://localhost:3000).
لوحة الإدارة على [http://localhost:3000/admin](http://localhost:3000/admin).

---

## 4) النشر على Vercel

### الطريقة الأولى — عبر GitHub (مستحسن)
1. ارفع المجلد إلى مستودع GitHub.
2. افتح [https://vercel.com/new](https://vercel.com/new) واختر المستودع.
3. لا تغيّر إعدادات البناء (المشروع جاهز).
4. في صفحة الإعداد، أضف جميع متغيرات البيئة من `.env.local`.
   * إن أردت لصق ملف Firebase JSON كاملاً كما هو، استخدم متغيراً واحداً باسم `FIREBASE_SERVICE_ACCOUNT` واترك `FIREBASE_PROJECT_ID` و`FIREBASE_CLIENT_EMAIL` و`FIREBASE_PRIVATE_KEY` فارغة.
   * **مفتاح Firebase** — أسهل طريقة مع Vercel هي استخدام `FIREBASE_PRIVATE_KEY_BASE64`:
     ```bash
     # 1) استخرج قيمة private_key من ملف service-account.json
     # 2) رمّزه إلى base64 (سطر واحد، بدون \n):
     node -e 'const k = require("./service-account.json").private_key; process.stdout.write(Buffer.from(k).toString("base64"))'
     ```
     ثم الصق الناتج في Vercel كقيمة لـ `FIREBASE_PRIVATE_KEY_BASE64` — لن تحتاج إلى التعامل مع `\n` أو الاقتباس.
   * إن استخدمت `FIREBASE_PRIVATE_KEY` مباشرة، الصق المحتوى كما هو من ملف JSON (مع `\n` المهروبة) — الكود يعالجها تلقائياً. **هام**: لا تحط علامتي تنصيص حول القيمة في واجهة Vercel، فقط الصقها كنص خام.
5. اضغط **Deploy**.

### الطريقة الثانية — عبر Vercel CLI
```bash
npm i -g vercel
vercel login
vercel link
# أضف المتغيرات
vercel env add ADMIN_PASSWORD production
vercel env add JWT_SECRET production
# … باقي المتغيرات
vercel --prod
```

---

## 5) ربط دومين goldenstore.me

في Vercel → Project → **Settings → Domains** أضف `goldenstore.me` و `www.goldenstore.me`.
ستظهر تعليمات DNS — اتبعها في لوحة الدومين عندك.

---

## 6) البنية

```
goldenstore/
├── api/
│   └── [[...path]].ts     # Vercel Function واحدة — Hono مع كل المسارات
├── lib/
│   ├── firebase.ts        # تهيئة Firebase Admin SDK
│   ├── r2.ts              # عميل R2 (S3-compatible) + presigned URLs
│   ├── auth.ts            # JWT (HS256) + cookies
│   ├── types.ts           # أنواع البيانات + التصنيفات الافتراضية
│   └── utils.ts           # سلَج + مصطلحات بحث + IDs
├── public/
│   ├── index.html         # الرئيسية
│   ├── browse.html        # تصفّح وبحث
│   ├── app.html           # صفحة تطبيق
│   ├── categories.html    # التصنيفات
│   ├── admin.html         # لوحة الإدارة
│   ├── 404.html
│   ├── css/style.css      # التصميم
│   ├── js/
│   │   ├── icons.js       # مكتبة أيقونات SVG
│   │   ├── common.js      # helpers + header + footer
│   │   ├── home.js
│   │   ├── browse.js
│   │   ├── app.js
│   │   └── admin.js
│   └── images/logo.png    # شعار Goldenstore
├── .env.example
├── package.json
├── tsconfig.json
└── vercel.json
```

---

## 7) الوصول للإدارة

* **الوصول فقط عبر الرابط المباشر** `/admin` — لا يوجد أي زر أو رابط في الواجهة العامة.
* صفحة الدخول تطلب **كلمة المرور فقط** (اسم المستخدم ثابت في متغيرات البيئة).
* تستخدم جلسة JWT لمدة 7 أيام داخل كوكي HttpOnly.

## 8) كيفية رفع تطبيق مهكّر

1. ادخل إلى `/admin` بكلمة المرور.
2. اختر تبويب **تطبيق جديد**.
3. عبّئ الاسم، اسم الحزمة (`com.example.app`)، التصنيف، الإصدار…
4. اسحب أو اختر ملف APK المهكّر + أيقونة + لقطات شاشة.
5. اضغط **رفع التطبيق**.

تُرفع الملفات مباشرة من متصفحك إلى R2 (بدون المرور عبر Vercel)، وتُحفظ بيانات التطبيق في Firestore.

---

## 9) ملاحظات

* **حجم الملف**: لا يوجد حد عند الرفع عبر presigned URLs (يصل لعدة جيجابايت).
* **التنزيل**: عند ضغط زر التنزيل، يُولَّد رابط مؤقت (5 دقائق) ويُرسل ملف APK باسم مناسب. يُحدَّث عدّاد التنزيلات تلقائياً.
* **التحديثات التلقائية**: غير مدعومة (كما في Google Play). تحتاج إلى آلية داخل التطبيق نفسه للتحقق من الإصدار الجديد.
* **التكلفة**: Vercel Free + Firebase Spark + R2 Free يكفون لمتاجر صغيرة/متوسطة بدون أي تكلفة (10 GB R2 + 1 GB Firestore + 100 GB Vercel bandwidth).

---

© goldenstore.me — المتجر الذهبي الحصري للتطبيقات المهكرة
