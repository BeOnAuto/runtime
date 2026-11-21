import { once } from 'node:events';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';

import { Schema } from 'effect';

import type { ApiHandler } from '../index.ts';
import { fetchInProcess, servedInProcess } from './in-process.ts';

export { fetchInProcess, listenInProcess } from './in-process.ts';

export interface Listening {
  readonly origin: string;
  readonly close: () => Promise<void>;
}

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

export async function listenOnLoopback(handler: ApiHandler): Promise<Listening> {
  const server = createServer((incoming, outgoing) => {
    void handler.listener(incoming, outgoing);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = portOf(server.address());
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
      await handler.close();
    },
  };
}

export interface Sent {
  readonly method?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface Received {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export function exchanged(origin: string, path: string, sent: Sent): Promise<Received> {
  return servedInProcess(origin) ? exchangedInProcess(origin, path, sent) : exchangedOverHttp(origin, path, sent);
}

async function exchangedInProcess(
  origin: string,
  path: string,
  { method = 'GET', headers, body }: Sent,
): Promise<Received> {
  const answer = await fetchInProcess(`${origin}${path}`, { method, headers, ...(body === undefined ? {} : { body }) });
  return { status: answer.status, headers: Object.fromEntries(answer.headers), body: await answer.text() };
}

function exchangedOverHttp(origin: string, path: string, { method = 'GET', headers, body }: Sent): Promise<Received> {
  return new Promise((resolve) => {
    const sent = request(`${origin}${path}`, { method, headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (piece: string) => {
        text += piece;
      });
      response.on('close', () => {
        sent.destroy();
        resolve({ status: Number(response.statusCode), headers: response.headers, body: text });
      });
    });
    sent.end(body);
  });
}
