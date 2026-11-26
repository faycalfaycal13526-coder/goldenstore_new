// Goldenstore i18n — Arabic source plus English, French, Spanish, Turkish,
// German, Portuguese, Russian, Hindi, and Chinese.
// Curated UI strings are instant; other content is translated via /api/translate
// and cached per language.
(function () {
  'use strict';

  var LANGS = [
    { code: 'ar', label: 'العربية', dir: 'rtl' },
    { code: 'en', label: 'English', dir: 'ltr' },
    { code: 'fr', label: 'Français', dir: 'ltr' },
    { code: 'es', label: 'Español', dir: 'ltr' },
    { code: 'tr', label: 'Türkçe', dir: 'ltr' },
    { code: 'de', label: 'Deutsch', dir: 'ltr' },
    { code: 'pt', label: 'Português', dir: 'ltr' },
    { code: 'ru', label: 'Русский', dir: 'ltr' },
    { code: 'hi', label: 'हिन्दी', dir: 'ltr' },
    { code: 'zh', label: '中文', dir: 'ltr' },
  ];

  function readLang() {
    try { var l = localStorage.getItem('gs_lang'); } catch (e) { l = null; }
    if (LANGS.some(function (x) { return x.code === l; })) return l;
    try { if (l) localStorage.setItem('gs_lang', 'ar'); } catch (e) {}
    return 'ar';
  }
  var lang = readLang();
  var dir = lang === 'ar' ? 'rtl' : 'ltr';
  // Non-Arabic readers need the dictionary; Arabic readers never do.
  document.documentElement.lang = lang;
  document.documentElement.dir = dir;
  // A non-Arabic session needs the external dictionary; start it now, in
  // parallel with everything else, instead of waiting for the first miss.
  if (lang !== 'ar') { try { setTimeout(function () { loadDict(); }, 0); } catch (e) {} }

  // ---- App & game names ------------------------------------------------------
  // Keyed by the canonical name stored in the database (English most of the
  // time, Arabic for a few). Brand names stay untouched in every language;
  // only descriptive titles are localised. Unknown names fall back to the
  // stored name, so a new app is never broken by a missing entry.
  // App / game names in every language. Branded titles keep their official
  // spelling (Google Play does the same); Arabic-stored titles get their real
  // name, and descriptive titles are translated. Anything published later falls
  // back to the content engine, so a new app is never left untranslated.
  var APP_NAMES = {
    // Arabic-stored titles keep their Arabic name for Arabic readers.
    'Aite': { ar: 'Aite', en: 'Aite', fr: 'Aite', es: 'Aite', tr: 'Aite', de: 'Aite', pt: 'Aite', ru: 'Aite', hi: 'Aite', zh: 'Aite' },
    'The Walking Zombie': { ar: 'The Walking Zombie', en: 'The Walking Zombie', fr: 'The Walking Zombie', es: 'The Walking Zombie', tr: 'The Walking Zombie', de: 'The Walking Zombie', pt: 'The Walking Zombie', ru: 'The Walking Zombie', hi: 'The Walking Zombie', zh: 'The Walking Zombie' },
    'Jurassic World™: The Game': { ar: 'Jurassic World™: The Game', en: 'Jurassic World™: The Game', fr: 'Jurassic World™: The Game', es: 'Jurassic World™: The Game', tr: 'Jurassic World™: The Game', de: 'Jurassic World™: The Game', pt: 'Jurassic World™: The Game', ru: 'Jurassic World™: The Game', hi: 'Jurassic World™: The Game', zh: 'Jurassic World™: The Game' },
    'Dynamons World': { ar: 'Dynamons World', en: 'Dynamons World', fr: 'Dynamons World', es: 'Dynamons World', tr: 'Dynamons World', de: 'Dynamons World', pt: 'Dynamons World', ru: 'Dynamons World', hi: 'Dynamons World', zh: 'Dynamons World' },
    'Good pizza, great pizza': { ar: 'Good Pizza, Great Pizza', en: 'Good Pizza, Great Pizza', fr: 'Good Pizza, Great Pizza', es: 'Good Pizza, Great Pizza', tr: 'Good Pizza, Great Pizza', de: 'Good Pizza, Great Pizza', pt: 'Good Pizza, Great Pizza', ru: 'Good Pizza, Great Pizza', hi: 'Good Pizza, Great Pizza', zh: 'Good Pizza, Great Pizza' },
    'Stick War: Saga': { ar: 'Stick War: Saga', en: 'Stick War: Saga', fr: 'Stick War: Saga', es: 'Stick War: Saga', tr: 'Stick War: Saga', de: 'Stick War: Saga', pt: 'Stick War: Saga', ru: 'Stick War: Saga', hi: 'Stick War: Saga', zh: 'Stick War: Saga' },
    'Hole.io - Original Hole Game': { ar: 'Hole.io - Original Hole Game', en: 'Hole.io - Original Hole Game', fr: 'Hole.io - Original Hole Game', es: 'Hole.io - Original Hole Game', tr: 'Hole.io - Original Hole Game', de: 'Hole.io - Original Hole Game', pt: 'Hole.io - Original Hole Game', ru: 'Hole.io - Original Hole Game', hi: 'Hole.io - Original Hole Game', zh: 'Hole.io - Original Hole Game' },
    'Firefight': { ar: 'Firefight', en: 'Firefight', fr: 'Firefight', es: 'Firefight', tr: 'Firefight', de: 'Firefight', pt: 'Firefight', ru: 'Firefight', hi: 'Firefight', zh: 'Firefight' },
    'Roblox': { ar: 'Roblox', en: 'Roblox', fr: 'Roblox', es: 'Roblox', tr: 'Roblox', de: 'Roblox', pt: 'Roblox', ru: 'Roblox', hi: 'Roblox', zh: 'Roblox' },
    // Stored in Arabic, shown as its real brand name elsewhere.
    'ماين كرافت': { ar: 'ماين كرافت', en: 'Minecraft', fr: 'Minecraft', es: 'Minecraft', tr: 'Minecraft', de: 'Minecraft', pt: 'Minecraft', ru: 'Minecraft', hi: 'Minecraft', zh: 'Minecraft' },
    'Netflix': { ar: 'Netflix', en: 'Netflix', fr: 'Netflix', es: 'Netflix', tr: 'Netflix', de: 'Netflix', pt: 'Netflix', ru: 'Netflix', hi: 'Netflix', zh: 'Netflix' },
    'KineMaster': { ar: 'KineMaster', en: 'KineMaster', fr: 'KineMaster', es: 'KineMaster', tr: 'KineMaster', de: 'KineMaster', pt: 'KineMaster', ru: 'KineMaster', hi: 'KineMaster', zh: 'KineMaster' },
    'Film Maker Pro': { ar: 'Film Maker Pro', en: 'Film Maker Pro', fr: 'Film Maker Pro', es: 'Film Maker Pro', tr: 'Film Maker Pro', de: 'Film Maker Pro', pt: 'Film Maker Pro', ru: 'Film Maker Pro', hi: 'Film Maker Pro', zh: 'Film Maker Pro' },
    'Alight Motion': { ar: 'Alight Motion', en: 'Alight Motion', fr: 'Alight Motion', es: 'Alight Motion', tr: 'Alight Motion', de: 'Alight Motion', pt: 'Alight Motion', ru: 'Alight Motion', hi: 'Alight Motion', zh: 'Alight Motion' },
    'Snake.io': { ar: 'Snake.io', en: 'Snake.io', fr: 'Snake.io', es: 'Snake.io', tr: 'Snake.io', de: 'Snake.io', pt: 'Snake.io', ru: 'Snake.io', hi: 'Snake.io', zh: 'Snake.io' },
    'Subway Surfers': { ar: 'Subway Surfers', en: 'Subway Surfers', fr: 'Subway Surfers', es: 'Subway Surfers', tr: 'Subway Surfers', de: 'Subway Surfers', pt: 'Subway Surfers', ru: 'Subway Surfers', hi: 'Subway Surfers', zh: 'Subway Surfers' },
    '8 Ball Pool': { ar: '8 Ball Pool', en: '8 Ball Pool', fr: '8 Ball Pool', es: '8 Ball Pool', tr: '8 Ball Pool', de: '8 Ball Pool', pt: '8 Ball Pool', ru: '8 Ball Pool', hi: '8 Ball Pool', zh: '8 Ball Pool' },
    'Spotify': { ar: 'Spotify', en: 'Spotify', fr: 'Spotify', es: 'Spotify', tr: 'Spotify', de: 'Spotify', pt: 'Spotify', ru: 'Spotify', hi: 'Spotify', zh: 'Spotify' },
    'NetShort': { ar: 'NetShort', en: 'NetShort', fr: 'NetShort', es: 'NetShort', tr: 'NetShort', de: 'NetShort', pt: 'NetShort', ru: 'NetShort', hi: 'NetShort', zh: 'NetShort' },
    'Drama Box': { ar: 'Drama Box', en: 'Drama Box', fr: 'Drama Box', es: 'Drama Box', tr: 'Drama Box', de: 'Drama Box', pt: 'Drama Box', ru: 'Drama Box', hi: 'Drama Box', zh: 'Drama Box' },
    'Truecaller': { ar: 'Truecaller', en: 'Truecaller', fr: 'Truecaller', es: 'Truecaller', tr: 'Truecaller', de: 'Truecaller', pt: 'Truecaller', ru: 'Truecaller', hi: 'Truecaller', zh: 'Truecaller' },
    'CamScanner': { ar: 'CamScanner', en: 'CamScanner', fr: 'CamScanner', es: 'CamScanner', tr: 'CamScanner', de: 'CamScanner', pt: 'CamScanner', ru: 'CamScanner', hi: 'CamScanner', zh: 'CamScanner' },
    'VN Video Editor': { ar: 'VN Video Editor', en: 'VN Video Editor', fr: 'VN Video Editor', es: 'VN Video Editor', tr: 'VN Video Editor', de: 'VN Video Editor', pt: 'VN Video Editor', ru: 'VN Video Editor', hi: 'VN Video Editor', zh: 'VN Video Editor' },
    'PhotoRoom': { ar: 'PhotoRoom', en: 'PhotoRoom', fr: 'PhotoRoom', es: 'PhotoRoom', tr: 'PhotoRoom', de: 'PhotoRoom', pt: 'PhotoRoom', ru: 'PhotoRoom', hi: 'PhotoRoom', zh: 'PhotoRoom' },
    'Duolingo': { ar: 'Duolingo', en: 'Duolingo', fr: 'Duolingo', es: 'Duolingo', tr: 'Duolingo', de: 'Duolingo', pt: 'Duolingo', ru: 'Duolingo', hi: 'Duolingo', zh: 'Duolingo' },
    'Picsart': { ar: 'Picsart', en: 'Picsart', fr: 'Picsart', es: 'Picsart', tr: 'Picsart', de: 'Picsart', pt: 'Picsart', ru: 'Picsart', hi: 'Picsart', zh: 'Picsart' },
    // Stored in Arabic, shown as its real brand name elsewhere.
    'كاب كات': { ar: 'كاب كات', en: 'CapCut', fr: 'CapCut', es: 'CapCut', tr: 'CapCut', de: 'CapCut', pt: 'CapCut', ru: 'CapCut', hi: 'CapCut', zh: 'CapCut' },
    // A generic English title gets a real translated name everywhere.
    'Speed test': { ar: 'اختبار السرعة', en: 'Speed Test', fr: 'Test de vitesse', es: 'Prueba de velocidad', tr: 'Hız testi', de: 'Geschwindigkeitstest', pt: 'Teste de velocidade', ru: 'Тест скорости', hi: 'गति परीक्षण', zh: '速度测试' },
  };
  // Normalise a stored name (Blogger/APK metadata often carries an RTL mark).
  function nameKey(n) {
    return String(n || '').replace(/[\u200e\u200f\u061c]/g, '').trim();
  }
  // A translation is only believable when it is not a stub. A blocked provider
  // once answered with a single letter ('e'), which was cached and repainted
  // every app name as «e». Reject that shape here too before it reaches a DOM.
  function saneTranslation(src, out) {
    var s0 = String(src == null ? '' : src).trim();
    var o0 = String(out == null ? '' : out).trim();
    if (!o0) return '';
    if (o0 === s0) return '';
    if (o0.length <= 2 && s0.length > 3) return '';
    return o0;
  }
  function appName(name) {
    var raw = String(name || '');
    if (!raw) return '';
    var hit = APP_NAMES[nameKey(raw)];
    if (hit && hit[lang]) {
      // keep any trailing RTL mark the store put there for mixed-direction text
      return hit[lang] + (/[\u200f]$/.test(raw) ? '\u200f' : '');
    }
    // Not curated yet: every title is translated too, through the content cache.
    if (lang !== 'ar') {
      var auto = saneTranslation(raw.trim(), contentOut(raw.trim()));
      if (auto) return auto + (/[\u200f]$/.test(raw) ? '\u200f' : '');
    }
    // Always fall back to the name as stored — never to a stub.
    return raw;
  }
  // Fill [data-i18n-app] holders after a render or a language switch.
  function applyAppNames(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (!scope.querySelectorAll) return;
    var list = scope.querySelectorAll('[data-i18n-app]');
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var src = e.getAttribute('data-i18n-app') || '';
      if (!src) continue;
      var out = appName(src);
      if (e.textContent !== out) e.textContent = out;
    }
  }

  // ---- Store content (app/game names, descriptions, developer lines, reviews) ----
  // Written in English or Arabic by the publishers, so it is translated on
  // demand and cached in two places: localStorage per language (instant on the
  // next visit) and the server's i18n_cache (shared by every visitor).
  var CONTENT_ATTRS = ['data-i18n-content', 'data-i18n-desc', 'data-i18n-dev', 'data-i18n-app'];
  var cKey = 'gs_cx1_' + lang;
  var CC = {};
  try { CC = JSON.parse(localStorage.getItem(cKey) || '{}') || {}; } catch (e) { CC = {}; }
  var cDirty = false;
  var cPending = {};
  var cWork = {};
  var cTimer = null;
  var cAbsent = {};

  function cNorm(t) { return String(t == null ? '' : t).replace(/[\u200e\u200f\u061c]/g, '').replace(/\s+/g, ' ').trim(); }
  // Arabic content is translated from Arabic, English content from English.
  function cSource(t) { return /[\u0600-\u06FF]/.test(t) ? 'ar' : 'en'; }

  function contentOut(t) {
    var k = cNorm(t);
    if (!k || k.length < 2) return null;
    if (CC[k] != null) return CC[k];
    // Shipped table: the catalogue is pre-translated, so it paints instantly.
    var T = window.GS_CONTENT;
    if (T && T[k] && T[k][lang]) return T[k][lang];
    // Unknown strings are queued in small batches instead of one request each.
    cWork[k] = true;
    if (cTimer) clearTimeout(cTimer);
    cTimer = setTimeout(function () { cTimer = null; flushContent(); }, 380);
    return null;
  }

  function saveContent() {
    if (!cDirty) return;
    try { localStorage.setItem(cKey, JSON.stringify(CC)); cDirty = false; } catch (e) {}
  }
  setInterval(saveContent, 3000);
  window.addEventListener('beforeunload', saveContent);

  function flushContent() {
    var keys = Object.keys(cWork);
    cWork = {};
    var todo = keys.filter(function (k) { return CC[k] == null && !cAbsent[k] && k.length <= 1200; });
    if (!todo.length) return;
    var payload = {}, src = 'en';
    todo.forEach(function (k) {
      payload[lang + '::' + k] = 1;
      if (cSource(k) === 'ar') src = 'ar';
    });
    // Mixed pages (Arabic sourced names next to English ones) are split, so a
    // single request never tells the provider the wrong source language.
    var arKeys = todo.filter(function (k) { return cSource(k) === 'ar'; });
    var enKeys = todo.filter(function (k) { return cSource(k) === 'en'; });
    var groups = [];
    if (arKeys.length) groups.push({ src: 'ar', keys: arKeys });
    if (enKeys.length) groups.push({ src: 'en', keys: enKeys });
    if (!groups.length) return;
    groups.forEach(function (g) {
      var map = {};
      g.keys.forEach(function (k) { map[lang + '::' + k] = 1; });
      // Inside the installed app a relative URL resolves against the WebView's
      // own origin (https://localhost), which has no server — the request died
      // before reaching the Worker, so on-demand translations never arrived.
      fetch(i18nContentUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: map, source: g.src }),
      }).then(function (r) { return r.json(); }).then(function (data) {
        var t = (data && data.t) || {};
        var got = 0;
        g.keys.forEach(function (k) {
          var v = t[lang + '::' + k];
          if (typeof v === 'string' && v && cNorm(v) !== k) { CC[k] = v; got++; }
          // Nothing translated: stop asking for 10 minutes, then retry.
          else if (!cAbsent[k]) { cAbsent[k] = Date.now() + 10 * 60 * 1000; setTimeout(function () { delete cAbsent[k]; }, 10 * 60 * 1000); }
        });
        if (got) { cDirty = true; saveContent(); repaintContent(); }
      }).catch(function () {});
    });
  }

  /* Absolute API base for the installed app. The Android WebView exposes
     GSAndroid and may not inject Capacitor's runtime, so both are checked —
     same rule as isNativeShell() in store.js. The website keeps same-origin. */
  var NATIVE_API_ORIGIN = 'https://goldenstore-api.faycalfaycal13526.workers.dev';
  function i18nContentUrl() {
    var native = false;
    try {
      if (window.GSAndroid) native = true;
      else if (window.Capacitor && (window.Capacitor.isNative === true
        || (typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()))) native = true;
      else if (String(location.protocol) === 'capacitor:' || String(location.protocol) === 'file:') native = true;
    } catch (e) {}
    return (native ? NATIVE_API_ORIGIN : '') + '/api/i18n-content';
  }

  // Replace the text of every holder whose source string is now translated.
  function repaintContent(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (!scope.querySelectorAll) return;
    for (var a = 0; a < CONTENT_ATTRS.length; a++) {
      var list = scope.querySelectorAll('[' + CONTENT_ATTRS[a] + ']');
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        var src = e.getAttribute(CONTENT_ATTRS[a]) || '';
        if (!src) continue;
        var out = saneTranslation(src, contentOut(src));
        if (!out) continue;
        if (e.textContent !== out) { applying = true; try { e.textContent = out; } finally { applying = false; } }
      }
    }
    applyAppNames(scope);
  }

  // Mark text so it is retranslated when the language changes.
  function markContent(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (!scope.querySelectorAll) return;
    for (var a = 0; a < CONTENT_ATTRS.length; a++) {
      var list = scope.querySelectorAll('[' + CONTENT_ATTRS[a] + ']');
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        var src = e.getAttribute(CONTENT_ATTRS[a]) || '';
        if (!src) continue;
        var out = saneTranslation(src, contentOut(src));
        if (out && e.textContent !== out) {
          applying = true; try { e.textContent = out; } finally { applying = false; }
        } else if (out == null) contentOut(src);
      }
    }
    applyAppNames(scope);
  }

  // ---- Curated overrides: exact Arabic text -> per-language translation. ----
  // Used for short UI terms where machine translation is ambiguous/risky.
  /* The dictionary is a separate file (lang-dict.js) and is fetched only
     when a non-Arabic UI is actually shown. Before it arrives, `known()`
     simply misses and Arabic source text is shown — which is what an
     Arabic reader sees anyway. */
  var O = {};
  function adoptDict(d) { if (d && typeof d === "object") { O = d; rebuildIndexes(); } }
