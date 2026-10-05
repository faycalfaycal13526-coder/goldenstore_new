# Goldenstore

**المتجر الذهبي الحصري للتطبيقات المهكرة** — واجهة ثابتة مع **Cloudflare Workers** لواجهة API، و**Firebase Firestore/Auth/FCM**، و**Cloudflare R2** لتخزين الملفات.

* الواجهة الحالية مبنية بـ HTML/CSS/JavaScript ولا تحتاج إلى تعديل عند ترحيل الـ API.
* يستخدم Worker واجهات Web القياسية وHono؛ لا يعتمد على Vercel Functions أو Firebase Admin SDK أو AWS SDK.
* رفع APK والملفات يتم مباشرة من المتصفح إلى R2 عبر روابط موقعة، بما في ذلك multipart للملفات الكبيرة.
* جميع مسارات `/api/*` الحالية تحتفظ بعقود الاستجابة؛ يمر `/api/*` من نطاق الموقع إلى Worker عبر Cloudflare Route.

## تحديثات الوظائف الموجودة

* **إلغاء التنزيل:** زر مستقل «إلغاء التنزيل» أثناء نقل APK فقط؛ لا يحل محل زر «تثبيت». تنزيلات المتصفح تُلغى عبر `AbortController`. في Android يستدعي الويب `GSAndroid.cancelDownload(slug)` عند توفره؛ تنفيذ الجسر الأصلي نفسه يتطلب مصدر تطبيق Android.
* **عداد تنزيلات APK المتجر:** يعرض `/download` إجمالي التنزيلات، ويمر زر التحميل عبر `/api/app-update/download`. العداد محفوظ في `app_updates/current.downloads`.
* **إشعارات النشر:** إعداد النشر الجديد منفصل عن الإعلانات اليدوية وإشعارات تحديث المتجر.
* **اللغات:** العربية والإنجليزية والفرنسية والإسبانية فقط.
* **تبديل الحساب:** أيقونة تبديل بجانب البريد تعرض العناوين المحفوظة على هذا الجهاز (حتى 8). القائمة محلية ولا تحفظ كلمات مرور؛ اختيار عنوان محفوظ يمرّره كتلميح إلى Google، وقد يطلب Google تأكيد الهوية.
* **الاشتراك عبر WhatsApp:** جهة التواصل `+213 551 30 41 68`؛ إتمام الاشتراك يدوي.

---

## 1. متطلبات Firebase وR2

### Firebase
1. فعّل Firestore بنمط Native في مشروع Firebase.
2. فعّل Firebase Authentication ومزوّد تسجيل الدخول الذي يستخدمه التطبيق.
3. أنشئ service-account JSON من **Project settings → Service accounts**.
4. احفظ JSON كـ Worker secret باسم `FIREBASE_SERVICE_ACCOUNT`، أو استخدم متغيرات المفتاح المنفصلة الموضّحة أدناه.
5. انسخ **Web API key** من إعدادات تطبيق Firebase؛ يستخدمه Worker مع Identity Toolkit REST للتحقق من رموز الدخول عبر `accounts:lookup`.

### Cloudflare R2
1. أنشئ bucket (الافتراضي `goldenstore-apks`) وفعّل Public Access أو اربط نطاق CDN.
2. أنشئ R2 API token بصلاحيات Object Read & Write على هذا الـ bucket فقط.
3. جهّز Account ID وAccess Key ID وSecret Access Key ورابط القراءة العام.
4. اسمح بالرفع من أصل الموقع في إعدادات bucket → **CORS Policy**. مثال:

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

يمكن إعداد هذه القاعدة أيضاً عبر `POST /api/setup-r2-cors` مع ترويسة `x-admin-password`؛ يستعمل Worker قائمة `ALLOWED_ORIGINS` ولا يضبط wildcard تلقائياً.

---

## 2. إعداد Worker محلياً

يتطلب Node.js 22 أو أحدث لأدوات Wrangler التطويرية فقط. انسخ ملف المثال إلى ملف Wrangler المحلي، ثم أدخل القيم محلياً ولا ترفعها إلى Git:

