# التنزيل الذي لا يتوقف — الإصلاح الوحيد الباقي

## لماذا كل الإصلاحات السابقة لم تكفِ

| ما أصلحته | ما يفعله فعلاً |
|---|---|
| رابط دائم لا ينتهي | يمنع موت الرابط — لكنه **لا يبقي الاتصال حياً** |
| تسجيل الإيقاف المؤقت | يجعل التنزيل **قابلاً للاستئناف** — لا يمنع التوقف |
| إصلاح `progressNorm` | يصلح التتبّع — لا يملك الاتصال |
| `visibilitychange` | يُشعر الصفحة — لا يُنقذ الاتصال |

**السبب الجذري:** التنزيل يحدث **داخل كود التطبيق المثبّت** (WebView). عندما تُخفى الصفحة يوقف
أندرويد شبكة الـWebView، فينقطع الاتصال — **ولا يستطيع أي كود في الموقع منع ذلك**، لأن الموقع
لا يملك الاتصال أصلاً.

**الحلّ الوحيد:** أن يملك **نظام أندرويد** التنزيل لا الـWebView. عندها يكمل التنزيل حتى لو
أُغلقت الصفحة أو قُتل التطبيق، ويظهر في شريط إشعارات أندرويد.

الموقع **جاهز تماماً** الآن: يستدعي `downloadApkDurable` تلقائياً إن وُجدت، ويرجع للطريقة القديمة
إن لم توجد (لا شيء ينكسر).

---

## ما يجب إضافته إلى كود التطبيق (دالة واحدة)

افتح الملف الذي يحتوي `class GSAndroidBridge` وأضف داخله:

```kotlin
import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment

private val dm by lazy { ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager }
private val dmIds = mutableMapOf<String, Long>()   // slug -> downloadId

/** تنزيل يملكه نظام أندرويد: يكمل بعد إغلاق الصفحة وقتل التطبيق. */
@JavascriptInterface
fun downloadApkDurable(
    url: String,
    filename: String,
    slug: String,
    pkg: String,
    appName: String,
    iconUrl: String
) {
    val req = DownloadManager.Request(Uri.parse(url)).apply {
        setTitle(appName.ifBlank { filename })
        setDescription(appName)
        setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        setDestinationInExternalFilesDir(ctx, Environment.DIRECTORY_DOWNLOADS, filename)
        setAllowedOverMetered(true)
        setAllowedOverRoaming(true)
        setMimeType("application/vnd.android.package-archive")
    }
    val id = dm.enqueue(req)
    dmIds[slug] = id
    // أبلغ الصفحة أن التنزيل بدأ (اختياري لكن مفيد)
    notifyJs(slug, "downloading", 0.0, filename)
}

/** تقدّم حقيقي من نظام أندرويد — استدعِها كل ثانية من الويب عبر evaluateJavascript. */
@JavascriptInterface
fun getDurableProgress(slug: String): String {
    val id = dmIds[slug] ?: return ""
    val q = DownloadManager.Query().setFilterById(id)
    dm.query(q).use { c ->
        if (!c.moveToFirst()) return ""
        val done = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
        val total = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
        val status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
        val pct = if (total > 0) done.toDouble() / total else 0.0
        val st = when (status) {
            DownloadManager.STATUS_SUCCESSFUL -> "downloaded"
            DownloadManager.STATUS_FAILED -> "failed"
            DownloadManager.STATUS_PAUSED -> "paused"
            else -> "downloading"
        }
        return "{\"status\":\"$st\",\"progress\":$pct,\"filename\":\"${filenameFor(slug)}\"}"
    }
}
```

### ما يجب أن تفعله بعد اكتمال التنزيل

```kotlin
// عند STATUS_SUCCESSFUL: افتح مثبّت النظام (لا التطبيق)
val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files",
    File(File(ctx.filesDir, "downloads"), filename))
Intent(Intent.ACTION_VIEW).apply {
    setDataAndType(uri, "application/vnd.android.package-archive")
    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
}
```

### الصلاحيات في `AndroidManifest.xml`

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

> `DownloadManager` **لا يحتاج** صلاحية تخزين عند استخدام
> `setDestinationInExternalFilesDir` — وهذا مهم لتفادي مشاكل أندرويد 10+.

---

## كيف تتأكد أن الإصلاح عمل

1. ثبّت النسخة الجديدة من التطبيق.
2. ابدأ تنزيل لعبة كبيرة.
3. اخرج وافتح **خمسة** تطبيقات أخرى، وانتظر دقيقتين.
4. ارجع — ستجد التنزيل **اكتمل**، أو ظهر في شريط إشعارات أندرويد.

بعد الإضافة، سيتحول الموقع تلقائياً إلى المسار الجديد لأنه يختبر وجود
`downloadApkDurable` قبل كل تنزيل. لا حاجة لأي تغيير آخر في الموقع.

---

## إن لم يكن لديك كود التطبيق

الحلّ المؤقت الذي يعمل **بدون أي تعديل على التطبيق**: أن يفتح المتجر رابط التنزيل في **متصفح
أندرويد** بدل منزّله الداخلي. متصفح أندرويد يستخدم `DownloadManager` أصلاً، فيكمل التنزيل مهما
تنقّلت. أخبرني وأجعل الموقع يفعل ذلك تلقائياً.
