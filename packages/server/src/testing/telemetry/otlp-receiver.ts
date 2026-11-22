import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { buffer } from 'node:stream/consumers';

import { tcpPort } from '../../lifecycle/http-server.ts';
import { somethingHappened } from '../waiting/happenings.ts';

export interface ReceivedExport {
  readonly path: string;
  readonly contentType: string;
  readonly text: string;
}

export interface OtlpReceiver {
  readonly endpoint: string;
  readonly received: () => readonly ReceivedExport[];
  /**
   * The next export taken at the path, asked for before it is sent: the receiver's own signal, which needs no rest of
   * the servers a wait hears from, as an export on its way tells no wait before it arrives.
   */
  readonly receivedAt: (path: string) => Promise<ReceivedExport>;
  readonly close: () => Promise<void>;
}

export interface OtlpReceiving {
  readonly answers: boolean;
}

const answering: OtlpReceiving = { answers: true };

interface Awaited {
  readonly path: string;
  readonly taken: (taken: ReceivedExport) => void;
}

export async function receivingOtlp({ answers }: OtlpReceiving = answering): Promise<OtlpReceiver> {
  const received: ReceivedExport[] = [];
  const awaited = new Set<Awaited>();
  const receive = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const body = await buffer(request);
    const taken = {
      path: String(request.url),
      contentType: String(request.headers['content-type']),
      text: body.toString('utf8'),
    };
    received.push(taken);
    for (const told of [...awaited].filter(({ path }) => path === taken.path)) {
      awaited.delete(told);
      told.taken(taken);
    }
    somethingHappened();
    if (answers) {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    }
  };
  const server = createServer((request, response) => {
    void receive(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    endpoint: `http://127.0.0.1:${tcpPort(server.address())}`,
    received: () => [...received],
    receivedAt: (path) => {
      const { promise, resolve } = Promise.withResolvers<ReceivedExport>();
      awaited.add({ path, taken: resolve });
      return promise;
    },
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}
