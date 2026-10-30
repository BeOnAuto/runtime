import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { buffer } from 'node:stream/consumers';

import { tcpPort } from '../../lifecycle/http-server.ts';

export interface ReceivedExport {
  readonly path: string;
  readonly contentType: string;
  readonly text: string;
}

export interface OtlpReceiver {
  readonly endpoint: string;
  readonly received: () => readonly ReceivedExport[];
  readonly close: () => Promise<void>;
}

export async function receivingOtlp(): Promise<OtlpReceiver> {
  const received: ReceivedExport[] = [];
  const receive = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const body = await buffer(request);
    received.push({
      path: String(request.url),
      contentType: String(request.headers['content-type']),
      text: body.toString('utf8'),
    });
    response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  };
  const server = createServer((request, response) => {
    void receive(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    endpoint: `http://127.0.0.1:${tcpPort(server.address())}`,
    received: () => [...received],
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}
