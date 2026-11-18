// «مكتبتي» destination — the blog itself, shown INSIDE the app.
// The site is embedded as-is (iframe), so the user sees exactly the website,
// not a rebuilt version: no external browser, the bottom bar stays available.
(function () {
  const S = window.Store;
  const { el, ico, t } = S;
  const root = document.getElementById('root');

  const BLOG = 'https://fiha1.blogspot.com/?m=1';

  S.bottomNav('library');

  root.innerHTML = '';
  const page = el('div', { class: 'blog-page' });

  const frame = el('iframe', {
    class: 'blog-frame',
    src: BLOG,
    title: t('المقالات'),
    referrerpolicy: 'no-referrer',
    allow: 'clipboard-write',
  });

  let loaded = false;
  const spinner = el('div', { class: 'blog-loading' }, el('div', { class: 'spinner' }));
  frame.addEventListener('load', () => {
    loaded = true;
    spinner.remove();
    frame.classList.add('is-ready');
  });

  // If the site cannot be embedded (network error / blocked), offer the plain
  // link — still without leaving the app if the WebView keeps it internal.
  const fallback = el('div', { class: 'blog-fail' },
    el('p', null, t('تعذّر عرض الموقع الآن')),
    el('a', { class: 'btn btn-primary btn-sm', href: BLOG }, t('فتح المدونة')),
  );
  fallback.style.display = 'none';
  setTimeout(() => {
    if (!loaded) { spinner.remove(); fallback.style.display = ''; }
  }, 12000);

  page.append(frame, spinner, fallback);
  root.append(page);

  window.addEventListener('pagehide', () => { try { frame.src = 'about:blank'; } catch (e) {} }, { once: true });
})();
