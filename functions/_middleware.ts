// Site-level rules the static hosting cannot express.
//
// /sitemap.xml — the Worker renders it (it knows every published item), but the
// Worker is mounted under /api and Pages routes functions by FILE PATH, so
// `functions/sitemap.xml.ts` would only ever serve the literal path
// "/sitemap.xml.ts". This middleware is what actually answers "/sitemap.xml"
// (verified: the root URL was still the static 404 without it). Everything
// else is untouched and falls through to the static site.
const WORKER_ORIGIN = 'https://goldenstore-api.faycalfaycal13526.workers.dev';

const EMPTY_SITEMAP =
  '<?xml version="1.0" encoding="UTF-8"?>'
  + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';

export const onRequest = async (context: any): Promise<Response> => {
  const { request, next } = context;
  const url = new URL(request.url);
  if (url.pathname !== '/sitemap.xml') return next();

  const headers = new Headers(request.headers);
  headers.set('host', url.host);
  try {
    const response = await fetch(`${WORKER_ORIGIN}/api/sitemap.xml`, { headers });
    const body = await response.text();
    // A Worker hiccup must not hand a search engine an HTML page instead of XML.
    if (!response.ok || !body.includes('<urlset')) {
      return new Response(EMPTY_SITEMAP, {
        headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300' },
      });
    }
    return new Response(body, {
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' },
    });
  } catch {
    return new Response(EMPTY_SITEMAP, {
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=60' },
    });
  }
};
