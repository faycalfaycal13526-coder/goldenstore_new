# Golden Store — دمج إشعارات تطبيق الأندرويد (APK) مع النظام الموحّد

> الهدف: **إشعار واحد فقط** لكل مستخدم، في المتصفح **و** في التطبيق، مع محرك إرسال واحد.
> هذا الملف هو الجزء الوحيد الذي يحتاج تعديلاً داخل الـ APK. بقية الإصلاحات على الموقع جاهزة.

---

## 1. ما الذي كان يحدث؟

| العَرَض | السبب الجذري |
|---|---|
| 3 إشعارات لمستخدم المتصفح | نفس الجهاز كان مسجّلاً في `fcm_tokens` **و** `web_tokens`، ودوران توكن FCM يترك عدة صفوف قديمة لنفس المستخدم؛ كل صف كان يستقبل رسالة مستقلة (موضوع + مباشر + Web Push). وفوقها حمولة `notification` تُعرض تلقائياً من SDK مع عرض يدوي من السيرفس ووركر. |
| التطبيق لا تصله أي إشعارات | عميل المتصفح يتوقف تماماً داخل Capacitor (`isCapacitorApp()`)، ولم يكن هناك أي استدعاء موثوق لتسجيل توكن FCM الأصلي، ولا بديل داخل التطبيق. |

## 2. ما الذي يوفّره الموقع الآن

| الواجهة | الوظيفة |
|---|---|
| `POST /api/notifications/register-device` | تسجيل موحّد: `channel: 'native' \| 'web'` + `installation_id` + `permission` + `notifications_enabled`. |
| `window.GSNotify.registerNativeToken(token, opts)` | يستدعي الواجهة أعلاه بعد تسجيل الدخول؛ يضع الطلب في قائمة انتظار إن لم يكن المستخدم قد سجّل دخوله بعد. |
| `window.__gsRegisterPushToken(token, installationId)` | الاسم القديم الذي يستدعيه الـ APK — **ما زال يعمل**، لكنه الآن يمرّ عبر النظام الموحّد. |
| حدث `gs-fcm-token` | `window.dispatchEvent(new CustomEvent('gs-fcm-token', { detail: { token } }))`. |
| `window.GSNotify.installationId()` | معرّف ثابت للجهاز (localStorage). |
| `GET /api/notifications` + `notification-hub.js` | **بديل دائم داخل التطبيق**: استطلاع كل 30 ثانية + toast واحد لكل إشعار + مركز الإشعارات. يعمل حتى بلا FCM وبلا إذن إشعارات. |
| `POST /api/notifications/receipt` | إيصال «عُرض / نُقر عليه» للتشخيص الحقيقي. |

**مهم:** داخل WebView لتطبيق Capacitor، عميل Web Push **لا يسجّل نفسه عمداً** (`notifications.js`), لأن القناة الأصلية هي القناة الوحيدة على الهاتف. هذا يمنع ازدواج إشعارات النظام. مركز الإشعارات داخل التطبيق يعمل دائماً كطبقة احتياطية.

---

## 3. كود الـ APK (Kotlin)

### 3.1 جسر JavaScript إلى WebView

```kotlin
class GSAndroidBridge(private val ctx: Context, private val webView: WebView) {
    private val prefs = ctx.getSharedPreferences("gs_push", Context.MODE_PRIVATE)

    // معرّف ثابت لا يتغير بعد إعادة تثبيت التطبيق فقط (ليس بعد كل تشغيل).
    @JavascriptInterface
    fun installationId(): String {
        var id = prefs.getString("installation_id", null)
        if (id == null) {
            id = "apk-" + UUID.randomUUID().toString()
            prefs.edit().putString("installation_id", id).apply()
        }
        return id!!
    }

    // POST_NOTIFICATIONS على أندرويد 13+
    @JavascriptInterface
    fun notificationPermission(): String =
        if (Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) "granted" else "denied"

    @JavascriptInterface
    fun getFcmToken(): String = prefs.getString("fcm_token", "") ?: ""
}
webView.settings.javaScriptEnabled = true
webView.addJavascriptInterface(GSAndroidBridge(this, webView), "GSAndroid")
```

### 3.2 جلب توكن FCM وتمريره إلى الموقع

