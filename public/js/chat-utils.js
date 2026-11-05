/* Shared support-chat helper: safe link detection only.
   Voice notes, images and camera uploads were removed from the chat.
   No HTML injection. */
(function () {
  'use strict';

  const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
  const TRAILING_PUNCT = /[.,;:!?)\]}\u060C\u061B\u061F]+$/;

  function normalizeLink(raw) {
    const text = String(raw || '').replace(TRAILING_PUNCT, '');
    const trailing = String(raw || '').slice(text.length);
    const candidate = /^www\./i.test(text) ? 'https://' + text : text;
    try {
      const u = new URL(candidate);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return { href: u.href, text, trailing };
    } catch (e) { return null; }
  }

  /** Append text + safe clickable links into an existing element. */
  function linkifyInto(container, text, opts) {
    const value = String(text || '');
    const options = opts || {};
    URL_RE.lastIndex = 0;
    let last = 0, m;
    while ((m = URL_RE.exec(value)) !== null) {
      container.append(document.createTextNode(value.slice(last, m.index)));
      const safe = normalizeLink(m[0]);
      if (safe) {
        const a = document.createElement('a');
        a.className = 'wa-link';
        a.href = safe.href;
        a.textContent = safe.text;
        a.target = '_blank';
        a.rel = 'noopener noreferrer nofollow';
        a.dir = 'ltr';
        a.setAttribute('data-noi18n', '');
        if (options.title) { a.title = options.title; a.setAttribute('aria-label', options.title); }
        container.append(a, document.createTextNode(safe.trailing));
      } else {
        container.append(document.createTextNode(m[0]));
      }
      last = m.index + m[0].length;
    }
    container.append(document.createTextNode(value.slice(last)));
  }

  window.GSChat = { linkifyInto };
})();