;

  // Number/size unit labels per language.
  var UNITS = {
    bytes: {
      ar: ['ب', 'ك.ب', 'م.ب', 'ج.ب'],
      en: ['B', 'KB', 'MB', 'GB'],
      fr: ['o', 'Ko', 'Mo', 'Go'],
      es: ['B', 'KB', 'MB', 'GB'],
      tr: ['B', 'KB', 'MB', 'GB'],
      de: ['B', 'KB', 'MB', 'GB'],
      pt: ['B', 'KB', 'MB', 'GB'],
      ru: ['Б', 'КБ', 'МБ', 'ГБ'],
      hi: ['बाइट', 'केबी', 'एमबी', 'जीबी'],
      zh: ['字节', 'KB', 'MB', 'GB'],
    },
    count: {
      ar: ['', 'ألف', 'مليون', 'مليار'],
      en: ['', 'K', 'M', 'B'],
      fr: ['', 'K', 'M', 'Md'],
      es: ['', 'K', 'M', 'MM'],
      tr: ['', 'B', 'Mn', 'Mr'],
      de: ['', 'Tsd.', 'Mio.', 'Mrd.'],
      pt: ['', 'mil', 'mi', 'bi'],
      ru: ['', 'тыс.', 'млн', 'млрд'],
      hi: ['', 'हज़ार', 'लाख', 'अरब'],
      zh: ['', '千', '百万', '十亿'],
    },
  };
  function units(kind) { var u = UNITS[kind]; return (u && (u[lang] || u.ar)) || []; }

  var AR = /[\u0600-\u06FF]/;
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, CODE: 1, PRE: 1 };

  // ---- translation cache (per-language, persisted) ----
  // v2: v1 cached unchanged Arabic results permanently (translation outage).
  // A fresh key lets every string be re-fetched now that failures are not cached.
  var cacheKey = 'gs_tr2_' + lang;
  var cache = {};
  try { cache = JSON.parse(localStorage.getItem(cacheKey) || '{}') || {}; } catch (e) { cache = {}; }
  var cacheDirty = false;
  function saveCache() {
    if (!cacheDirty) return;
    try { localStorage.setItem(cacheKey, JSON.stringify(cache)); cacheDirty = false; } catch (e) {}
  }
  setInterval(saveCache, 2000);
  window.addEventListener('beforeunload', saveCache);

  // Normalized override lookup (ignore Arabic diacritics / tatweel) so that
  // "الأعلى تقييماً" and "الأعلى تقييما" both resolve to the same entry.
  function norm(s) { return s.replace(/[\u064B-\u0652\u0670\u0640]/g, ''); }
  var ON = {};
  var LOOKUP = {};
  function rebuildIndexes() {
    ON = {};
    LOOKUP = {};
    Object.keys(O).forEach(function (k) {
      ON[norm(k)] = O[k];
      // Build a reverse lookup so dynamic values (like English category names)
      // can be mapped back to the Arabic source key and then translated.
      var vals = O[k];
      if (vals) {
        ['ar', 'en', 'fr', 'es', 'tr', 'de', 'pt', 'ru', 'hi', 'zh'].forEach(function (l) {
          var v = vals[l] || (l === 'ar' ? k : '');
          if (!v) return;
          var key = v.toLowerCase().trim();
          if (key && !LOOKUP[key]) LOOKUP[key] = k;
        });
      }
    });
  }
  rebuildIndexes();

  /* ── The dictionary arrives only when it is needed ─────────────────────────
   * It is 465 KB of Arabic→9-languages UI strings. Shipping it inside lang.js
   * meant every visitor — including the Arabic majority, who never use a single
   * entry of it — downloaded and parsed all of it before the first paint:
   * 8.9 s on a 400 kbps line, measured. Now it is one small extra request, made
   * only when the chosen UI language is not Arabic (or when a translation is
   * actually asked for), and it is cached for a week like every other asset. */
  var dictLoading = null;
  function loadDict() {
    if (dictLoading) return dictLoading;
    if (Object.keys(O).length) return Promise.resolve(O);
    var src = document.currentScript && document.currentScript.src;
    var base = '/js/lang-dict.js';
    try { if (src) base = new URL('lang-dict.js', src).href; } catch (e) {}
    dictLoading = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = base + (/\?/.test(base) ? '&' : '?') + 'v=' + (window.__gsAssetVersion || '');
      s.async = true;
      s.onload = function () { adoptDict(window.GS_DICT); resolve(O); };
      s.onerror = function () { resolve(O); };
      document.head.appendChild(s);
    });
    return dictLoading;
  }
  window.__gsLoadDict = loadDict;
  // Exposed so a test (or a server-rendered page) can hand the dictionary over
  // directly, without waiting for a script tag to load.
  window.__gsAdoptDict = adoptDict;
  function lookup(text) {
    return LOOKUP[(text || '').toString().toLowerCase().trim()] || null;
  }

  function known(core) {
    var ov = ON[norm(core)];
    if (ov && ov[lang]) return ov[lang];
    if (cache[core] != null) return cache[core];
    // Not loaded yet? Fetch it once and repaint; Arabic needs nothing.
    if (lang !== 'ar' && !Object.keys(O).length) {
      loadDict().then(function () { try { repaintAll(); } catch (e) {} });
    }
    return null;
  }
  // Every element that asked for a translation before the dictionary landed.
  function repaintAll() {
    try { if (typeof walk === 'function') walk(document.body); } catch (e) {}
  }

  // pending: core text -> list of apply callbacks
  var pending = {};
  var pendingKeys = [];
  var scheduled = false;
  var applying = false;

  // Short negative cache: avoid hammering the translation endpoint for strings
  // the provider could not translate, while still retrying 10 minutes later.
  var failedUntil = {};
  function queue(core, applyFn) {
    if (failedUntil[core] && failedUntil[core] > Date.now()) return;
    if (!pending[core]) { pending[core] = []; pendingKeys.push(core); }
    pending[core].push(applyFn);
    if (!scheduled) { scheduled = true; setTimeout(flush, 80); }
  }

  function flush() {
    scheduled = false;
    var keys = pendingKeys, map = pending;
    pendingKeys = []; pending = {};
    if (!keys.length) return;
    var todo = keys.filter(function (k) { return cache[k] == null; });
    var applyAll = function () {
      keys.forEach(function (core) {
        var v = known(core);
        if (v == null) return;
        map[core].forEach(function (fn) { applying = true; try { fn(v); } finally { applying = false; } });
      });
    };
    if (!todo.length) { applyAll(); return; }
    fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: lang, q: todo }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      var t = (data && data.t) || [];
      todo.forEach(function (core, i) {
        var v = t[i];
        // Only cache a REAL translation. Caching an unchanged (still Arabic)
        // string permanently blocks retries once the service recovers.
        if (typeof v === 'string' && v && v !== core) { cache[core] = v; cacheDirty = true; }
        else failedUntil[core] = Date.now() + 10 * 60 * 1000;
      });
      applyAll();
      saveCache();
    }).catch(function () { applyAll(); });
  }

  // Replace the meaningful (trimmed) part of a string, preserving surrounding whitespace.
  function reflow(raw, translated) {
    var core = raw.trim();
    if (!core) return raw;
    var idx = raw.indexOf(core);
    return raw.slice(0, idx) + translated + raw.slice(idx + core.length);
  }

  function doTextNode(node) {
    var raw = node.nodeValue;
    if (!raw || !AR.test(raw)) return;
    var core = raw.trim();
    if (!core) return;
    var hit = known(core);
    if (hit != null) {
      var out = reflow(raw, hit);
      if (out !== node.nodeValue) { applying = true; node.nodeValue = out; applying = false; }
      return;
    }
    queue(core, function (v) {
      // re-read raw in case the node text changed meanwhile
      var cur = node.nodeValue;
      if (cur && AR.test(cur)) node.nodeValue = reflow(cur, v);
    });
  }

  function doAttr(elm, attr) {
    if (!elm.getAttribute) return;
    var raw = elm.getAttribute(attr);
    if (!raw || !AR.test(raw)) return;
    var core = raw.trim();
    if (!core) return;
    var hit = known(core);
    if (hit != null) { applying = true; elm.setAttribute(attr, reflow(raw, hit)); applying = false; return; }
    queue(core, function (v) { applying = true; elm.setAttribute(attr, reflow(raw, v)); applying = false; });
  }

  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  function walk(root) {
    if (lang === 'ar' || !root) return;
    if (root.nodeType === 3) { doTextNode(root); return; }
    if (root.nodeType !== 1) return;
    if (root.closest && root.closest('[data-noi18n]')) return;

    var CONTENT_SEL = '[data-i18n-app],[data-i18n-desc],[data-i18n-dev]';
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        // Names, descriptions and developer lines belong to the content engine:
        // they are English too, so the Arabic-only walker must not fight it.
        if (p && p.nodeType === 1 && p.closest && p.closest(CONTENT_SEL)) return NodeFilter.FILTER_REJECT;
        if (!AR.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        while (p && p.nodeType === 1) {
          if (SKIP_TAGS[p.tagName] || (p.hasAttribute && p.hasAttribute('data-noi18n'))) return NodeFilter.FILTER_REJECT;
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var nodes = [], cur;
    while ((cur = tw.nextNode())) nodes.push(cur);
    nodes.forEach(doTextNode);

    var elems = [root];
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) elems.push(all[i]);
    elems.forEach(function (e) {
      if (e.closest && e.closest('[data-noi18n]')) return;
      for (var a = 0; a < ATTRS.length; a++) if (e.hasAttribute && e.hasAttribute(ATTRS[a])) doAttr(e, ATTRS[a]);
    });
  }

  var observer = new MutationObserver(function (muts) {
    if (applying || lang === 'ar') return;
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === 'characterData') { doTextNode(m.target); }
      else if (m.addedNodes) {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType === 1) { walk(n); markContent(n); }
          else if (n.nodeType === 3) doTextNode(n);
        }
      }
    }
  });

  function start() {
    applyAppNames(document);
    // Content (names/descriptions) is painted from the local cache first, then
    // anything still missing is requested in one batch.
    markContent(document);
    if (lang !== 'ar') flushContent();
    if (lang === 'ar') return;
    walk(document.body);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    if (document.title && AR.test(document.title)) {
      var ttl = document.title, core = ttl.trim();
      var hit = known(core);
      if (hit != null) document.title = reflow(ttl, hit);
      else queue(core, function (v) { document.title = reflow(ttl, v); });
    }
  }

  function setLang(l) {
    if (!LANGS.some(function (x) { return x.code === l; }) || l === lang) return;
    try { localStorage.setItem('gs_lang', l); } catch (e) {}
    location.reload();
  }

  // Language switcher button (globe + menu). Self-contained DOM.
  function switcherEl() {
    var wrap = document.createElement('div');
    wrap.className = 'lang-switch';
    wrap.setAttribute('data-noi18n', '');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn lang-btn';
    btn.setAttribute('aria-label', t('اللغة'));
    btn.setAttribute('title', t('اللغة'));
    try { btn.appendChild(window.GSIcons.iconEl('globe', 'icon')); } catch (e) {}
    var code = document.createElement('span');
    code.className = 'lang-code';
    code.textContent = lang.toUpperCase();
    btn.appendChild(code);

    var menu = document.createElement('div');
    menu.className = 'lang-menu';
    LANGS.forEach(function (l) {
      var it = document.createElement('button');
      it.type = 'button';
      it.className = 'lang-item' + (l.code === lang ? ' on' : '');
      it.textContent = l.label;
      it.onclick = function () { setLang(l.code); };
      menu.appendChild(it);
    });

    btn.onclick = function (e) { e.stopPropagation(); wrap.classList.toggle('open'); };
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) wrap.classList.remove('open'); });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  }

  function t(arText) {
    if (lang === 'ar') return arText;
    var hit = known((arText || '').trim());
    return hit != null ? hit : arText;
  }

  window.GSI18N = {
    lang: lang,
    appName: appName,
    applyAppNames: applyAppNames,
    content: contentOut,
    contentAttrs: CONTENT_ATTRS,
    repaintContent: repaintContent,
    markContent: markContent,
    isRTL: dir === 'rtl',
    setLang: setLang,
    switcherEl: switcherEl,
    units: units,
    t: t,
    translate: walk,
    lookup: lookup,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