```kotlin
FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
    if (!task.isSuccessful) return@addOnCompleteListener
    val token = task.result
    getSharedPreferences("gs_push", MODE_PRIVATE)
        .edit().putString("fcm_token", token).apply()

    fun pushToWeb() {
        val js = """
          (function () {
            var t = ${JSONObject.quote(token)};
            var id = (window.GSAndroid && window.GSAndroid.installationId)
                       ? window.GSAndroid.installationId() : null;
            if (window.__gsRegisterPushToken) window.__gsRegisterPushToken(t, id);
            else window.dispatchEvent(new CustomEvent('gs-fcm-token', {detail:{token:t}}));
          })();
        """.trimIndent()
        webView.post { webView.evaluateJavascript(js, null) }
    }
    pushToWeb()                       // بعد تحميل الصفحة
    webView.webViewClient = object : WebViewClient() {
        override fun onPageFinished(view: WebView, url: String) { pushToWeb() }
    }
}
```

> لا حاجة لتعديل `__gsRegisterPushToken`: في `public/js/store.js` أصبح يمرّر التوكن إلى
> `GSNotify.registerNativeToken()` → `/api/notifications/register-device`، ويحفظ `installation_id`
> إن مرّرته، وإلا استخدم معرّف الجهاز الخاص بالـ WebView. **معرّف واحد ثابت = توكن واحد نشط**؛
> عند دوران توكن FCM يُحذف القديم ويُلغى اشتراكه من موضوع `all` تلقائياً من الخادم.

### 3.3 استقبال الرسالة: **لا تعرضها يدوياً**

الخادم يرسل للتطبيق حمولة تحتوي `notification` + `android.notification` (مع `tag`/`collapse_key`
مستقرين). نظام أندرويد يعرضها تلقائياً عندما يكون التطبيق في الخلفية. إن عرضتها أيضاً من
`onMessageReceived` ستحصل على إشعارين — لا تفعل ذلك.

```kotlin
class GsFcmService : FirebaseMessagingService() {
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        // حمولة العرض تُدار من FCM؛ هنا فقط نوجّه الضغط ونبلغ عن الاستلام إن لزم.
        val data = remoteMessage.data
        val click = data["click_url"] ?: ""
        // احفظ الرابط للـ Activity التي تُفتح عند الضغط، لا تعرض إشعاراً ثانياً.
        if (click.isNotEmpty()) getSharedPreferences("gs_push", MODE_PRIVATE)
            .edit().putString("pending_click_url", click).apply()
    }

    override fun onNewToken(token: String) {
        getSharedPreferences("gs_push", MODE_PRIVATE)
            .edit().putString("fcm_token", token).apply()
        // أعد تمرير التوكن إلى WebView (نفس دالة pushToWeb) — الخادم يحذف القديم.
    }
}
```

قناة الإشعارات (إلزامي على أندرويد 8+):

```kotlin
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    val ch = NotificationChannel(
        "goldenstore_notifications", "إشعارات Golden Store",
        NotificationManager.IMPORTANCE_HIGH)
    getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
}
```

### 3.4 إن كنت تستخدم Capacitor Push Notifications بدلاً من FCM المباشر

لا تحتاج أي كود إضافي: `public/js/notification-hub.js` يستمع تلقائياً إلى
`PushNotifications.addListener('registration', …)` ويسجّل التوكن كقناة `native`.
فقط تأكد من إضافة `@capacitor/push-notifications` و `google-services.json` الصحيح
(نفس مشروع Firebase `golden-store-40dd6` المستخدم في الموقع).

---

## 4. قائمة تحقق بعد بناء الـ APK

1. افتح التطبيق، اسمح بالإشعارات، سجّل الدخول.
2. لوحة التحكم → **مركز الإشعارات الموحّد** → الحالة يجب أن تُظهر `تطبيق: 1`.
   أو `GET /api/admin/push/unified-status` → `channels.native.eligible >= 1`.
3. اضغط «إشعار تجريبي»؛ يجب أن يظهر **إشعار واحد** على الهاتف + toast واحد داخل التطبيق.
4. `GET /api/admin/push/diagnostics` و `GET /api/admin/push/logs` لمراجعة `success/failure`.
5. كرّر بعد إعادة فتح التطبيق: لا يظهر الإشعار القديم مرة أخرى (سجل `push_delivery`).
6. فعّل كسر الكاش `?v=20261108b` بعمل Hard Refresh / إعادة فتح التطبيق بعد النشر.

---

## 5. ملاحظات أمنية

- التوكن لا يُسجَّل في السجلات كاملاً (يُحفظ آخر 6 أحرف فقط في `push_reg_log`).
- واجهة التسجيل تتطلب جلسة Firebase (`Authorization: Bearer <idToken>`) ومحدودة بـ 30 طلب/دقيقة.
- `installation_id` معرّف عشوائي، لا يحتوي على بريد أو رقم هاتف أو IMEI.
- لا تضع أي `ghp_…` أو `cfut_…` داخل الـ APK أو المستودع؛ بدّل أي توكن سبق مشاركته.
