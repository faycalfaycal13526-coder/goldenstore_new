// Standalone support chat — one full-screen conversation, no thread list.
// The account page only links here; the admin dashboard replies from its
// Support tab. Messages arrive by polling without in-app notifications.
(function () {
  'use strict';
  const S = window.Store;
  const C = window.GSChat;
  const { el, ico, t, toast, formatDate } = S;
  const root = document.getElementById('root');

  const PAGE_TITLE = 'دعم Golden Store — محادثة';
  const PAGE_DESC = 'تواصل مع فريق دعم Golden Store في محادثة مباشرة.';
  const CONTACT = 'دعم Golden Store';
  const CONTACT_SUB = 'فريق دعم المتجر';
  const SUBJECT = 'دعم Golden Store';
  const WELCOME = 'مرحباً بك في دعم Golden Store. اكتب رسالتك وسنرد عليك هنا.';
  const AUTO_NOTE = 'الرسائل تصل تلقائياً دون إعادة تحميل الصفحة.';

  document.title = t(PAGE_TITLE);
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = t(PAGE_DESC);

  function lang() { return (window.GSI18N && window.GSI18N.lang) || 'ar'; }
  function timeOf(ts) {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleTimeString(lang(), {
      hour: '2-digit', minute: '2-digit', numberingSystem: 'latn',
    });
  }
  function dayKey(ts) { return ts ? new Date(ts * 1000).toDateString() : ''; }
  function scrollBottom(node) {
    const go = () => { try { node.scrollTop = node.scrollHeight; } catch (e) {} };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(go);
    else go();
  }
  function autoGrow(node) {
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = Math.min(node.scrollHeight || 44, 120) + 'px';
  }

  let chatEl = null;
  let input = null;
  let sendBtn = null;
  let activeThread = null;
  let messages = [];
  let loading = false;
  let sending = false;
  let lastSignature = '';
  let lastReadSignature = '';
  let pollTimer = null;

  S.ready((user) => {
    if (!user) { S.goToLogin(); return; }
    renderShell();
    renderMessages('loading', true);
    load(false);
    pollTimer = window.setInterval(() => {
      if (!document.hidden) load(true);
    }, 10000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) load(true);
    });
    window.addEventListener('pagehide', () => {
      if (pollTimer) window.clearInterval(pollTimer);
    }, { once: true });
  });

  function renderShell() {
    root.textContent = '';

    const back = el('a', {
      class: 'wa-back', href: '/account',
      'aria-label': t('رجوع'), title: t('رجوع'),
    }, ico('chevronEnd', 'icon'));
    // The store logo replaces the generic chat avatar in the conversation header.
    const avatar = el('span', { class: 'wa-avatar', 'aria-hidden': 'true' });
    const avatarLogo = el('img', {
      src: '/images/logo.png', alt: '', class: 'wa-brand-logo',
      draggable: 'false', decoding: 'async',
    });
    avatarLogo.addEventListener('error', () => {
      avatarLogo.remove();
      avatar.append(ico('message', 'icon'));
    });
    avatar.append(avatarLogo);
    const langWrap = el('div', { class: 'wa-lang' });
    try {
      const sw = S.langSwitcherEl && S.langSwitcherEl();
      if (sw) langWrap.append(sw);
    } catch (e) {}

    const head = el('header', { class: 'wa-head' },
      back,
      avatar,
      el('div', { class: 'wa-head-info' },
        el('div', { class: 'wa-head-title' }, t(CONTACT)),
        el('div', { class: 'wa-head-sub' }, t(CONTACT_SUB))),
      langWrap,
    );

    chatEl = el('main', {
      class: 'wa-chat', 'aria-live': 'polite', 'aria-label': t('رسائل الدعم'),
    });

    input = el('textarea', {
      class: 'wa-input', rows: '1', maxlength: '2000',
      placeholder: t('اكتب رسالة…'), 'aria-label': t('رسالة جديدة'),
    });
    sendBtn = el('button', {
      class: 'wa-send', type: 'submit',
      'aria-label': t('إرسال'), title: t('إرسال'),
    }, ico('plane', 'icon'));
    const form = el('form', {
      class: 'wa-compose', onsubmit: (e) => { e.preventDefault(); send(); },
    },
      el('div', { class: 'wa-compose-main' },
        el('div', { class: 'wa-input-row' },
          el('div', { class: 'wa-input-wrap' }, input),
          sendBtn)),
    );

    root.append(head, chatEl, form);
    input.addEventListener('input', () => autoGrow(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    autoGrow(input);
  }

  function renderMessages(state, forceScroll) {
    if (!chatEl) return;
    const nearBottom = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 90;
    chatEl.textContent = '';

    if (state === 'loading') {
      chatEl.append(el('div', { class: 'wa-loading' }, t('جارٍ تحميل المحادثة…')));
      return;
    }
    if (state === 'error') {
      chatEl.append(el('div', { class: 'wa-error' }, t('تعذّر تحميل المحادثة')));
      return;
    }
    if (!activeThread || !messages.length) {
      chatEl.append(el('div', { class: 'wa-notice' }, t(WELCOME)));
    }

    let lastDay = '';
    messages.forEach((m) => {
      const dk = dayKey(m.created_at);
      if (dk && dk !== lastDay) {
        chatEl.append(el('div', { class: 'wa-day' }, formatDate(m.created_at)));
        lastDay = dk;
      }
      const out = m.sender !== 'admin';
      const bubbleKids = [];
      if (m.body) {
        const textEl = el('div', { class: 'wa-bubble-text', 'data-noi18n': '' });
        C.linkifyInto(textEl, m.body, { title: t('فتح الرابط') });
        bubbleKids.push(textEl);
      }
      bubbleKids.push(el('div', { class: 'wa-meta' },
        el('span', { class: 'wa-time' }, timeOf(m.created_at)),
        out ? el('span', { class: 'wa-ticks', 'aria-hidden': 'true' }, '✓✓') : null));
      chatEl.append(
        el('div', { class: 'wa-row ' + (out ? 'out' : 'in') },
          el('div', { class: 'wa-bubble ' + (out ? 'out' : 'in') }, bubbleKids)),
      );
    });
    chatEl.append(el('div', { class: 'wa-notice wa-notice-foot' }, t(AUTO_NOTE)));
    if (forceScroll || nearBottom) scrollBottom(chatEl);
  }

  async function load(silent, force) {
    if (!chatEl) return;
    if (loading && !force) return;
    loading = true;
    const first = !lastSignature;
    try {
      const data = await S.authedApi('/api/support/threads');
      const threads = Array.isArray(data && data.threads) ? data.threads : [];
      // One ongoing conversation: the newest open thread, or a fresh one.
      const next = threads.find((th) => th.status !== 'closed') || null;
      const list = next && Array.isArray(next.messages) ? next.messages : [];
      const signature = (next ? next.id + ':' + next.status : 'new') + '|'
        + list.map((m) => m.id + ':' + m.sender + ':' + m.created_at).join('|');
      activeThread = next;
      messages = list;
      const changed = signature !== lastSignature;
      lastSignature = signature;
      if (changed || force) renderMessages('ready', first || force);
      if (activeThread && list.some((m) => m.sender === 'admin')) markRead();
    } catch (err) {
      if (!silent) {
        renderMessages('error', true);
        toast(t('تعذّر تحميل المحادثة'), 'error');
      }
    } finally { loading = false; }
  }

  function markRead() {
    if (!activeThread) return;
    const last = messages[messages.length - 1];
    const sig = activeThread.id + ':' + messages.length + ':' + (last ? last.id : '');
    if (sig === lastReadSignature) return;
    lastReadSignature = sig;
    S.authedApi('/api/support/threads/' + encodeURIComponent(activeThread.id) + '/read',
      { method: 'POST' }).catch(() => {});
  }

  async function send() {
    if (sending || !input) return;
    const message = input.value.trim();
    if (message.length < 2) { input.focus(); return; }
    sending = true;
    sendBtn.disabled = true;
    sendBtn.classList.add('is-busy');
    try {
      if (activeThread) {
        await S.authedApi('/api/support/threads/' + encodeURIComponent(activeThread.id) + '/messages', {
          method: 'POST', body: { message },
        });
      } else {
        await S.authedApi('/api/support/threads', {
          method: 'POST', body: { subject: t(SUBJECT), message },
        });
      }
      input.value = '';
      autoGrow(input);
      await load(false, true);
      toast(t('تم إرسال الرسالة'), 'success');
    } catch (err) {
      toast(t('تعذّر إرسال الرسالة'), 'error');
    } finally {
      sending = false;
      sendBtn.disabled = false;
      sendBtn.classList.remove('is-busy');
    }
  }
})();