```bash
cp .env.example .dev.vars
npm ci
npm run dev
```

يخدم Wrangler الـ API محلياً على `http://localhost:8787`؛ اختبر `http://localhost:8787/api/store`. شغّل الواجهة الثابتة بالطريقة المعتادة بشكل منفصل. للسماح بطلبات المتصفح المحلية، أضف أصل التطوير إلى `ALLOWED_ORIGINS` في `.dev.vars`، مثلاً `http://localhost:5500`.

`npm run build` يبقى فحص TypeScript فقط (`tsc --noEmit`). وللتأكد من إعداد الحزمة قبل النشر:

```bash
npm run build
npx wrangler deploy --dry-run
```

---

## 3. الإعداد والنشر على Cloudflare Workers

1. عدّل `wrangler.toml` عند الحاجة: اسم Worker، نطاق Cloudflare، نطاقات CORS، Firebase Project ID، R2 Account ID، وR2 Public URL. القيم الخاصة في الملف مجرد placeholders.
2. سجّل الدخول إلى Wrangler:

```bash
npx wrangler login
```

3. خزّن الأسرار عبر Wrangler. للنشر الأول، أنشئ ملفاً محلياً غير متعقّب اسمه `.secrets.env` يتضمن مفاتيح الأسرار الستة أدناه فقط، ثم مرّره إلى `deploy` حتى لا تُنشر نسخة أولى بلا credentials. لا تضع قيماً حقيقية في Git أو في أوامر shell:

