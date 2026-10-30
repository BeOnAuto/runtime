import { once } from 'node:events';
import { createServer } from 'node:net';

import { tcpPort } from '../../lifecycle/http-server.ts';

export async function aPortNothingListensOn(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = tcpPort(probe.address());
  probe.close();
  await once(probe, 'close');
  return port;
}
