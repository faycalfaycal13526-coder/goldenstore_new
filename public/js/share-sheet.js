/* =========================================================================
   Golden Store — Professional share sheet (2026-11-08)
   Dependency-free, lazily mounted (never present in the DOM until clicked),
   keyboard accessible, RTL-aware, and safe on every page.
   Exposes window.GSShare.open({ title, text, url, icon, kind }).
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

  var current = null;
  function close() {
    if (!current) return;
    document.removeEventListener('keydown', onKey);
    var el = current; current = null;
    el.classList.remove('is-open');
    try { setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 180); } catch (e) {}
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open(opts) {
    var o = opts || {};
    close();
    var url = safeUrl(o.url);
    var title = String(o.title || 'Golden Store');
    var text = String(o.text || '');
    var sheet = node('div', { class: 'gs-share-sheet', role: 'dialog',
      'aria-modal': 'true', 'aria-label': t('مشاركة') });

    var closeBtn = node('button', { class: 'icon-btn gs-share-close', type: 'button',
      'aria-label': t('إغلاق'), title: t('إغلاق'), onclick: close }, [ico('close')]);
    var head = node('div', { class: 'gs-share-head' }, [
      node('span', { class: 'gs-share-head-icon' }, [ico('share')]),
      node('div', { class: 'gs-share-head-text' }, [
        node('h2', { text: t('مشاركة') }),
        node('p', { text: t('اختر طريقة لمشاركة الرابط') }),
      ]),
      closeBtn,
    ]);

    var previewIcon;
    if (o.icon) {
      previewIcon = node('img', { class: 'gs-share-preview-icon', src: String(o.icon), alt: '' });
      previewIcon.addEventListener('error', function () { previewIcon.style.visibility = 'hidden'; });
    } else {
      previewIcon = node('span', { class: 'gs-share-preview-icon is-fallback' }, [ico(o.kind === 'game' ? 'gamepad' : 'package')]);
    }
    var preview = node('div', { class: 'gs-share-preview' }, [
      previewIcon,
      node('div', { class: 'gs-share-preview-text' }, [
        node('strong', { text: title }),
        node('span', { text: text || url }),
      ]),
    ]);

    var urlInput = node('input', { class: 'gs-share-url-input', type: 'text',
      readonly: 'readonly', value: url, 'aria-label': t('رابط المشاركة'), dir: 'ltr' });
    var copyBtn = node('button', { class: 'btn btn-secondary btn-sm gs-share-copy', type: 'button',
      onclick: function () { doCopy(copyBtn); } }, [ico('copy'), t('نسخ')]);
    var urlRow = node('div', { class: 'gs-share-url-row' }, [urlInput, copyBtn]);

    function doCopy(btn) {
      copyText(url).then(function (okCopy) {
        if (!okCopy) { toast(t('تعذّر نسخ الرابط'), 'error'); return; }
        toast(t('تم نسخ الرابط'), 'success');
        if (btn) {
          var old = btn.textContent;
          btn.textContent = t('تم النسخ');
          btn.classList.add('is-copied');
          setTimeout(function () { btn.textContent = old; btn.classList.remove('is-copied'); }, 1600);
        }
      });
    }

    var actions = node('div', { class: 'gs-share-actions' });
    if (navigator.share) {
      actions.appendChild(node('button', { class: 'btn btn-primary btn-block', type: 'button',
        onclick: function () {
          Promise.resolve(navigator.share({ title: title, text: text || title, url: url }))
            .then(function () { close(); })
            .catch(function (err) {
              if (err && err.name === 'AbortError') return;
              doCopy(null);
            });
        } }, [ico('share'), t('مشاركة عبر النظام')]));
    }
    actions.appendChild(node('button', { class: 'btn btn-secondary btn-block', type: 'button',
      onclick: function () { doCopy(copyBtn); } }, [ico('copy'), t('نسخ الرابط')]));
    actions.appendChild(node('a', { class: 'btn btn-secondary btn-block', href: url,
      target: '_blank', rel: 'noopener noreferrer' }, [ico('external'), t('فتح الرابط')]));

    var footer = node('p', { class: 'gs-share-foot' }, [
      t('الرابط عام وآمن، ويمكن مشاركته مع أي شخص.'),
    ]);

    sheet.appendChild(node('div', { class: 'gs-share-grip' }));
    sheet.appendChild(head);
    sheet.appendChild(preview);
    sheet.appendChild(node('label', { class: 'gs-share-label', text: t('رابط المشاركة') }));
    sheet.appendChild(urlRow);
    sheet.appendChild(actions);
    sheet.appendChild(footer);

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
