import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { tcpPort } from '../../lifecycle/http-server.ts';

export const studioPage =
  '<!doctype html><title>Studio</title><link rel="stylesheet" href="./assets/index-7c1d2e.css"><script type="module" src="./assets/index-4f2a9c.js"></script>';

export const studioScript = 'export const studio = true;';

const studioStyles = 'body { margin: 0; }';

export const pageTag = '"page-1"';

const aYear = 31_536_000;

interface AskedOfTheHost {
  readonly path: string;
  readonly userAgent: string | undefined;
  readonly credentials: readonly (string | undefined)[];
  readonly validator: string | undefined;
}

export interface FakeStudioHost {
  readonly origin: string;
  readonly asked: () => readonly AskedOfTheHost[];
  readonly close: () => Promise<void>;
}

const assets: ReadonlyMap<string, readonly [string, string]> = new Map([
  ['/assets/index-4f2a9c.js', ['text/javascript', studioScript]],
  ['/assets/index-7c1d2e.css', ['text/css', studioStyles]],
]);

function answered(request: IncomingMessage, response: ServerResponse): void {
  const path = String(request.url);
  const asset = assets.get(path);
  if (asset !== undefined) {
    response.writeHead(200, { 'content-type': asset[0], 'cache-control': `public, max-age=${aYear}, immutable` });
    response.end(asset[1]);
    return;
  }
  if (path.includes('.')) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  if (request.headers['if-none-match'] === pageTag) {
    response.writeHead(304, { etag: pageTag }).end();
    return;
  }
  response.writeHead(200, {
    'content-type': 'text/html',
    'cache-control': 'public, max-age=0, must-revalidate',
    etag: pageTag,
  });
  response.end(studioPage);
}

export async function fakeStudioHost(): Promise<FakeStudioHost> {
  const asked: AskedOfTheHost[] = [];
  const server = createServer((request, response) => {
    const { 'user-agent': userAgent, cookie, authorization, 'if-none-match': validator } = request.headers;
    asked.push({ path: String(request.url), userAgent, credentials: [cookie, authorization], validator });
    answered(request, response);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const closed = once(server, 'close');
  return {
    origin: `http://127.0.0.1:${tcpPort(server.address())}`,
    asked: () => [...asked],
    close: async () => {
      if (server.listening) {
        server.close();
        server.closeAllConnections();
      }
      await closed;
    },
  };
}
