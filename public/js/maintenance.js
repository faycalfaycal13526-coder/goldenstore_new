/* Standalone, app-like full-screen maintenance page for the WEBSITE.
   Uses the very same card, countdown, language switcher and Telegram button as
   the in-app screen; no store chrome is rendered behind it. */
(function () {
  'use strict';
  function tr(s) {
    try { return window.GSI18N && typeof window.GSI18N.t === 'function' ? window.GSI18N.t(s) : s; }
    catch (e) { return s; }
  }
  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor((sec % 3600) / 60)) + ':' + pad(sec % 60);
  }
  function endLabel(ts) {
    if (!ts) return '—';
    try { return new Date(ts * 1000).toLocaleString((window.GSI18N && window.GSI18N.lang) || 'ar', { numberingSystem: 'latn' }); }
    catch (e) { return String(ts); }
  }
  function build(meta) {
    var host = document.getElementById('gs-maint-root');
    if (!host) return;
    host.innerHTML = '';
    var card = node('div', 'gs-maintenance-card');
    var logo = node('div', 'gs-maintenance-logo');
    var img = document.createElement('img');
    img.setAttribute('src', '/images/logo.png');
    img.setAttribute('alt', 'Golden Store');
    img.setAttribute('draggable', 'false');
    logo.appendChild(img);
    card.appendChild(logo);

    var badge = node('div', 'gs-maintenance-badge');
    badge.appendChild(node('span', 'gs-maintenance-dot'));
    badge.appendChild(node('span', null, tr('صيانة مجدولة')));
    card.appendChild(badge);

    var title = node('h1', 'gs-maintenance-title', tr('المتجر تحت الصيانة'));
    title.id = 'gs-maintenance-title';
    card.appendChild(title);
    var msg = (window.GSSettings && window.GSSettings.get('maintenance_message', '')) ||
      tr('المتجر تحت الصيانة، نعود قريباً.');
    var desc = node('p', 'gs-maintenance-desc', msg);
    desc.id = 'gs-maintenance-desc';
    card.appendChild(desc);

    var box = node('div', 'gs-maintenance-clock');
    box.appendChild(node('span', 'gs-maintenance-clock-label', tr('الوقت المتبقي')));
    var cd = node('strong', 'gs-maintenance-countdown', '--:--:--');
    cd.setAttribute('dir', 'ltr');
    box.appendChild(cd);
    var endLine = node('span', 'gs-maintenance-end');
    endLine.appendChild(document.createTextNode(tr('ينتهي في') + ' '));
    var endValue = node('b', 'gs-maintenance-end-value', '');
    endLine.appendChild(endValue);
    box.appendChild(endLine);
    var track = node('div', 'gs-maintenance-track');
    track.appendChild(node('i', 'gs-maintenance-fill'));
    box.appendChild(track);
    card.appendChild(box);

    try {
      if (window.GSModalTools && typeof window.GSModalTools.extras === 'function') {
        card.appendChild(window.GSModalTools.extras());
      }
    } catch (e) {}
    card.appendChild(node('div', 'gs-maintenance-foot', tr('لا يمكن متابعة التصفح حتى انتهاء الصيانة')));
    host.appendChild(card);

    var endAt = Number(meta.maintenance_end_at || 0);
    var serverTime = Number(meta.server_time || 0);
    var fetched = Date.now();
    var expiryRequested = false;
    var total = Math.max(1, Number((window.GSSettings && window.GSSettings.get('maintenance_duration_minutes', 60)) || 60) * 60);
    function now() { return serverTime ? serverTime + (Date.now() - fetched) / 1000 : Date.now() / 1000; }
    function tick() {
      var rem = endAt > 0 ? endAt - now() : 0;
      cd.textContent = endAt > 0 ? clock(rem) : '--:--:--';
      endValue.textContent = endLabel(endAt);
      var bar = card.querySelector('.gs-maintenance-fill');
      if (bar) bar.style.width = Math.max(0, Math.min(100, (rem / total) * 100)) + '%';
      if (endAt > 0 && rem <= 0) {
        var foot = card.querySelector('.gs-maintenance-foot');
        if (foot) foot.textContent = tr('انتهت الصيانة، نعود الآن…');
        if (expiryRequested) return;
        expiryRequested = true;
        window.GSSettings.refresh().then(function () {
          if (!window.GSSettings.maintenanceActive()) location.replace('/');
          else expiryRequested = false;
        }).catch(function () { expiryRequested = false; });
      }
    }
    tick();
    setInterval(tick, 1000);
    // Re-read settings on tab focus so the countdown never drifts.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') window.GSSettings.refresh().catch(function () {});
    });
  }
  function start() {
    if (!window.GSSettings || typeof window.GSSettings.ready !== 'function') return;
    window.GSSettings.ready().then(function () {
      if (!window.GSSettings.maintenanceActive()) { location.replace('/'); return; }
      build(window.GSSettings.meta() || {});
    }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
