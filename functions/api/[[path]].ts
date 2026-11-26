// Same-origin proxy for Cloudflare Pages (goldenstore-new.pages.dev and the
// custom domain). The API itself is the Worker `goldenstore-api`.
//
// WHY THIS IS NOT A PLAIN FORWARD:
// The Worker's custom domain api.goldenstore.online is not bound — the zone
// goldenstore.online lives in a different Cloudflare account than the one the
// deploy token can see, so wrangler fails with
//   «The zone "goldenstore.online" does not exist on your account. [10084]»
// and the hostname stays on Cloudflare's 100:: placeholder (no Worker bound).
// Forwarding to that hostname therefore times out: the 522 every /api/* call
// returned. We now call the Worker on its own workers.dev hostname and simply
// keep the original Host header, so the Worker still sees the site's domain
// (its STORE_DOMAIN / origin checks keep working exactly as before) while the
// request travels over a route that actually exists.
//
// WORKER_ORIGIN can be overridden in the Pages project settings without a code
// change; everything else is the same-origin contract the site already uses.
const WORKER_ORIGIN = 'https://goldenstore-api.faycalfaycal13526.workers.dev';

export const onRequest = async ({ request }: { request: Request }): Promise<Response> => {
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, WORKER_ORIGIN);

  const headers = new Headers(request.headers);
  // Keep the browser-facing host so the Worker keeps its same-origin behaviour.
  headers.set('host', incoming.host);

  const init: RequestInit = {
    method: request.method,
    headers,
    // Only GET/HEAD are body-less; everything else keeps its payload.
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
    // @ts-expect-error — Cloudflare-specific and required for streamed bodies.
    duplex: 'half',
  };

  try {
    return await fetch(new Request(target, init));
  } catch (err) {
    // Never let a proxy failure look like a generic gateway error: say what broke.
    return new Response(JSON.stringify({
      error: 'api_unreachable',
      message: 'The store API could not be reached. The website is up; the API Worker is not answering.',
      target: `${WORKER_ORIGIN}${incoming.pathname}`,
      detail: String((err as Error)?.message || err),
    }), {
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
};
