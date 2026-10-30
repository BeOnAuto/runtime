const jsonHeaders = { 'content-type': 'application/json', 'cache-control': 'no-store' };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}
