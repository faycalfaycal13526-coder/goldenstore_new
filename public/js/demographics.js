/* Golden Store — optional, anonymous, aggregate-only demographics.
   Only rendered when the admin explicitly enables it in Settings.
   No name/email/birthdate is ever collected or sent. */
(function () {
  const host = document.getElementById('gs-demographics');
  if (!host) return;
  const t = (s) => {
    try { return window.GSI18N && typeof window.GSI18N.t === 'function' ? window.GSI18N.t(s) : s; }
    catch (e) { return s; }
  };
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k, String(v));
    });
    kids.forEach((c) => { if (c == null || c === false) return; n.append(c && c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  };
  const UID_KEY = 'gs_demo_uid';
  function anonId() {
    try {
      let id = localStorage.getItem(UID_KEY);
      if (!id) {
        id = 'd_' + (window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID().replace(/-/g, '')
          : Math.random().toString(36).slice(2) + Date.now().toString(36));
        localStorage.setItem(UID_KEY, id);
      }
      return id;
    } catch (e) { return 'd_' + Math.random().toString(36).slice(2); }
  }
  const AGES = [['13-17', '13–17'], ['18-24', '18–24'], ['25-34', '25–34'],
    ['35-44', '35–44'], ['45-54', '45–54'], ['55+', '55+']];
  const GENDERS = [['male', 'ذكر'], ['female', 'أنثى'], ['other', 'آخر'], ['prefer_not', 'أفضّل عدم التحديد']];

  async function init() {
    let settings = {};
    try {
      const r = await fetch('/api/settings?_=' + Date.now(), { cache: 'no-store' });
      settings = (await r.json()).settings || {};
    } catch (e) { return; }
    if (settings.collect_demographics !== '1') { host.innerHTML = ''; return; }
    const uid = anonId();
    let saved = null;
    try {
      const r = await fetch('/api/profile/demographics/' + encodeURIComponent(uid));
      saved = (await r.json()).demographics || null;
    } catch (e) {}

    const age = el('select', { class: 'input', 'aria-label': t('الفئة العمرية') },
      el('option', { value: '' }, t('اختر الفئة العمرية')),
      ...AGES.map(([v, l]) => el('option', { value: v }, l)));
    const gender = el('select', { class: 'input', 'aria-label': t('الجنس') },
      el('option', { value: '' }, t('اختر الجنس')),
      ...GENDERS.map(([v, l]) => el('option', { value: v }, t(l))));
    const country = el('input', { class: 'input', type: 'text', maxlength: '60',
      placeholder: t('الدولة (اختياري)'), 'aria-label': t('الدولة') });
    const consent = el('input', { type: 'checkbox' });
    const status = el('div', { class: 'hint gs-demo-status' });
    if (saved) {
      age.value = saved.age_range || '';
      gender.value = saved.gender || '';
      country.value = saved.country || '';
      consent.checked = Number(saved.opted_in) !== 0;
      status.textContent = t('تم حفظ بياناتك الاختيارية');
    }
    const saveBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => {
      if (!consent.checked) { status.textContent = t('يجب الموافقة أولاً'); return; }
      saveBtn.disabled = true;
      try {
        const r = await fetch('/api/profile/demographics', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid, age_range: age.value, gender: gender.value,
            country: country.value.trim().slice(0, 60), opted_in: true }),
        });
        if (!r.ok) throw new Error('save_failed');
        status.textContent = t('تم حفظ بياناتك الاختيارية');
      } catch (e) { status.textContent = t('تعذّر حفظ البيانات'); }
      saveBtn.disabled = false;
    } }, t('حفظ البيانات الاختيارية'));
    const withdrawBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: async () => {
      try {
        await fetch('/api/profile/demographics', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid, opted_in: false, age_range: '', gender: '', country: '' }),
        });
        age.value = ''; gender.value = ''; country.value = ''; consent.checked = false;
        status.textContent = t('تم سحب الموافقة');
      } catch (e) { status.textContent = t('تعذّر حفظ البيانات'); }
    } }, t('سحب الموافقة'));

    host.innerHTML = '';
    host.append(el('section', { class: 'gs-demo-card', 'data-noi18n': '' },
      el('div', { class: 'gs-demo-head' },
        el('span', { class: 'gs-demo-icon' }, '◆'),
        el('div', null, el('h2', null, t('ساعدنا في تحسين المتجر')),
          el('p', null, t('بيانات اختيارية ومجهولة بالكامل — تُستخدم للأرقام المجمّعة فقط.')))),
      el('div', { class: 'gs-demo-fields' },
        el('label', null, t('الفئة العمرية'), age),
        el('label', null, t('الجنس'), gender),
        el('label', null, t('الدولة'), country)),
      el('label', { class: 'gs-demo-consent' }, consent,
        t('أوافق على استخدام هذه البيانات لأغراض إحصائية مجمّعة فقط، دون ربطها بحسابي.')),
      el('div', { class: 'gs-demo-actions' }, saveBtn, withdrawBtn, status)));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
