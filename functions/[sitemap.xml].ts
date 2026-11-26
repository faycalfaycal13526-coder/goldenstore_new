// /sitemap.xml at the SITE root.
//
// The Worker that renders the sitemap lives under /api (it is mounted on
// `basePath('/api')`), and Pages only hands <function>.ts the exact path it is
// named after — so this file proxies the browser-friendly URL onto the API one
// instead of letting the static 404 answer for it.
//
// Fetched the same way the /api proxy does it (the Worker's workers.dev
// hostname), with the site's own Host kept so the Worker still sees the domain.
const WORKER_ORIGIN = 'https://goldenstore-api.faycalfaycal13526.workers.dev';

export const onRequest = async ({ request }: { request: Request }): Promise<Response> => {
  const incoming = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.set('host', incoming.host);
  try {
    const response = await fetch(`${WORKER_ORIGIN}/api/sitemap.xml`, { headers });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch {
    // A missing sitemap must never look like a broken site.
    return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', {
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=60' },
    });
  }
};
