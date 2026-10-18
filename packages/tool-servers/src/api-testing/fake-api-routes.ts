export interface SeenApiRequest {
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface ProgrammedAnswer {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface ApiAnswering {
  readonly see: (request: SeenApiRequest) => void;
  readonly documentRead: () => void;
  readonly programmed: () => ProgrammedAnswer | undefined;
  readonly requestIdHeader: string | undefined;
  readonly deniedText: string;
  readonly nextRequestId: () => string;
}

type Route = (request: Readonly<Request>, url: Readonly<URL>) => Promise<Response> | Response;

const pixel = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function bodyOf(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

function problem(status: number, detail: string): Response {
  return new Response(JSON.stringify({ title: 'Forbidden', status, detail }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

const routes: ReadonlyMap<string, Route> = new Map<string, Route>([
  [
    'GET /search',
    (_request, url) =>
      new Response(`Found 2 rows for ${String(url.searchParams.get('query'))}.`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
  ],
  ['POST /echo', async (request) => Response.json(bodyOf(await request.text()))],
  ['GET /profiles/ada', () => Response.json({ name: 'Ada', rows: 2 })],
  ['PUT /profiles/ada', async (request) => Response.json({ updated: bodyOf(await request.text()) })],
  ['GET /rows', (_request, url) => Response.json({ tags: url.searchParams.getAll('tag') })],
  ['GET /sessions', (request) => Response.json({ session: request.headers.get('x-session') })],
  ['GET /photo', () => new Response(pixel, { headers: { 'content-type': 'image/png' } })],
  ['GET /notes', () => new Response('', { status: 200 })],
]);

function noSuchRoute(request: Readonly<Request>): Response {
  const { pathname, search } = new URL(request.url);
  return new Response(`No such route: ${request.method} ${pathname}${search}`, { status: 404 });
}

function withRequestId(response: Readonly<Response>, name: string | undefined, value: string): Response {
  if (name === undefined) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

export async function answerTo(request: Readonly<Request>, path: string, answering: ApiAnswering): Promise<Response> {
  const programmed = answering.programmed();
  if (programmed !== undefined) {
    return new Response(programmed.body ?? JSON.stringify({ error: `answered ${programmed.status}` }), programmed);
  }
  const requestId = answering.nextRequestId();
  const route = routes.get(`${request.method} ${path}`);
  if (path === '/denied') {
    return withRequestId(problem(403, answering.deniedText), answering.requestIdHeader, requestId);
  }
  const response = route === undefined ? noSuchRoute(request) : await route(request, new URL(request.url));
  return withRequestId(response, answering.requestIdHeader, requestId);
}
