import { createServer, type IncomingMessage } from 'node:http';

import { Schema } from 'effect';
import { WebSocketServer, type WebSocket } from 'ws';

interface Speaking {
  readonly send: (text: string) => void;
  readonly sendBytes: (bytes: readonly number[]) => void;
  readonly close: (code: number) => void;
}

export type Script = (speaking: Speaking) => void;

export interface SocketService {
  readonly addressOf: (path: string) => string;
  readonly received: () => readonly string[];
  readonly closes: () => readonly number[];
  readonly closed: () => Promise<void>;
}

type Verified = (
  accepted: boolean,
  code?: number,
  message?: string,
  headers?: Readonly<Record<string, string>>,
) => void;

const accepted: readonly [boolean, number, string, Readonly<Record<string, string>>] = [true, 101, '', {}];

const answers: ReadonlyMap<string, readonly [boolean, number, string, Readonly<Record<string, string>>]> = new Map([
  ['/refused', [false, 401, 'Unauthorized', {}]],
  ['/moved', [false, 302, 'Found', { location: '/elsewhere' }]],
]);

const listenedAt = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

function verifiedBy({ req }: { readonly req: IncomingMessage }, verified: Verified): void {
  verified(...(answers.get(String(req.url)) ?? accepted));
}

export function aSocketService(scripts: Readonly<Record<string, Script>>): Promise<SocketService> {
  const received: string[] = [];
  const closes: number[] = [];
  const server = createServer();
  const sockets = new WebSocketServer({ server, verifyClient: verifiedBy });
  sockets.on('connection', (socket: Readonly<WebSocket>, request: IncomingMessage) => {
    socket.on('message', (data: unknown) => {
      received.push(String(data));
    });
    socket.on('close', (code: number) => {
      closes.push(code);
    });
    scripts[String(request.url)]?.({
      send: (text) => {
        socket.send(text);
      },
      sendBytes: (bytes) => {
        socket.send(Buffer.from(bytes), { binary: true });
      },
      close: (code) => {
        socket.close(code);
      },
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = listenedAt(server.address());
      resolve({
        addressOf: (at) => `ws://127.0.0.1:${port}${at}`,
        received: () => [...received],
        closes: () => [...closes],
        closed: () =>
          new Promise((done) => {
            sockets.close();
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}
