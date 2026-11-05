/* Shared support-chat helpers: safe link detection, attachment rendering,
   image picking (gallery + camera) and voice-note recording. No HTML injection. */
(function () {
  'use strict';

  const MAX_ATTACHMENTS = 4;
  const MAX_ATTACHMENT_BYTES = 900 * 1024;
  const MAX_RECORD_SECONDS = 60;
  const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);
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

  function attachmentSrc(att, isAdmin) {
    const base = isAdmin ? '/api/admin/support/attachments/' : '/api/support/attachments/';
    return base + encodeURIComponent(att.id);
  }

  function renderAttachments(list, opts) {
    const o = opts || {};
    const el = o.el, ico = o.ico, t = o.t, isAdmin = !!o.isAdmin;
    const items = Array.isArray(list) ? list : [];
    return items.map((a) => {
      const src = attachmentSrc(a, isAdmin);
      if (a.kind === 'image') {
        return el('a', {
          class: 'wa-attachment-image-link', href: src, target: '_blank',
          rel: 'noopener noreferrer', title: t('فتح الصورة'),
          'aria-label': t('فتح الصورة'),
        }, el('img', {
          class: 'wa-attachment-image', src, alt: '', loading: 'lazy', draggable: 'false',
        }));
      }
      if (a.kind === 'audio') {
        return el('div', { class: 'wa-attachment-audio' },
          el('audio', {
            class: 'wa-attachment-player', controls: 'controls', preload: 'none', src,
          }, t('متصفحك لا يدعم تشغيل الصوت')),
          el('span', { class: 'wa-attachment-caption' },
            ico('mic', 'icon'), t('رسالة صوتية')));
      }
      return null;
    }).filter(Boolean);
  }

  function dataMime(dataUrl) {
    const m = /^data:([^,]+);base64,/.exec(String(dataUrl || ''));
    return m ? m[1] : 'application/octet-stream';
  }
  function dataUrlBytes(dataUrl) {
    const comma = String(dataUrl || '').indexOf(',');
    if (comma < 0) return 0;
    const b64 = String(dataUrl).slice(comma + 1).replace(/\s/g, '');
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(b64.length * 3 / 4) - padding);
  }
  function readAsDataURL(blob) {
    return new Promise((resolve, reject) => {
      if (typeof FileReader !== 'function') { reject(new Error('no_filereader')); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('read_failed'));
      reader.readAsDataURL(blob);
    });
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      let done = false;
      const timer = window.setTimeout(() => {
        if (!done) { done = true; reject(new Error('image_timeout')); }
      }, 400);
      img.onload = () => { if (!done) { done = true; window.clearTimeout(timer); resolve(img); } };
      img.onerror = () => { if (!done) { done = true; window.clearTimeout(timer); reject(new Error('image_error')); } };
      img.src = src;
    });
  }
  async function shrinkImage(original) {
    const mime = dataMime(original);
    if (mime.indexOf('image/gif') === 0) return original; // keep animation
    try {
      const img = await loadImage(original);
      const w0 = img.naturalWidth || img.width || 0;
      const h0 = img.naturalHeight || img.height || 0;
      if (!w0 || !h0) return original;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) return original;
      const scale = Math.min(1, 1280 / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * scale));
      const h = Math.max(1, Math.round(h0 * scale));
      canvas.width = w; canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      let out = canvas.toDataURL('image/jpeg', 0.82);
      if (dataUrlBytes(out) > MAX_ATTACHMENT_BYTES) out = canvas.toDataURL('image/jpeg', 0.6);
      return out || original;
    } catch (e) { return original; }
  }
  function validImage(file) {
    const type = String((file && file.type) || '').toLowerCase();
    const name = String((file && file.name) || '').toLowerCase();
    return IMAGE_MIMES.has(type) || (!type && /\.(png|jpe?g|gif|webp)$/.test(name));
  }
  function voiceName(mime) {
    if (mime.indexOf('mp4') >= 0 || mime.indexOf('aac') >= 0) return 'voice-' + Date.now() + '.m4a';
    if (mime.indexOf('ogg') >= 0) return 'voice-' + Date.now() + '.ogg';
    if (mime.indexOf('mpeg') >= 0 || mime.indexOf('wav') >= 0) return 'voice-' + Date.now() + '.mp3';
    return 'voice-' + Date.now() + '.webm';
  }
  function clock(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  /**
   * Build the attachment toolbar. Returns a controller with get/clear/destroy.
   * opts: { el, ico, t, toast, isAdmin, onChanged }
   */
  function createAttachmentComposer(opts) {
    const o = opts || {};
    const el = o.el, ico = o.ico, t = o.t, toast = o.toast || function () {};
    const onChanged = o.onChanged || function () {};
    let pending = [];
    let recorder = null, stream = null, timer = null;
    let seconds = 0, recording = false, cancelled = false, chunks = [];

    const preview = el('div', { class: 'wa-attach-preview' });
    const status = el('span', { class: 'wa-attach-status', 'aria-live': 'polite' });
    const offscreen = {
      position: 'absolute', left: '-9999px', width: '1px', height: '1px',
      opacity: '0', border: '0', padding: '0', margin: '0',
    };
    const galleryInput = el('input', {
      type: 'file', accept: 'image/*', multiple: 'multiple',
      class: 'wa-file-input', tabindex: '-1', 'aria-hidden': 'true', style: offscreen,
    });
    const cameraInput = el('input', {
      type: 'file', accept: 'image/*', capture: 'environment',
      class: 'wa-file-input', tabindex: '-1', 'aria-hidden': 'true', style: offscreen,
    });
    const galleryBtn = toolButton('image', t('إرسال صورة'), () => galleryInput.click());
    const cameraBtn = toolButton('camera', t('التقاط صورة'), () => cameraInput.click());
    const micBtn = toolButton('mic', t('تسجيل رسالة صوتية'), toggleRecording);
    const actions = el('div', { class: 'wa-compose-actions' }, galleryBtn, cameraBtn, micBtn, status);
    const node = el('div', { class: 'wa-attach-tools' }, actions, preview, galleryInput, cameraInput);

    function toolButton(icon, label, onclick) {
      return el('button', {
        class: 'wa-tool', type: 'button', title: label, 'aria-label': label, onclick,
      }, ico(icon, 'icon'));
    }
    function attachmentStatus() {
      if (pending.length === 1) return t('مرفق واحد جاهز');
      if (pending.length > 1) return pending.length + ' ' + t('مرفقات جاهزة');
      return '';
    }
    function refresh() {
      preview.textContent = '';
      pending.forEach((a, i) => {
        const thumb = a.kind === 'image'
          ? el('img', { class: 'wa-attach-thumb', src: a.data_url, alt: '', draggable: 'false' })
          : el('span', { class: 'wa-attach-thumb wa-attach-audio' }, ico('mic', 'icon'));
        preview.append(el('span', { class: 'wa-attach-chip', 'data-noi18n': '' },
          thumb,
          el('span', { class: 'wa-attach-name' }, a.name),
          el('button', {
            class: 'wa-attach-remove', type: 'button',
            'aria-label': t('إزالة المرفق'), title: t('إزالة المرفق'),
            onclick: () => { pending.splice(i, 1); refresh(); },
          }, ico('close', 'icon'))));
      });
      status.textContent = recording
        ? t('جارٍ التسجيل…') + ' ' + clock(seconds)
        : attachmentStatus();
      onChanged({ attachments: pending.slice(), recording });
    }
    function setMicUI(on) {
      recording = on;
      micBtn.classList.toggle('is-recording', on);
      micBtn.textContent = '';
      micBtn.append(ico(on ? 'stop' : 'mic', 'icon'));
      const label = on ? t('إيقاف التسجيل') : t('تسجيل رسالة صوتية');
      micBtn.setAttribute('aria-label', label);
      micBtn.setAttribute('title', label);
    }
    function stopTracks() {
      try { if (stream && stream.getTracks) stream.getTracks().forEach((tr) => tr.stop()); } catch (e) {}
      stream = null;
    }
    function clearTimer() {
      if (timer) { window.clearInterval(timer); timer = null; }
    }
    async function addFiles(input) {
      const files = Array.from((input && input.files) || []);
      if (!files.length) return;
      for (const file of files) {
        if (pending.length >= MAX_ATTACHMENTS) { toast(t('الحد الأقصى أربعة مرفقات'), 'error'); break; }
        if (!validImage(file)) { toast(t('نوع الملف غير مدعوم'), 'error'); continue; }
        try {
          const original = await readAsDataURL(file);
          const prepared = dataUrlBytes(original) > 350 * 1024 ? await shrinkImage(original) : original;
          const size = dataUrlBytes(prepared);
          if (size < 1) { toast(t('تعذّر قراءة الصورة'), 'error'); continue; }
          if (size > MAX_ATTACHMENT_BYTES) { toast(t('الملف كبير جداً'), 'error'); continue; }
          pending.push({
            kind: 'image', mime: dataMime(prepared),
            name: String(file.name || 'photo.jpg').slice(0, 120),
            size, data_url: prepared,
          });
        } catch (e) { toast(t('تعذّر قراءة الصورة'), 'error'); }
      }
      try { input.value = ''; } catch (e) {}
      refresh();
    }
    galleryInput.addEventListener('change', () => addFiles(galleryInput));
    cameraInput.addEventListener('change', () => addFiles(cameraInput));

    function canRecord() {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    }
    async function startRecording() {
      if (!canRecord()) { toast(t('التسجيل الصوتي غير مدعوم في هذا المتصفح'), 'error'); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { toast(t('تعذّر الوصول إلى الميكروفون'), 'error'); return; }
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mpeg'];
      let mime = '';
      try {
        if (window.MediaRecorder.isTypeSupported) mime = candidates.find((x) => window.MediaRecorder.isTypeSupported(x)) || '';
      } catch (e) {}
      try {
        recorder = mime ? new window.MediaRecorder(stream, { mimeType: mime }) : new window.MediaRecorder(stream);
      } catch (e) {
        stopTracks(); toast(t('التسجيل الصوتي غير مدعوم في هذا المتصفح'), 'error'); return;
      }
      chunks = []; cancelled = false; seconds = 0;
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onerror = () => { toast(t('تعذّر قراءة التسجيل'), 'error'); };
      const rec = recorder;
      recorder.onstop = async () => {
        clearTimer(); stopTracks(); setMicUI(false);
        if (!cancelled) {
          try {
            const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
            if (!blob.size) toast(t('التسجيل فارغ'), 'error');
            else {
              const data = await readAsDataURL(blob);
              const size = dataUrlBytes(data);
              if (size > MAX_ATTACHMENT_BYTES) toast(t('الملف كبير جداً'), 'error');
              else pending.push({
                kind: 'audio', mime: dataMime(data), name: voiceName(dataMime(data)),
                size, data_url: data,
              });
            }
          } catch (e) { toast(t('تعذّر قراءة التسجيل'), 'error'); }
        }
        recorder = null; chunks = []; refresh();
      };
      try { recorder.start(); }
      catch (e) { stopTracks(); recorder = null; toast(t('تعذّر الوصول إلى الميكروفون'), 'error'); return; }
      setMicUI(true);
      timer = window.setInterval(() => {
        seconds += 1;
        if (seconds >= MAX_RECORD_SECONDS) stopRecording();
        else refresh();
      }, 1000);
      refresh();
    }
    function stopRecording() {
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (e) { cancelRecording(); }
      } else cancelRecording();
    }
    function cancelRecording() {
      cancelled = true; clearTimer(); stopTracks(); setMicUI(false);
      if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (e) {} }
      recorder = null; chunks = []; refresh();
    }
    function toggleRecording() {
      if (recording) stopRecording();
      else startRecording();
    }

    refresh();
    return {
      node,
      getAttachments: () => pending.map((a) => ({ ...a })),
      hasAttachments: () => pending.length > 0,
      isRecording: () => recording,
      clear: () => { pending = []; refresh(); },
      destroy: () => {
        cancelled = true; clearTimer(); stopTracks();
        if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (e) {} }
        recorder = null; chunks = []; setMicUI(false);
      },
    };
  }

  window.GSChat = {
    MAX_ATTACHMENTS,
    MAX_ATTACHMENT_BYTES,
    MAX_RECORD_SECONDS,
    linkifyInto,
    attachmentSrc,
    renderAttachments,
    createAttachmentComposer,
    dataMime,
    dataUrlBytes,
  };
})();
