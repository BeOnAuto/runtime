import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { isIP, type AddressInfo } from 'node:net';

import type { ApiHandler } from '@on.auto/api';

export function createHttpServer(listener: ApiHandler['listener']): Server {
  const server = createServer((request, response) => {
    response.once('finish', () => {
      closeIdleConnectionsOnceClosing(server);
    });
    void listener(request, response);
  });
  return server;
}

export async function listen(server: Server, port: number, host: string): Promise<void> {
  server.listen(port, host);
  await once(server, 'listening');
}

function closeIdleConnectionsOnceClosing(server: Server): void {
  if (!server.listening) {
    server.closeIdleConnections();
  }
}

export function ownOriginOf(host: string, port: number): string {
  return isIP(host) === 6 ? `http://[${host}]:${port}` : `http://${host}:${port}`;
}

export function tcpPort(address: Readonly<AddressInfo> | string | null): number {
  if (address === null || typeof address === 'string') {
    throw new TypeError('The server is not listening on a TCP port');
  }
  return address.port;
}
