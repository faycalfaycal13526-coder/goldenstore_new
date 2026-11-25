# Capacitor: التنزيل الذي لا يتوقف — خطوة واحدة فقط

## الخلاصة في سطر

الموقع أصبح **يجرّب أن يسلّم التنزيل إلى الطبقة الأصلية** (Native) قبل أي شيء آخر.
كل ما تحتاجه أنت: **تثبيت إضافة واحدة وإعادة بناء التطبيق.**

```bash
npm install @capacitor/filesystem
npx cap sync android
```

ثم أعد بناء الـAPK. **لا كود إضافي. لا تعديل على الـJavaScript.**

---

## لماذا هذا يحلّ المشكلة

| | التنزيل القديم | بعد الإضافة |
|---|---|---|
| من يملك الاتصال؟ | **الـWebView** (داخل الصفحة) | **نظام أندرويد** |
| عند تبديل التطبيق | 🔴 ينقطع | 🟢 يكمل |
| عند إغلاق الصفحة | 🔴 يتوقف | 🟢 يكمل |
| عند قتل التطبيق | 🔴 يتوقف | 🟢 يكمل (DownloadManager) |
| عند قفل الشاشة | 🔴 يتوقف | 🟢 يكمل |

**السبب:** أي `fetch` يبدأ داخل الـWebView يقتله أندرويد عند إخفاء الصفحة. لا يستطيع أي كود في
الموقع منع ذلك — لأن الموقع لا يملك الاتصال. `@capacitor/filesystem` ينقل التنزيل إلى الطبقة
الأصلية، فيصبح مملوكاً للنظام.

---

## ما فعله الموقع (جاهز ومنشور)

عند كل تنزيل يجرّب بالترتيب حتى ينجح:

| # | المسار | يحتاج منك |
|---|---|---|
| ١ | `DownloadManager` عبر `GSAndroid.downloadApkDurable` | دالة Kotlin (اختياري) |
| ٢ | **`@capacitor/filesystem` ← `downloadFile`** | **`npm i @capacitor/filesystem`** |
| ٣ | جسر مخصّص `GSAndroid.downloadApk` | إن وُجد عندك |
| ٤ | متصفح النظام (`Browser.open`) | لا شيء |
| ٥ | البثّ القديم داخل الصفحة | آخر حلّ |

وإن لم يتوفر أي مسار، يسلّم الملف لمُنزِّل النظام عبر رابط **دائم** لا ينتهي.

**مهم:** كل مسار يستلم الرابط الدائم
`https://cdn.goldenstore.online/apk/…apk` (بلا توقيع، بلا انتهاء، يدعم `Range`).

---

## كيف تتأكد

1. بعد `npx cap sync android` أعد بناء التطبيق وثبّته.
2. ابدأ تنزيل لعبة كبيرة.
3. بدّل بين **٥ تطبيقات** وانتظر دقيقتين.
4. ارجع: التنزيل يجب أن يكون **قد تقدّم أو اكتمل**.

للتأكد من المسار المستخدم، افتح DevTools (Chrome → `chrome://inspect`) ونفّذ:

```js
window.Store.durableRoutes()
// { downloadManager: false, filesystem: true, bridge: true, browser: true }
```

`filesystem: true` تعني أن المسار الأصلي جاهز.

---

## إن أردت المسار الأقوى (DownloadManager)

`@capacitor/filesystem` كافٍ ويحلّ المشكلة. لكن إن أردت أن يكمل التنزيل **حتى لو قُتل التطبيق**
وأن يظهر في شريط إشعارات أندرويد، أضف هذه الدالة إلى مشروع أندرويد داخل Capacitor
(`android/app/src/main/java/.../MainActivity.java` أو كلاس الجسر عندك):

```java
@JavascriptInterface
public void downloadApkDurable(String url, String filename, String slug,
                              String pkg, String name, String icon) {
    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
    req.setTitle(name);
    req.setDescription(name);
    req.setNotificationVisibility(
        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
    req.setDestinationInExternalFilesDir(getContext(),
        Environment.DIRECTORY_DOWNLOADS, filename);
    req.setAllowedOverMetered(true);
    req.setAllowedOverRoaming(true);
    req.setMimeType("application/vnd.android.package-archive");
    DownloadManager dm = (DownloadManager) getContext()
        .getSystemService(Context.DOWNLOAD_SERVICE);
    dm.enqueue(req);
}
```

ثم في `MainActivity`:

```java
webView.addJavascriptInterface(new GSAndroidBridge(this, webView), "GSAndroid");
```

الموقع سيكتشفها تلقائياً ويستخدمها قبل أي مسار آخر.

---

## ملاحظة عن تثبيت الملف بعد التنزيل

`Filesystem` ينزّل الملف **داخل مساحة التطبيق**، فأندرويد لا يستطيع تثبيته مباشرة من هناك في
الإصدارات الحديثة. لذلك بعد اكتمال التنزيل:

- إما استخدم `@capacitor/share` / `FileOpener` لفتح الملف في المثبّت،
- أو **الأفضل:** استخدم مسار `DownloadManager` أعلاه، لأن أندرويد يثبّته من الإشعار بضغطة واحدة.

الموقع يطلق حدثاً عند اكتمال تنزيل Filesystem يمكنك التقاطه:

```js
window.addEventListener('gs-native-download-done', (e) => {
  // e.detail = { slug, path, filename }
});
```
