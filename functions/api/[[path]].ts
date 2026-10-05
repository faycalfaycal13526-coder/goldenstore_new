// Same-origin proxy for Cloudflare Pages deployments on *.pages.dev.
// The API itself remains the Worker at api.goldenstore.online.
export const onRequest = async ({ request }: { request: Request }): Promise<Response> => {
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, 'https://api.goldenstore.online');
  return fetch(new Request(target, request));
};
