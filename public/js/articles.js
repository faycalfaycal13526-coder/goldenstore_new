// «المقالات» — the owner's blog, rendered as a NORMAL page inside the app.
// Source of truth: the Blogger JSON feed (json-in-script, so no CORS problem).
// List + single post + fallback link, no external browser needed.
(function () {
  const S = window.Store;
  const { el, ico, t, getQuery } = S;
  const root = document.getElementById('root');

  const BLOG = 'https://fiha1.blogspot.com';
  const FEED = BLOG + '/feeds/posts/default';   // full feed: real <style> nodes
  const CACHE_KEY = 'gs_articles_v2';
  const CACHE_TTL = 10 * 60 * 1000;

  S.bottomNav('library');

  /* ---------------- feed plumbing ---------------- */
  let seq = 0;
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = '__gsArticles' + (++seq) + '_' + Date.now().toString(36);
      const script = document.createElement('script');
      const done = (ok, data) => {
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        ok ? resolve(data) : reject(data);
      };
      window[cb] = (data) => done(true, data);
      script.onerror = () => done(false, new Error('feed_error'));
      script.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'alt=json-in-script&callback=' + cb;
      document.body.appendChild(script);
      setTimeout(() => done(false, new Error('feed_timeout')), 12000);
    });
  }

  function readCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!raw || !raw.items || !raw.items.length) return null;
      if (Date.now() - (raw.ts || 0) > CACHE_TTL) return raw;   // stale: paint, then refresh
      return raw;
    } catch (e) { return null; }
  }
  const htmlCache = {};                 // id -> post HTML (memory only)
  function writeCache(items) {
    try {
      const slim = items.map((it) => {
        htmlCache[it.id] = it.html;
        return { id: it.id, url: it.url, title: it.title, image: it.image, text: it.text, date: it.date };
      });
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items: slim }));
    } catch (e) {}
  }

  function entryLink(e) {
    const alt = (e.link || []).filter((l) => l && l.rel === 'alternate')[0];
    return (alt && alt.href) || BLOG;
  }
  function entryId(e) {
    const m = /post-(\d+)$/.exec(entryLink(e)) || /blog-(\d+)$/.exec(entryLink(e));
    return m ? m[1] : entryLink(e);
  }
  function entryImage(e) {
    const th = e['media$thumbnail'] && e['media$thumbnail'].url;
    if (th) return th.replace(/\/s72-c\//, '/w600/').replace(/\/w200-h200\//, '/w600-h338/');
    const html = (e.summary && e.summary.$t) || (e.content && e.content.$t) || '';
    const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
    return m ? m[1] : '';
  }
  /* The blog inlines its whole stylesheet inside the post HTML, and the Blogger
     SUMMARY feed escapes those <style> tags into plain text — so CSS would leak
     into the excerpts. Fix: (1) fetch the FULL content for the excerpt, where
     <style> is a real node that DOMParser can drop, and (2) keep a CSS scrub as
     a last resort. */
  function htmlToText(html) {
    try {
      const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      doc.querySelectorAll('style, script, noscript, iframe, link').forEach((n) => n.remove());
      let text = (doc.body ? doc.body.textContent : '') || '';
      text = text.replace(/\u00a0/g, ' ');
      text = text.replace(/[^{}<>]{0,120}\{[^{}]{0,400}\}/g, ' ');   // any leaked CSS
      return text.replace(/\s+/g, ' ').trim();
    } catch (e) {
      return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  function entryText(e) {
    const rich = (e.content && e.content.$t) || '';
    const sum = (e.summary && e.summary.$t) || '';
    return htmlToText(rich || sum).replace(/^[\s.,:;\-–—]+/, '').trim();
  }
  function entryExcerpt(e) {
    const full = htmlToText((e.content && e.content.$t) || '');
    const text = full || entryText(e);
    // Skip the app-info block at the top («version…», «size…») and start at the
    // first real sentence, which is what a reader expects in a card.
    const m = text.match(/(Introduction|مقدمة|تطبيق|The Complete|is an? [A-Z]|يعتبر)/);
    let from = m && m.index > 40 ? text.slice(m.index) : text;
    from = from.replace(/(Introduction|Overview|Conclusion|Overview|Features)/g, ' $1 ')
               .replace(/\s+/g, ' ').trim();
    return from;
  }
  function entryDate(e) {
    try {
      const d = new Date(e.published.$t);
      return d.toLocaleDateString(document.documentElement.lang === 'ar' ? 'ar' : 'en-GB',
        { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (err) { return ''; }
  }
  function toItem(e) {
    return {
      id: entryId(e), url: entryLink(e), title: (e.title && e.title.$t) || '',
      image: entryImage(e), text: entryExcerpt(e), date: entryDate(e),
      html: (e.content && e.content.$t) || (e.summary && e.summary.$t) || '',
    };
  }

  let cache = { items: [] };

  async function load(force) {
    const cached = readCache();
    if (cached && cached.items.length) cache.items = cached.items;
    const fresh = cached && (Date.now() - cached.ts < CACHE_TTL);
    if (fresh && !force && cache.items.length) return cache.items;
    const url = FEED + '?max-results=12&orderby=published';
    const data = await jsonp(url);
    const entries = (data && data.feed && data.feed.entry) || [];
    const items = entries.map(toItem).filter((x) => x.title);
    if (items.length) { cache.items = items; writeCache(items); }
    return cache.items;
  }

  /* ---------------- views ---------------- */
  function blogHeader(opts) {
    return el('div', { class: 'art-top' },
      el('button', {
        class: 'art-back', type: 'button', 'aria-label': t('رجوع'),
        onclick: () => (opts && opts.onBack ? opts.onBack() : history.back()),
      }, ico('arrowLeft', 'icon')),
      el('div', { class: 'art-brand' },
        el('img', { class: 'art-logo', src: window.GSIcons.BLOG_LOGO, alt: '' }),
        el('span', { class: 'art-brand-txt' }, t('المقالات')),
      ),
      el('button', {
        class: 'art-refresh', type: 'button', 'aria-label': t('إعادة تحميل'),
        onclick: () => renderList(true),
      }, ico('refresh', 'icon')),
    );
  }

  function skeleton() {
    return el('div', { class: 'art-list' },
      ...Array.from({ length: 4 }, () => el('div', { class: 'art-skel' },
        el('div', { class: 'art-skel-img' }),
        el('div', { class: 'art-skel-lines' }, el('span'), el('span')))),
    );
  }

  async function renderList(force) {
    root.innerHTML = '';
    const page = el('div', { class: 'art-page' },
      blogHeader({ onBack: () => { location.href = '/'; } }),
    );
    root.append(page);
    const body = el('div', { class: 'art-body' });
    page.append(body);
    const painting = !cache.items.length;
    if (painting) body.append(skeleton());

    let items = [];
    try { items = await load(force); } catch (e) { items = cache.items || []; }
    body.innerHTML = '';

    if (!items.length) {
      body.append(el('div', { class: 'art-empty' },
        el('img', { class: 'art-empty-logo', src: window.GSIcons.BLOG_LOGO, alt: '' }),
        el('p', null, t('تعذّر تحميل المقالات الآن')),
        el('a', { class: 'btn btn-primary btn-sm', href: BLOG + '/?m=1', rel: 'noopener noreferrer' },
          t('فتح المدونة')),
      ));
      return;
    }

    const list = el('div', { class: 'art-list' });
    items.forEach((it) => {
      const card = el('a', { class: 'art-card', href: `/articles?id=${encodeURIComponent(it.id)}` },
        it.image ? el('div', { class: 'art-thumb' },
          el('img', { src: it.image, alt: '', loading: 'lazy', decoding: 'async' })) : null,
        el('div', { class: 'art-card-body' },
          el('h2', { class: 'art-card-title' }, it.title),
          it.text ? el('p', { class: 'art-card-excerpt' }, it.text.slice(0, 150) + (it.text.length > 150 ? '…' : '')) : null,
          el('div', { class: 'art-card-meta' }, el('span', null, it.date)),
        ),
      );
      card.addEventListener('click', (ev) => {
        ev.preventDefault();
        openPost(it);
      });
      list.append(card);
    });
    body.append(list);
  }

  async function openPost(it) {
    try { history.pushState({ article: it.id }, '', `/articles?id=${encodeURIComponent(it.id)}`); } catch (e) {}
    let html = htmlCache[it.id] || it.html || '';
    if (!html) {
      // Cached list has no HTML: fetch the feed once (fast) and open the post.
      try {
        await load(true);
        const fresh = (cache.items || []).filter((x) => x.id === it.id)[0];
        if (fresh) { it = fresh; html = fresh.html || htmlCache[it.id] || ''; }
      } catch (e) {}
    }
    renderPost({ ...it, html });
  }

  function renderPost(it) {
    root.innerHTML = '';
    const page = el('div', { class: 'art-page' },
      blogHeader({ onBack: () => { try { history.back(); } catch (e) { renderList(); } } }),
    );
    root.append(page);
    const article = el('article', { class: 'art-post' });
    page.append(article);

    article.append(el('h1', { class: 'art-post-title' }, it.title));
    if (it.date) article.append(el('div', { class: 'art-post-meta' }, it.date));
    const firstContentImg = /<img[^>]+src=["']([^"']+)["']/i.exec(it.html || '');
    const same = firstContentImg && it.image && firstContentImg[1].slice(0, 80) === it.image.slice(0, 80);
    if (it.image && !same) {
      article.append(el('div', { class: 'art-hero' },
        el('img', { src: it.image, alt: '', decoding: 'async' })));
    }
    const content = el('div', { class: 'art-content art-shadow' });
    article.append(content);
    // Faithful rendering inside an isolated shadow root.
    renderInto(content, it.html || htmlCache[it.id] || '');

    article.append(el('div', { class: 'art-post-actions' },
      el('a', {
        class: 'btn btn-secondary btn-sm', href: it.url + (it.url.indexOf('?') < 0 ? '?m=1' : ''),
        rel: 'noopener noreferrer',
      }, ico('external', 'icon icon-sm'), t('فتح في المدونة')),
      el('button', {
        class: 'btn btn-sm btn-secondary', type: 'button',
        onclick: () => renderList(),
      }, ico('list', 'icon icon-sm'), t('كل المقالات')),
    ));
    window.scrollTo(0, 0);
  }

  function sanitize(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    // Scripts, embeds and interactive leftovers never render.
    tmp.querySelectorAll('script, iframe, object, embed, form, input, button, noscript').forEach((n) => n.remove());
    tmp.querySelectorAll('*').forEach((n) => {
      [...n.attributes].forEach((a) => {
        const name = a.name.toLowerCase();
        if (name.startsWith('on')) n.removeAttribute(a.name);
        if ((name === 'href' || name === 'src')) {
          const v = (a.value || '').trim().toLowerCase();
          if (v.startsWith('javascript:')) n.removeAttribute(a.name);
        }
      });
      if (n.tagName === 'A') { n.setAttribute('target', '_self'); n.setAttribute('rel', 'noopener noreferrer'); }
    });
    return tmp.innerHTML;
  }

  /* The post keeps its OWN stylesheet — but inside a Shadow DOM, so rules like
     `body{...}` or `.card{...}` can never leak into the app chrome. */
  function renderInto(host, html) {
    host.innerHTML = '';
    const shadow = host.attachShadow({ mode: 'open' });
    const base = document.createElement('style');
    base.textContent = `
      :host { display:block; }
      * { max-width: 100%; }
      img { height: auto; }
      body, .app-wrapper { font-family: inherit; }
    `;
    shadow.appendChild(base);
    const box = document.createElement('div');
    box.innerHTML = sanitize(html);
    // Lazy-load every image and keep it inside the column.
    box.querySelectorAll('img').forEach((img) => {
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
    });
    shadow.appendChild(box);
    return shadow;
  }

  /* ---------------- boot ---------------- */
  const wanted = getQuery('id');
  if (wanted) {
    const known = (readCache() || {}).items || [];
    const hit = known.filter((x) => x.id === wanted)[0];
    if (hit) openPost(hit);
    else {
      renderList().then(() => {
        const found = (cache.items || []).filter((x) => x.id === wanted)[0];
        if (found) renderPost(found);
      });
    }
  } else {
    renderList();
  }

  window.addEventListener('popstate', () => {
    const id = getQuery('id');
    if (!id) { renderList(); return; }
    const found = (cache.items || []).filter((x) => x.id === id)[0];
    if (found) renderPost(found);
  });
})();
