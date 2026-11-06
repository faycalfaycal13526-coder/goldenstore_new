/* Golden Store — Advanced Push System + Analytics dashboard (admin).
   Loaded by gs-admin-c0d982f8.html; exposes window.GSAdminAdvanced.
   Uses only browser APIs + fetch (no Node libraries). */
(function () {
  'use strict';

  function el(tag, attrs) {
    const node = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') node.value = v;
      else node.setAttribute(k, v);
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c == null || c === false) continue;
      node.append(c && c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function num(v) { try { return new Intl.NumberFormat('ar').format(Number(v || 0)); } catch { return String(v || 0); } }
  function fmtDate(sec) {
    if (!sec) return '—';
    try { return new Date(Number(sec) * 1000).toLocaleString('ar', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return String(sec); }
  }
  async function api(path, opts) {
    const o = opts || {};
    const res = await fetch(path, {
      method: o.method || 'GET',
      headers: Object.assign({}, o.body ? { 'Content-Type': 'application/json' } : {}),
      credentials: 'same-origin',
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok) throw new Error(data.error || data.message || ('HTTP ' + res.status));
    return data;
  }
  function panel(title, iconText) {
    return el('div', { class: 'panel' },
      el('div', { class: 'panel-head' }, iconText ? el('span', { class: 'adv-ico', text: iconText }) : null, title));
  }
  function field(label, control, hint) {
    return el('div', { class: 'field' }, el('label', null, label), control,
      hint ? el('div', { class: 'hint', text: hint }) : null);
  }
  function kpi(label, value, sub) {
    return el('div', { class: 'adv-kpi' },
      el('div', { class: 'adv-kpi-value', text: num(value) }),
      el('div', { class: 'adv-kpi-label', text: label }),
      sub ? el('div', { class: 'hint', text: sub }) : null);
  }

  /* ---------------------------------------------------------------------
     Advanced push tab
     --------------------------------------------------------------------- */
  async function renderPush(host) {
    host.innerHTML = '';
    const status = el('div', { class: 'adv-status' });

    const title = el('input', { class: 'input', type: 'text', placeholder: 'عنوان الإشعار', maxlength: '200' });
    const body = el('textarea', { class: 'input', rows: '3', placeholder: 'نص الإشعار' });
    const imageUrl = el('input', { class: 'input', type: 'url', placeholder: 'https://... (اختياري)' });
    const clickUrl = el('input', { class: 'input', type: 'text', placeholder: '/app?slug=... أو https://... (اختياري)' });
    const schedule = el('input', { class: 'input', type: 'datetime-local' });

    const mode = el('select', { class: 'input' });
    [['all', 'الجميع (مؤهّلون)'], ['uid', 'مستخدم واحد (UID)'], ['token', 'جهاز واحد (Token)'],
     ['platform', 'منصة محددة'], ['app', 'متابعو تطبيق'], ['active', 'نشطون آخر N يوم']]
      .forEach(([v, l]) => mode.append(el('option', { value: v }, l)));
    const extraWrap = el('div', { class: 'field' });
    const uidInput = el('input', { class: 'input', type: 'text', placeholder: 'UID' });
    const tokenInput = el('input', { class: 'input', type: 'text', placeholder: 'FCM token' });
    const platformSel = el('select', { class: 'input' });
    [['android', 'Android'], ['ios', 'iOS'], ['web', 'Web']]
      .forEach(([v, l]) => platformSel.append(el('option', { value: v }, l)));
    const appSlug = el('input', { class: 'input', type: 'text', placeholder: 'slug التطبيق' });
    const days = el('input', { class: 'input', type: 'number', value: '7', min: '1', max: '90' });

    function syncExtra() {
      extraWrap.innerHTML = '';
      const m = mode.value;
      if (m === 'uid') extraWrap.append(el('label', null, 'UID المستهدف'), uidInput);
      else if (m === 'token') extraWrap.append(el('label', null, 'رمز الجهاز'), tokenInput);
      else if (m === 'platform') extraWrap.append(el('label', null, 'المنصة'), platformSel);
      else if (m === 'app') extraWrap.append(el('label', null, 'معرّف التطبيق (slug)'), appSlug);
      else if (m === 'active') extraWrap.append(el('label', null, 'عدد الأيام'), days);
      else extraWrap.append(el('div', { class: 'hint', text: 'سيُرسل لكل الأجهزة المؤهّلة عبر الموضوع + الإرسال المباشر.' }));
    }
    mode.addEventListener('change', syncExtra);
    syncExtra();

    function segment() {
      const s = { mode: mode.value };
      if (s.mode === 'uid') s.uid = uidInput.value.trim();
      else if (s.mode === 'token') s.token = tokenInput.value.trim();
      else if (s.mode === 'platform') s.platform = platformSel.value;
      else if (s.mode === 'app') s.app_slug = appSlug.value.trim();
      else if (s.mode === 'active') s.days = Number(days.value) || 7;
      return s;
    }
    function payload() {
      return {
        title: title.value.trim(), body: body.value.trim(),
        image_url: imageUrl.value.trim(), click_url: clickUrl.value.trim(),
        segment: segment(),
      };
    }
    function validate() {
      if (!title.value.trim()) { status.textContent = 'أدخل عنوان الإشعار.'; return false; }
      const s = segment();
      if (s.mode === 'uid' && !s.uid) { status.textContent = 'أدخل UID.'; return false; }
      if (s.mode === 'token' && !s.token) { status.textContent = 'أدخل رمز الجهاز.'; return false; }
      if (s.mode === 'app' && !s.app_slug) { status.textContent = 'أدخل معرّف التطبيق.'; return false; }
      return true;
    }
    function showResult(push) {
      if (!push) { status.textContent = 'تم التنفيذ.'; return; }
      const parts = [
        'المستهدفون: ' + num(push.targeted || 0),
        'نجح: ' + num(push.success || 0),
        'فشل: ' + num(push.failure || 0),
      ];
      if (push.topic_targeted) parts.push('عبر الموضوع: ' + num(push.topic_targeted));
      if (push.web_targeted) parts.push('ويب: ' + num(push.web_targeted));
      if (push.invalid_removed) parts.push('رموز محذوفة: ' + num(push.invalid_removed));
      if (push.errors && push.errors.length) parts.push('أخطاء: ' + push.errors.slice(0, 2).join(' | '));
      status.textContent = parts.join(' • ');
    }
    async function drain(push) {
      let rounds = 0;
      while (push && push.job_id && (push.pending || 0) > 0 && rounds < 20) {
        rounds++;
        const more = await api('/api/admin/push/flush-advanced', {
          method: 'POST', body: { job_id: push.job_id },
        });
        push.success = (push.success || 0) + (more.success || 0);
        push.failure = (push.failure || 0) + (more.failure || 0);
        push.invalid_removed = (push.invalid_removed || 0) + (more.invalid_removed || 0);
        push.pending = more.pending || 0;
        showResult(push);
        if (more.done) break;
      }
    }

    const form = panel('إرسال إشعار متقدم', '✦');
    form.append(
      el('div', { class: 'adv-grid' },
        field('الجمهور', mode),
        extraWrap,
        field('صورة الإشعار (URL)', imageUrl, 'تظهر كصورة كبيرة في أندرويد وأيقونة في المتصفح.'),
        field('الرابط عند النقر', clickUrl, 'مسار داخل المتجر أو رابط https.'),
      ),
      field('العنوان', title),
      field('النص', body),
      field('جدولة (اتركه فارغاً للإرسال فوراً)', schedule, 'تُعالَج الإشعارات المجدولة كل 5 دقائق عبر Cron.'),
      el('div', { class: 'btn-row adv-actions' },
        el('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => {
          status.textContent = 'جارٍ حساب الجمهور…';
          try {
            const r = await api('/api/admin/push/audience-preview', { method: 'POST', body: { segment: segment() } });
            status.textContent = `الجمهور: ${num(r.targeted)} جهاز (أصلي ${num(r.native_count)} • ويب ${num(r.web_count)})`;
          } catch (e) { status.textContent = 'تعذّرت المعاينة: ' + e.message; }
        } }, 'معاينة الجمهور'),
        el('button', { class: 'btn btn-primary', type: 'button', onclick: async (ev) => {
          if (!validate()) return;
          const b = ev.currentTarget; b.disabled = true; status.textContent = 'جارٍ الإرسال…';
          try {
            const r = await api('/api/admin/push/send-advanced', { method: 'POST', body: payload() });
            showResult(r.push);
            await drain(r.push);
            await refreshScheduled(); await refreshHistory();
          } catch (e) { status.textContent = 'فشل الإرسال: ' + e.message; }
          b.disabled = false;
        } }, 'إرسال الآن'),
        el('button', { class: 'btn btn-secondary', type: 'button', onclick: async (ev) => {
          if (!validate() || !schedule.value) { status.textContent = 'اختر تاريخ ووقت الجدولة.'; return; }
          const b = ev.currentTarget; b.disabled = true;
          try {
            const r = await api('/api/admin/push/schedule', {
              method: 'POST', body: Object.assign(payload(), { scheduled_at: schedule.value }),
            });
            status.textContent = `تمت الجدولة (#${r.id}) لـ ${fmtDate(r.scheduled_at)}`;
            await refreshScheduled();
          } catch (e) { status.textContent = 'فشلت الجدولة: ' + e.message; }
          b.disabled = false;
        } }, 'جدولة'),
      ),
      status,
    );

    const scheduledPanel = panel('الإشعارات المجدولة', '⏱');
    const scheduledBody = el('div');
    scheduledPanel.append(
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: async () => {
          status.textContent = 'جارٍ معالجة المستحق…';
          try { const r = await api('/api/admin/push/cron-run', { method: 'POST', body: {} });
            status.textContent = `تم إرسال ${num(r.sent)} • فشل ${num(r.failed)}`;
            await refreshScheduled(); await refreshHistory();
          } catch (e) { status.textContent = e.message; }
        } }, 'تشغيل المعالجة الآن')),
      scheduledBody);

    const historyPanel = panel('سجل الإشعارات', '≡');
    const historyBody = el('div');
    historyPanel.append(historyBody);

    async function refreshScheduled() {
      scheduledBody.innerHTML = '<div class="hint">جارٍ التحميل…</div>';
      try {
        const r = await api('/api/admin/push/scheduled');
        const list = r.scheduled || [];
        scheduledBody.innerHTML = '';
        if (!list.length) { scheduledBody.append(el('div', { class: 'hint', text: 'لا توجد إشعارات مجدولة.' })); return; }
        const wrap = el('div', { class: 'table-wrap' });
        const table = el('table', { class: 'table' });
        table.innerHTML = '<thead><tr><th>العنوان</th><th>الجمهور</th><th>الموعد</th><th>الحالة</th><th></th></tr></thead>';
        const tb = el('tbody');
        list.forEach((row) => {
          const cancel = el('button', { class: 'btn btn-sm btn-secondary', type: 'button', text: 'إلغاء',
            onclick: async () => {
              await api('/api/admin/push/scheduled/' + encodeURIComponent(row.id), { method: 'DELETE' });
              await refreshScheduled();
            } });
          tb.append(el('tr', null,
            el('td', { 'data-label': 'العنوان', html: esc(row.title) }),
            el('td', { 'data-label': 'الجمهور', text: String((row.segment && row.segment.mode) || 'all') }),
            el('td', { 'data-label': 'الموعد', text: fmtDate(row.scheduled_at) }),
            el('td', { 'data-label': 'الحالة', text: String(row.status) }),
            el('td', { class: 'cell-actions' }, row.status === 'pending' ? cancel : null),
          ));
        });
        table.append(tb); wrap.append(table); scheduledBody.append(wrap);
      } catch (e) { scheduledBody.textContent = e.message; }
    }
    async function refreshHistory() {
      historyBody.innerHTML = '<div class="hint">جارٍ التحميل…</div>';
      try {
        const r = await api('/api/admin/push/history');
        const list = r.history || [];
        historyBody.innerHTML = '';
        if (!list.length) { historyBody.append(el('div', { class: 'hint', text: 'لا توجد إشعارات بعد.' })); return; }
        const wrap = el('div', { class: 'table-wrap' });
        const table = el('table', { class: 'table' });
        table.innerHTML = '<thead><tr><th>الإشعار</th><th>التاريخ</th><th>المستهدفون</th><th>نجح</th><th>نقرات</th></tr></thead>';
        const tb = el('tbody');
        list.forEach((row) => tb.append(el('tr', null,
          el('td', { 'data-label': 'الإشعار', html: esc(row.title) }),
          el('td', { 'data-label': 'التاريخ', text: fmtDate(row.created_at) }),
          el('td', { 'data-label': 'المستهدفون', text: num(row.targeted) }),
          el('td', { 'data-label': 'نجح', text: num(row.success) }),
          el('td', { 'data-label': 'نقرات', text: num(row.clicks) }),
        )));
        table.append(tb); wrap.append(table); historyBody.append(wrap);
      } catch (e) { historyBody.textContent = e.message; }
    }

    host.append(form, scheduledPanel, historyPanel);
    await Promise.all([refreshScheduled(), refreshHistory()]);
  }

  /* ---------------------------------------------------------------------
     Analytics tab — Chart.js with a dependency-free SVG fallback
     --------------------------------------------------------------------- */
  function svgChart(series) {
    const w = 720, h = 220, pad = 28;
    const vals = series.map((d) => Number(d.sends || 0));
    const max = Math.max(1, ...vals);
    const bw = series.length ? (w - pad * 2) / series.length : 0;
    const bars = series.map((d, i) => {
      const bh = Math.max(2, (Number(d.sends || 0) / max) * (h - pad * 2));
      const x = pad + i * bw + bw * 0.15;
      const y = h - pad - bh;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="#f4c01f"></rect>`
        + `<text x="${(x + bw * 0.35).toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="10" fill="#888">${esc(String(d.day || '').slice(5))}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="220" role="img" aria-label="الإشعارات المرسلة يومياً"><line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="rgba(244,192,31,.35)"></line>${bars}</svg>`;
  }

  async function renderAnalytics(host) {
    host.innerHTML = '<div class="center-spinner"><div class="spinner"></div></div>';
    let data;
    try { data = (await api('/api/admin/push/analytics')).analytics; }
    catch (e) { host.innerHTML = ''; host.append(el('div', { class: 'hint', text: 'تعذّر تحميل الإحصائيات: ' + e.message })); return; }
    host.innerHTML = '';
    const p = data.push || {}, st = data.store || {};

    const kpis = el('div', { class: 'adv-kpis' },
      kpi('الأجهزة المسجّلة', p.registered_devices, p.unique_tokens + ' رمز فريد'),
      kpi('وافقوا على الإشعارات', p.opted_in, 'غير موافق: ' + num(p.opted_out)),
      kpi('نشطون آخر 7 أيام', p.active_7d, 'حسب آخر فتح للتطبيق'),
      kpi('إجمالي النقرات', p.total_clicks),
      kpi('تطبيقات المتجر', st.total_apps),
      kpi('تنزيلات التطبيقات', st.total_downloads, 'APK: ' + num(st.apk_downloads)),
      kpi('متوسط التقييم', st.avg_rating),
      kpi('المستخدمون ذوو الأجهزة', st.users_with_devices),
    );
    const chartPanel = panel('الإشعارات المرسلة يومياً (آخر 30 يوماً)', '▤');
    const chartHost = el('div', { class: 'adv-chart' });
    const series = data.daily_sends || [];
    if (!series.length) chartHost.append(el('div', { class: 'hint', text: 'لا توجد بيانات إرسال بعد.' }));
    else if (window.Chart) {
      const canvas = el('canvas', { height: '220' });
      chartHost.append(canvas);
      try {
        new window.Chart(canvas, {
          type: 'bar',
          data: {
            labels: series.map((d) => String(d.day).slice(5)),
            datasets: [
              { label: 'مرسلة', data: series.map((d) => Number(d.sends || 0)), backgroundColor: '#f4c01f' },
              { label: 'ناجحة', data: series.map((d) => Number(d.delivered || 0)), backgroundColor: '#4caf50' },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#bbb' } } },
            scales: { x: { ticks: { color: '#888' } }, y: { beginAtZero: true, ticks: { color: '#888' } } } },
        });
      } catch { chartHost.innerHTML = svgChart(series); }
    } else {
      // Chart.js CDN may be blocked (offline preview / CSP): graceful fallback.
      chartHost.innerHTML = svgChart(series);
      chartHost.append(el('div', { class: 'hint', text: 'رسم مدمج بدون مكتبة خارجية (Chart.js غير محمّل).' }));
    }
    chartPanel.append(chartHost);

    const cf = data.cloudflare || {};
    const cfPanel = panel('استهلاك Cloudflare (GraphQL Analytics)', '☁');
    if (!cf.configured) {
      cfPanel.append(el('div', { class: 'adv-note', text:
        'غير مفعّل — أضف السر CF_API_TOKEN في إعدادات Worker لتفعيل جلب الطلبات وعرض النطاق عبر GraphQL Analytics API.' }));
    } else if (cf.error) {
      cfPanel.append(el('div', { class: 'adv-note', text: 'تعذّر الجلب: ' + cf.error }));
    } else {
      cfPanel.append(el('div', { class: 'adv-kpis' },
        kpi('الطلبات (7 أيام)', cf.requests),
        kpi('عرض النطاق (بايت)', cf.bytes),
      ));
    }
    const fbPanel = panel('استهلاك Firebase (مسجّل في D1)', '◆');
    const fb = data.firebase_usage || [];
    if (!fb.length) fbPanel.append(el('div', { class: 'hint', text: 'لا توجد قراءات/كتابات مسجّلة بعد.' }));
    else {
      const wrap = el('div', { class: 'table-wrap' });
      const table = el('table', { class: 'table' });
      table.innerHTML = '<thead><tr><th>اليوم</th><th>قراءات</th><th>كتابات</th></tr></thead>';
      const tb = el('tbody');
      fb.forEach((r) => tb.append(el('tr', null,
        el('td', { 'data-label': 'اليوم', text: String(r.day) }),
        el('td', { 'data-label': 'قراءات', text: num(r.reads) }),
        el('td', { 'data-label': 'كتابات', text: num(r.writes) }))));
      table.append(tb); wrap.append(table); fbPanel.append(wrap);
    }

    host.append(
      el('div', { class: 'adv-refresh' },
        el('button', { class: 'btn btn-secondary btn-sm', type: 'button',
          onclick: () => renderAnalytics(host) }, 'تحديث')),
      kpis, chartPanel, cfPanel, fbPanel,
      el('div', { class: 'hint', text: 'آخر تحديث: ' + fmtDate(data.generated_at) }),
    );
  }

  window.GSAdminAdvanced = { renderPush, renderAnalytics };
})();