```text
ADMIN_PASSWORD=...
JWT_SECRET=...
FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'
FIREBASE_API_KEY=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

`FIREBASE_SERVICE_ACCOUNT` هو JSON كامل ومضغوط في سطر واحد. الملف `.secrets.env` مُدرج في `.gitignore`. لنشر تحديث لاحق أو تدوير سرّ موجود استخدم Wrangler بشكل تفاعلي، مثلاً `npx wrangler secret put JWT_SECRET`، من دون كتابة القيمة في الأمر. `FIREBASE_API_KEY` إعداد Firebase عام وليس مفتاح خدمة، لكنه يُحفظ هنا كـ secret كي لا يلزم تضمينه في ملف الإعداد.

إذا أردت بدلاً من JSON الكامل مفاتيح Firebase منفصلة، اضبط `FIREBASE_CLIENT_EMAIL` و`FIREBASE_PRIVATE_KEY` (أو `FIREBASE_PRIVATE_KEY_BASE64`) بالطريقة نفسها، مع إبقاء `FIREBASE_PROJECT_ID` في متغير Worker.

4. ابنِ وانشر Worker مع الأسرار:

```bash
npm run build
npx wrangler deploy --secrets-file .secrets.env
```

لمتابعة السجلات:

```bash
npx wrangler tail goldenstore-api
```

### توجيه الإنتاج من دون تعديل الواجهة

يحتوي `wrangler.toml` على Routes لـ `goldenstore.online/api/*` و`www.goldenstore.online/api/*`، إضافة إلى Custom Domain `api.goldenstore.online` لواجهة الـ Worker. يجب أن يكون نطاق `goldenstore.online` مفعّلاً في حساب Cloudflare نفسه، وأن يمر DNS عبر Cloudflare. على نطاق الموقع، الـ Route يمرر الاستدعاءات الحالية النسبية مثل `/api/apps` مباشرة إلى Worker. ولأن `goldenstore-new.pages.dev` ليس ضمن نطاق DNS الخاص بك، يحتوي المشروع على Pages Function صغيرة في `functions/api/[[path]].ts` تعمل كـ same-origin proxy إلى `https://api.goldenstore.online/api/*`. إذا استمر نشر الواجهة على Vercel، فإن `vercel.json` يستخدم الـ Custom Domain نفسه كـ proxy خارجي فقط (لا توجد Vercel Function). **قائمة `ALLOWED_ORIGINS` تخص CORS فقط ولا تقوم بعمل proxy أو توجيه بحد ذاتها.** أضف أي أصل إنتاجي أو معاينة آخر إلى `ALLOWED_ORIGINS` قبل النشر.

لا يُنشر ملف الواجهة الثابتة من Worker هذا؛ يمكن أن تبقى الاستضافة الثابتة الحالية منفصلة.

---

## 4. متغيرات البيئة

| المتغير | النوع / الاستخدام |
|---|---|
| `ADMIN_USERNAME` | متغير غير سري؛ الافتراضي `admin` |
| `ADMIN_PASSWORD`, `JWT_SECRET` | أسرار Wrangler للوحة الإدارة وجلسة JWT |
| `ALLOWED_ORIGINS` | قائمة origins مفصولة بفواصل، مثل نطاق الموقع و`www` |
| `STORE_NAME`, `STORE_DOMAIN`, `STORE_LOGO_URL` | إعدادات المتجر العامة |
| `FIREBASE_SERVICE_ACCOUNT` | سر JSON لحساب الخدمة، أو استخدم حقول الخدمة المنفصلة |
| `FIREBASE_PROJECT_ID` | معرّف المشروع؛ يمكن استخلاصه من JSON الكامل لحساب الخدمة |
| `FIREBASE_API_KEY` | Web API key مطلوب لاستدعاء Firebase Auth REST `accounts:lookup` |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_PUBLIC_URL` | متغيرات غير سرية لإعداد R2 |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | أسرار R2 بصلاحية أقل ما يمكن |

---

## 5. المسارات والميزات

يظل Hono تحت `basePath('/api')`. تشمل العائلات الموجودة: معلومات المتجر والتحديث والتنزيل، إصدار رمز الضيف، الإشعارات وتسجيل/إزالة رموز FCM والاختبار، الترجمة والتصنيفات والتطبيقات، صفحات slug للتنزيل والتقييم والمراجعات وطلبات التحديث والتبليغ، جلسات تسجيل الدخول والخروج و`/me`، ومسارات الإدارة والرفع متعدد الأجزاء.

يعتمد الوصول إلى Firestore على REST (`runQuery`, `runAggregationQuery`, `PATCH`, `DELETE`, `commit`, والمعاملات) مع تحويل قيم Firestore وعمليات FieldValue اللازمة للمسارات الحالية. يستخدم Firebase Auth Identity Toolkit REST للتحقق، وFCM HTTP v1 للإرسال. عمليات R2 وPresigned URLs وmultipart تُوقّع عبر `aws4fetch`.

---

## 6. بنية المشروع

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
│   ├── auth.ts              # JWT عبر jose + مقارنة بيانات الاعتماد
│   ├── types.ts             # أنواع البيانات والتصنيفات
│   └── utils.ts             # Web Crypto وعمليات التنظيف والبحث
├── public/                  # الواجهة الثابتة الحالية
├── wrangler.toml
├── package.json
└── tsconfig.json
```

## 7. ملاحظات تشغيلية وأمنية

* روابط الرفع الموقعة تحدد مفتاح R2 ونوع المحتوى ومدة الصلاحية؛ يجب أن يتطابق `Content-Type` المرسل من المتصفح مع الرابط.
* محدد المعدل الحالي محفوظ في ذاكرة Worker isolate، لذا هو أفضل جهد محلي وليس حداً موزعاً أو دائماً. لا تستخدمه بديلاً عن Cloudflare WAF/Rate Limiting عند الحاجة إلى حد موثوق على مستوى كل الزيارات.
* FCM HTTP v1 لا يقدم multicast واحداً؛ إرسال الرسائل إلى عدة tokens يتطلب طلباً لكل token. الإشعارات العامة الحالية ترسل إلى topic واحد.
* خطط Cloudflare وFirebase وR2 لها حصص استخدام وحدود؛ لا يُفترض أن تكون مجانية أو غير محدودة عند أي حجم.
* لا تضع بيانات الخدمة أو كلمات المرور أو مفاتيح R2 في Git أو في ملف `wrangler.toml`.

© goldenstore.online — المتجر الذهبي الحصري للتطبيقات المهكرة
