// Dedicated sign-in page (round 36 rebuild, owner request).
// Layout: back arrow + title, logo/name/tagline, REAL e-mail + password form
// (sign in · create account · forgot password via Firebase), invite code, and
// the Google path at the bottom — unchanged behaviour, same consent rule:
// no auth request is ever sent before the Terms/Privacy box is ticked.
(function () {
  'use strict';

  var T = (window.GSI18N && window.GSI18N.t) ? window.GSI18N.t : function (s) { return s; };
  var $ = function (id) { return document.getElementById(id); };

  var gate = $('gate');
  var checking = $('checking');
  var btn = $('signin');            // Google button
  var label = btn ? btn.querySelector('.gbtn-label') : null;
  var form = $('authForm');
  var submit = $('submit');
  var emailEl = $('email');
  var passEl = $('password');
  var eye = $('eye');
  var forgot = $('forgot');
  var toRegister = $('toRegister');
  var note = $('authNote');
  var titleEl = document.querySelector('[data-auth-title]');
  var errBox = $('error');
  var consent = $('consent');
  var consentMsg = T('يجب الموافقة على شروط الخدمة وسياسة الخصوصية قبل المتابعة.');
  var navigated = false;
  var mode = 'login';               // 'login' | 'register'

  var params = new URLSearchParams(location.search);
  var isAccountSwitch = params.get('switch') === '1';
  var switchEmail = '';
  var switchAutoKey = 'gs_account_switch_started';
  var switchEmailKey = 'gs_account_switch_email';
  var switchIntentKey = 'gs_account_switch_intent';
  try {
    isAccountSwitch = isAccountSwitch && sessionStorage.getItem(switchIntentKey) === '1';
    var savedHint = sessionStorage.getItem(switchEmailKey) || '';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(savedHint) && savedHint.length <= 254) switchEmail = savedHint;
    if (!isAccountSwitch) {
      sessionStorage.removeItem(switchAutoKey);
      sessionStorage.removeItem(switchEmailKey);
      sessionStorage.removeItem(switchIntentKey);
    }
  } catch (e) { isAccountSwitch = false; }

  // Only same-origin paths are allowed, never back to the login page itself.
  function nextTarget() {
    try {
      var raw = new URLSearchParams(location.search).get('next');
      if (raw && raw.charAt(0) === '/' && raw.indexOf('//') !== 0 && raw.indexOf('/login') !== 0) return raw;
    } catch (e) {}
    return '/';
  }
  function go() {
    if (navigated) return;
    navigated = true;
    location.replace(nextTarget());
  }

  function showGoogle() { if (checking) checking.style.display = 'none'; }

  function setLoading(on, textOverride) {
    if (btn) btn.disabled = !!on;
    if (submit) { submit.disabled = !!on || !formReady(); }
    if (submit) submit.textContent = on
      ? T('جار تسجيل الدخول…')
      : (mode === 'register' ? T('إنشاء حساب') : T('تسجيل الدخول'));
    if (label) label.textContent = textOverride || T('متابعة باستخدام Google');
  }

  function showError(msg) {
    if (errBox) { errBox.textContent = msg; errBox.classList.remove('hidden'); }
  }
  function clearError() { if (errBox) { errBox.textContent = ''; errBox.classList.add('hidden'); } }

  /* ---- Mandatory legal consent (Terms + Privacy), built by /js/legal.js ---- */
  function consentBox() { return consent ? consent.querySelector('input[type="checkbox"]') : null; }
  function consentOk() { var b = consentBox(); return !!(b && b.checked); }
  function requireConsent() {
    if (consentOk()) return true;
    if (consent) consent.classList.add('consent-error');
    showError(consentMsg);
    var b = consentBox();
    if (b) { try { b.focus(); } catch (e) {} }
    return false;
  }
  if (consent) {
    consent.addEventListener('change', function () {
      if (consentOk()) consent.classList.remove('consent-error');
      clearError();
      syncSubmit();
    });
  }

  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim()); }
  function formReady() {
    if (!emailEl || !passEl) return false;
    return validEmail(emailEl.value) && String(passEl.value).length >= 6 && consentOk();
  }
  function syncSubmit() { if (submit) submit.disabled = !formReady(); }
  [emailEl, passEl].forEach(function (el) {
    if (!el) return;
    el.addEventListener('input', function () { clearError(); syncSubmit(); });
  });

  /* show / hide the password */
  if (eye && passEl) {
    eye.addEventListener('click', function () {
      var on = passEl.type === 'password';
      passEl.type = on ? 'text' : 'password';
      eye.classList.toggle('is-on', on);
      eye.setAttribute('aria-label', T(on ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'));
    });
  }

  /* switch between «تسجيل الدخول» and «إنشاء حساب» (one page, two modes) */
  function setMode(next) {
    mode = next === 'register' ? 'register' : 'login';
    var isReg = mode === 'register';
    if (titleEl) titleEl.textContent = isReg ? T('إنشاء حساب') : T('تسجيل الدخول');
    if (submit) submit.textContent = isReg ? T('إنشاء حساب') : T('تسجيل الدخول');
    if (passEl) passEl.setAttribute('autocomplete', isReg ? 'new-password' : 'current-password');
    if (forgot) forgot.textContent = isReg ? T('لدي حساب بالفعل') : T('نسيت كلمة المرور؟');
    if (toRegister) toRegister.style.display = isReg ? 'none' : '';
    if (note) note.textContent = isReg
      ? T('أنشئ حسابك بالبريد الإلكتروني وكلمة مرور من ٦ أحرف على الأقل')
      : T('قم بتسجيل حسابك بالبريد الإلكتروني الخاص بك');
    clearError();
    syncSubmit();
  }
  if (toRegister) toRegister.addEventListener('click', function () { setMode('register'); if (passEl) passEl.focus(); });
  if (forgot) forgot.addEventListener('click', function () {
    if (mode === 'register') { setMode('login'); return; }
    var email = emailEl ? emailEl.value.trim() : '';
    if (!validEmail(email)) {
      showError(T('أدخل بريدك الإلكتروني أولاً لإرسال رابط إعادة التعيين.'));
      if (emailEl) { try { emailEl.focus(); } catch (e) {} }
      return;
    }
    clearError();
    forgot.disabled = true;
    Promise.resolve()
      .then(function () { return window.GAuth.sendPasswordReset(email); })
      .then(function () { showError(T('تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك. راجع صندوق الوارد.')); })
      .catch(function (e) { showError(errorMessage(e)); })
      .then(function () { forgot.disabled = false; });
  });

  function errorMessage(e) {
    var code = e && e.code;
    switch (code) {
      case 'auth/invalid-email':
        return T('البريد الإلكتروني غير صالح.');
      case 'auth/missing-email':
        return T('أدخل بريدك الإلكتروني أولاً لإرسال رابط إعادة التعيين.');
      case 'auth/user-not-found':
        return T('لا يوجد حساب بهذا البريد. أنشئ حساباً جديداً.');
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return T('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
      case 'auth/invalid-login-credentials':
        return T('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
      case 'auth/email-already-in-use':
        return T('هذا البريد مستخدم بالفعل. سجّل الدخول بدلاً من إنشاء حساب.');
      case 'auth/weak-password':
        return T('كلمة المرور ضعيفة: استخدم ٦ أحرف على الأقل.');
      case 'auth/too-many-requests':
        return T('محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.');
      case 'auth/operation-not-allowed':
        return T('تسجيل الدخول بالبريد غير مُفعَّل حالياً. استخدم زر Google في الأسفل.');
      case 'auth/in-app-browser':
        return T('افتح الصفحة في متصفّح مثل Chrome أو Safari لإتمام تسجيل الدخول بحساب Google.');
      case 'auth/unauthorized-domain':
        return 'هذا النطاق (' + location.hostname + ') غير مُصرَّح به في Firebase. أضِفه في Authentication ← Settings ← Authorized domains.';
      case 'auth/network-request-failed':
        return T('تعذّر الاتصال بالشبكة. تحقّق من الإنترنت وحاول مجدداً.');
      case 'auth/popup-blocked':
        return T('المتصفّح حظر النافذة المنبثقة. اسمح بالنوافذ المنبثقة ثم حاول مجدداً.');
      case 'auth/sdk-not-ready':
        return T('تعذّر تحميل خدمة المصادقة. تحقّق من اتصال الإنترنت وأعد المحاولة.');
      case 'auth/developer-error':
        return T('تعذّر المصادقة مع Google (مشكلة إعدادات Firebase). حاول مجدداً، وإن تكرّر الخطأ فابلغ الإدارة.');
      default:
        return T('تعذّر تسجيل الدخول') + (code ? ' (' + code + ')' : '') + '. ' + T('حاول مجدداً.');
    }
  }

  if (!window.GAuth || typeof window.GAuth.onAuthChange !== 'function') {
    showGoogle();
    showError('تعذّر تحميل خدمة تسجيل الدخول. حدّث الصفحة وحاول مجدداً.');
    return;
  }

  try { window.GAuth.init(); } catch (e) {}

  function clearSwitchState() {
    try {
      sessionStorage.removeItem(switchAutoKey);
      sessionStorage.removeItem(switchEmailKey);
      sessionStorage.removeItem(switchIntentKey);
    } catch (e) {}
  }

  /* ---------------------------- e-mail + password ------------------------- */
  if (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      clearError();
      if (!validEmail(emailEl.value)) {
        showError(T('البريد الإلكتروني غير صالح.'));
        try { emailEl.focus(); } catch (e) {}
        return;
      }
      if (String(passEl.value).length < 6) {
        showError(T('كلمة المرور يجب أن تكون ٦ أحرف على الأقل.'));
        try { passEl.focus(); } catch (e) {}
        return;
      }
      if (!requireConsent()) return;
      var email = emailEl.value.trim();
      var pass = passEl.value;
      setLoading(true);
      var task = mode === 'register'
        ? window.GAuth.signUpWithEmail(email, pass, '')
        : window.GAuth.signInWithEmail(email, pass);
      Promise.resolve(task)
        .then(function (user) { if (user) { clearSwitchState(); go(); } else setLoading(false); })
        .catch(function (e) { showError(errorMessage(e)); setLoading(false); });
    });
  }

  /* ------------------------------ Google path ---------------------------- */
  function startAccountSwitch() {
    if (!consentOk()) { showGoogle(); return; }     // never before consent
    var alreadyStarted = false;
    try { alreadyStarted = sessionStorage.getItem(switchAutoKey) === '1'; } catch (e) {}
    if (alreadyStarted) { showGoogle(); return; }
    try { sessionStorage.setItem(switchAutoKey, '1'); } catch (e) {}
    showGoogle();
    setLoading(true);
    Promise.resolve()
      .then(function () { return window.GAuth.signInWithGoogle({ loginHint: switchEmail, forceRedirect: true }); })
      .then(function (user) { if (user) { clearSwitchState(); go(); } else setLoading(false); })
      .catch(function (e) { showError(errorMessage(e)); setLoading(false); });
  }

  window.GAuth.onAuthChange(function (user) {
    if (user) { clearSwitchState(); go(); return; }
    if (isAccountSwitch) { startAccountSwitch(); return; }
    showGoogle();
  });

  // Safety: never leave the spinner forever if auth state is slow to resolve.
  setTimeout(function () { if (!navigated) showGoogle(); }, 6000);

  if (btn) {
    btn.addEventListener('click', function () {
      if (!requireConsent()) return;                // required checkbox
      clearError();
      setLoading(true);
      var timeout = setTimeout(function () { setLoading(false); }, 15000);
      Promise.resolve()
        .then(function () {
          return window.GAuth.signInWithGoogle(isAccountSwitch
            ? { loginHint: switchEmail, forceRedirect: true }
            : undefined);
        })
        .then(function (user) {
          clearTimeout(timeout);
          if (user) { clearSwitchState(); go(); } else setLoading(false);
        })
        .catch(function (e) { clearTimeout(timeout); showError(errorMessage(e)); setLoading(false); });
    });
  }

  setMode('login');
  if (isAccountSwitch) { showGoogle(); startAccountSwitch(); }
})();
