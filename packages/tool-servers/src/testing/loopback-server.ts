import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import { Schema } from 'effect';

import type { FailedRequest, FetchHandler, HeardRequest, LoopbackServer } from './fetch-handler.ts';

interface Answering {
  readonly origin: string;
  readonly handle: FetchHandler;
  readonly record: (failed: FailedRequest) => void;
}

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

const bodiless: ReadonlySet<string> = new Set(['GET', 'HEAD', 'DELETE']);

async function bodyOf(incoming: IncomingMessage): Promise<string> {
  incoming.setEncoding('utf8');
  let text = '';
  for await (const chunk of incoming) {
    text += String(chunk);
  }
  return text;
}

function headersOf({ rawHeaders }: IncomingMessage): Headers {
  const headers = new Headers();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    headers.append(String(rawHeaders[index]), String(rawHeaders[index + 1]));
  }
  return headers;
}

async function requestOf(incoming: IncomingMessage, origin: string): Promise<Request> {
  const method = String(incoming.method);
  const url = new URL(String(incoming.url), origin);
  const headers = headersOf(incoming);
  return bodiless.has(method)
    ? new Request(url, { method, headers })
    : new Request(url, { method, headers, body: await bodyOf(incoming) });
}

function answered(response: Readonly<Response>, outgoing: ServerResponse): void {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.flushHeaders();
  if (response.body === null) {
    outgoing.end();
    return;
  }
  const body = Readable.fromWeb(response.body);
  outgoing.on('close', () => {
    body.destroy();
  });
  body.pipe(outgoing);
}

async function answerTo(incoming: IncomingMessage, { origin, handle, record }: Answering): Promise<Response> {
  try {
    return await handle(await requestOf(incoming, origin));
  } catch (error) {
    const failed = { method: String(incoming.method), path: String(incoming.url), error: String(error) };
    record(failed);
    return new Response(failed.error, { status: 500 });
  }
}

async function respond(incoming: IncomingMessage, outgoing: ServerResponse, answering: Answering): Promise<void> {
  answered(await answerTo(incoming, answering), outgoing);
}

export async function serveOnLoopback(handlerAt: (origin: string) => FetchHandler): Promise<LoopbackServer> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${portOf(server.address()).port}`;
  const heard: HeardRequest[] = [];
  const failures: FailedRequest[] = [];
  const answering: Answering = {
    origin,
    handle: handlerAt(origin),
    record: (failed) => {
      failures.push(failed);
    },
  };
  server.on('request', (incoming: IncomingMessage, outgoing: ServerResponse) => {
    heard.push({
      method: String(incoming.method),
      path: String(incoming.url),
      userAgent: incoming.headers['user-agent'],
    });
    void respond(incoming, outgoing, answering);
  });
  return {
    origin,
    heard: () => [...heard],
    failures: () => [...failures],
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
