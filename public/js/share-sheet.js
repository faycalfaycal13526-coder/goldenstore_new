/* =========================================================================
   Golden Store — publish / share sheet (rebuilt)
   * Mounted only on click, never at page load (dependency-free).
   * Two clear lanes: instant destinations (WhatsApp, Telegram, Facebook, X,
     Email) and a compact link box with one copy button — no duplicated
     "copy link" buttons.
   * Works for an app/game AND for the store itself (`kind: 'store'`), which
     gets its own branded header, wording and logo tile.
   * RTL-aware, keyboard accessible, http(s)-only links.
   Exposes window.GSShare.open({ title, text, url, pageUrl, icon, kind }).
   ========================================================================= */
(function () {
  'use strict';
  function t(s) {
    try { return window.GSI18N && typeof window.GSI18N.t === 'function' ? window.GSI18N.t(s) : s; }
    catch (e) { return s; }
  }
  function ico(name, cls) {
    try {
      if (window.GSIcons && typeof window.GSIcons.iconEl === 'function') {
        return window.GSIcons.iconEl(name, cls || 'icon');
      }
    } catch (e) {}
    return document.createTextNode('');
  }
  function toast(msg, kind) {
    try {
      if (window.Store && typeof window.Store.toast === 'function') window.Store.toast(msg, kind || 'success');
      else if (window.GS && typeof window.GS.toast === 'function') window.GS.toast(msg, kind || 'success');
    } catch (e) {}
  }
  function node(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = String(v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k, String(v));
    });
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(c && c.nodeType ? c : document.createTextNode(String(c)));
    });
    return n;
  }
  function safeUrl(raw) {
    try {
      var u = new URL(String(raw || location.href), location.origin);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return location.origin + '/';
      return u.href;
    } catch (e) { return location.origin + '/'; }
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; })
        .catch(function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  /* Round 42d — «روابط النشر لا تعمل»: inside the Android WebView (the APK) a
     `target="_blank"` link or navigator.share does nothing at all, so every
     destination must go through the app bridge (or a deep link + same-window
     navigation, which WebViews always hand over to the OS). */
  function bridge() {
    return (window.GSAndroid && typeof window.GSAndroid === 'object') ? window.GSAndroid : null;
  }
  function isNative() {
    try { if (window.Store && typeof window.Store.isNativeApp === 'function' && window.Store.isNativeApp()) return true; } catch (e) {}
    return !!bridge();
  }
  function bridgeOpenExternal(href) {
    var b = bridge();
    if (!b) return false;
    var fns = ['openExternal', 'openUrl', 'openBrowser', 'openLink'];
    for (var i = 0; i < fns.length; i++) {
      try { if (typeof b[fns[i]] === 'function') { b[fns[i]](href); return true; } } catch (e) {}
    }
    return false;
  }
  function bridgeShare(text, url, title) {
    var b = bridge();
    if (!b) return false;
    var fns = ['shareText', 'share', 'shareUrl', 'shareLink'];
    for (var i = 0; i < fns.length; i++) {
      try {
        if (typeof b[fns[i]] === 'function') { b[fns[i]](text + '\n' + url, title || ''); return true; }
      } catch (e) {}
    }
    return false;
  }
  /* Deep links the phone opens directly — the only reliable route from a WebView. */
  function deepLink(net, url, text) {
    var u = encodeURIComponent(url);
    var body = encodeURIComponent(text + '\n' + url);
    if (net === 'wa') return 'whatsapp://send?text=' + body;
    if (net === 'tg') return 'tg://msg_url?url=' + u + '&text=' + encodeURIComponent(text);
    return '';
  }
  function openOutside(href) {
    if (bridgeOpenExternal(href)) return true;
    try { window.location.href = href; return true; } catch (e) { return false; }
  }

  var current = null;
  function close() {
    if (!current) return;
    document.removeEventListener('keydown', onKey);
    var el = current; current = null;
    el.classList.remove('is-open');
    try { setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 180); } catch (e) {}
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  /* Brand names are language-neutral, so they are intentionally NOT routed
     through the Arabic dictionary. */
  function destinations(url, text, title) {
    var u = encodeURIComponent(url);
    var body = encodeURIComponent(text + '\n' + url);
    return [
      { net: 'wa', label: 'WhatsApp', icon: '/images/share-whatsapp.svg', href: 'https://wa.me/?text=' + body },
      { net: 'tg', label: 'Telegram', icon: '/images/share-telegram.svg', href: 'https://t.me/share/url?url=' + u + '&text=' + encodeURIComponent(text) },
      { net: 'fb', label: 'Facebook', icon: '/images/share-facebook.svg', href: 'https://www.facebook.com/sharer/sharer.php?u=' + u },
      { net: 'x', label: 'X', icon: '/images/share-x.svg', href: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + u },
      { net: 'mail', label: 'Email', icon: '/images/share-email.svg', href: 'mailto:?subject=' + encodeURIComponent(title) + '&body=' + body },
    ];
  }

  function open(opts) {
    var o = opts || {};
    close();
    var url = safeUrl(o.url);                       // DOWNLOAD link
    var pageUrl = o.pageUrl ? safeUrl(o.pageUrl) : '';
    var isStore = o.kind === 'store';
    var title = String(o.title || 'Golden Store');
    var text = String(o.text || t('حمّل التطبيق الآن من Golden Store'));
    var kindLabel = isStore ? t('المتجر') : (o.kind === 'game' ? t('لعبة') : t('تطبيق'));

    var sheet = node('div', { class: 'gs-share-sheet', role: 'dialog',
      'aria-modal': 'true', 'aria-label': t('نشر ومشاركة') });

    /* ---- header: one line, no long paragraph ---- */
    var head = node('div', { class: 'gs-share-head' }, [
      node('div', { class: 'gs-share-head-text' }, [
        node('h2', { text: t('نشر ومشاركة') }),
        node('p', { text: isStore ? t('انشر المتجر مع أصدقائك') : t('شارك التطبيق مع أصدقائك') }),
      ]),
      node('button', { class: 'gs-share-close', type: 'button',
        'aria-label': t('إغلاق'), title: t('إغلاق'), onclick: close }, [ico('close')]),
    ]);

    /* ---- preview: small tile + name + one quiet line ---- */
    var previewIcon;
    if (o.icon) {
      previewIcon = node('img', { class: 'gs-share-preview-icon', src: String(o.icon), alt: '' });
      previewIcon.addEventListener('error', function () {
        previewIcon.style.visibility = 'hidden';
        previewIcon.parentNode.classList.add('is-fallback');
      });
    } else {
      previewIcon = node('span', { class: 'gs-share-preview-icon is-glyph' },
        [ico(isStore ? 'spark' : (o.kind === 'game' ? 'gamepad' : 'package'))]);
    }
    var preview = node('div', { class: 'gs-share-preview' + (isStore ? ' is-store' : '') }, [
      previewIcon,
      node('div', { class: 'gs-share-preview-text' }, [
        node('strong', { text: title }),
        node('span', { text: kindLabel + ' • Golden Store' }),
      ]),
    ]);

    /* ---- destinations: round brand tiles ---- */
    var targets = node('div', { class: 'gs-share-targets' });
    destinations(url, text, title).forEach(function (d) {
      var img = node('img', { class: 'gs-share-target-icon', src: d.icon,
        alt: '', width: '24', height: '24', loading: 'lazy' });
      img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
      var nativeNow = isNative();
      targets.appendChild(node('a', { class: 'gs-share-target', 'data-net': d.net,
        href: nativeNow ? (deepLink(d.net, url, text) || d.href) : d.href,
        target: nativeNow ? null : '_blank', rel: 'noopener noreferrer', title: d.label,
        'aria-label': d.label,
        onclick: function (ev) {
          if (!isNative()) return;                 // web: a normal new tab
          ev.preventDefault();
          var deep = deepLink(d.net, url, text);
          if (deep && bridgeOpenExternal(deep)) return;
          if (bridgeOpenExternal(d.href)) return;
          openOutside(deep || d.href);             // last resort: same window
        } },
        [node('span', { class: 'gs-share-target-art' }, [img]), node('span', { class: 'gs-share-target-name', text: d.label })]));
    });

    /* ---- one link box: field + icon copy button ---- */
    var urlInput = node('input', { class: 'gs-share-url-input', type: 'text',
      readonly: 'readonly', value: url, 'aria-label': t('رابط الصفحة'), dir: 'ltr' });
    var copyBtn = node('button', { class: 'gs-share-copy', type: 'button',
      'aria-label': t('نسخ الرابط'), title: t('نسخ الرابط'),
      onclick: function () { doCopy(url, copyBtn); } }, [ico('copy')]);
    var urlRow = node('div', { class: 'gs-share-url-row' }, [urlInput, copyBtn]);

    /* ---- the promotional text stays available, folded away ---- */
    var textArea = node('textarea', { class: 'gs-share-text', readonly: 'readonly',
      rows: '2', 'aria-label': t('نص المشاركة') });
    textArea.value = text + '\n' + url;
    var copyTextBtn = node('button', { class: 'gs-share-text-copy', type: 'button',
      onclick: function () { doCopy(text + '\n' + url, copyTextBtn); } },
      [ico('copy'), t('نسخ النص')]);
    var textFold = node('details', { class: 'gs-share-fold' }, [
      node('summary', null, [t('نص المشاركة')]),
      textArea,
      node('div', { class: 'gs-share-text-actions' }, [copyTextBtn]),
    ]);

    /* A failed/absent system share must still end with a working link in the
     clipboard — the old code refused to fall back here and the tap looked dead. */
  function copyQuietly(value) {
    copyText(value).then(function (okCopy) {
      if (okCopy) toast(t('تم نسخ الرابط'), 'success');
    });
  }

  function doCopy(value, btn) {
      copyText(value).then(function (okCopy) {
        if (!okCopy) { toast(t('تعذّر نسخ الرابط'), 'error'); return; }
        toast(t('تم نسخ الرابط'), 'success');
        if (btn) {
          btn.classList.add('is-copied');
          try { btn.setAttribute('data-done', t('تم النسخ')); } catch (e) {}
          setTimeout(function () { btn.classList.remove('is-copied'); btn.removeAttribute('data-done'); }, 1500);
        }
      });
    }

    /* ---- actions: native share first, then a plain look at the link ---- */
    var actions = node('div', { class: 'gs-share-actions' });
    var canSystemShare = !!navigator.share || isNative();
    if (canSystemShare) {
      actions.appendChild(node('button', { class: 'btn btn-primary btn-block', type: 'button',
        onclick: function () {
          if (navigator.share) {
            Promise.resolve(navigator.share({ title: title, text: text, url: url }))
              .then(function () { close(); })
              .catch(function (err) {
                if (err && err.name === 'AbortError') return;
                copyQuietly(url);
              });
            return;
          }
          /* Android WebView: hand the text to the app, or fall back to copying —
             never leave the tap doing nothing. */
          if (bridgeShare(text, url, title)) { close(); return; }
          copyQuietly(url);
        } }, [ico('share'), t('مشاركة عبر النظام')]));
    }
    if (pageUrl) {
      var nativePage = isNative();
      actions.appendChild(node('a', { class: 'btn btn-secondary', href: pageUrl,
        target: nativePage ? null : '_blank', rel: 'noopener noreferrer',
        onclick: function (ev) {
          if (!isNative()) return;
          ev.preventDefault();
          if (!bridgeOpenExternal(pageUrl)) openOutside(pageUrl);
        } }, [ico('external'), isStore ? t('فتح المتجر') : t('فتح صفحة التطبيق')]));
    }

    sheet.appendChild(node('div', { class: 'gs-share-grip' }));
    sheet.appendChild(head);
    sheet.appendChild(preview);
    sheet.appendChild(node('div', { class: 'gs-share-label', text: t('انشر عبر') }));
    sheet.appendChild(targets);
    /* Round 34: the box holds the APP PAGE link now (not the APK endpoint). */
    var linkLabel = isStore ? t('رابط المتجر') : (o.kind === 'game' ? t('رابط اللعبة') : t('رابط التطبيق'));
    sheet.appendChild(node('div', { class: 'gs-share-label', text: linkLabel }));
    sheet.appendChild(urlRow);
    sheet.appendChild(textFold);
    sheet.appendChild(actions);
    sheet.appendChild(node('p', { class: 'gs-share-foot' },
      [isStore ? t('رابط المتجر الرسمي، يعمل مع أي شخص.') : t('الرابط عام وآمن، ويمكن مشاركته مع أي شخص.')]));

    var overlay = node('div', { class: 'gs-share-overlay' }, [sheet]);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    current = overlay;
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(function () { overlay.classList.add('is-open'); });
    try { copyBtn.focus(); } catch (e) {}
    return overlay;
  }

  window.GSShare = { open: open, close: close, copy: copyText, safeUrl: safeUrl };
})();
