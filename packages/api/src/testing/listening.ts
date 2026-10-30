import { once } from 'node:events';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';

import { Function, Schema } from 'effect';

import type { ApiHandler } from '../index.ts';

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
  readonly bodyLeftOpen?: boolean;
  readonly firstPieceReceived?: () => void;
}

export interface Received {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
  readonly whole: boolean;
}

export const unanswered: Received = { status: 0, headers: {}, body: '', whole: false };

export function exchanged(
  origin: string,
  path: string,
  { method = 'GET', headers, body, bodyLeftOpen = false, firstPieceReceived = Function.constVoid }: Sent,
): Promise<Received> {
  return new Promise((resolve) => {
    const sent = request(`${origin}${path}`, { method, headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.once('data', firstPieceReceived);
      response.on('data', (piece: string) => {
        text += piece;
      });
      response.on('error', Function.constVoid);
      response.on('close', () => {
        sent.destroy();
        resolve({
          status: Number(response.statusCode),
          headers: response.headers,
          body: text,
          whole: response.complete,
        });
      });
    });
    sent.on('error', () => {
      resolve(unanswered);
    });
    if (bodyLeftOpen) {
      sent.flushHeaders();
      return;
    }
    sent.end(body);
  });
}
