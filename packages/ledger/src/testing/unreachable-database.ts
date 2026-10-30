import { once } from 'node:events';
import { createServer } from 'node:net';

import { Schema } from 'effect';

export interface UnreachableDatabase {
  readonly url: string;
  readonly port: number;
  readonly password: string;
}

const decodeAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

async function aPortNobodyListensOn(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = decodeAddress(server.address());
  server.close();
  await once(server, 'close');
  return port;
}

export async function unreachableDatabase(): Promise<UnreachableDatabase> {
  const port = await aPortNobodyListensOn();
  const password = 'a-secret-password';
  return { url: `postgresql://playbooks:${password}@127.0.0.1:${port}/playbooks`, port, password };
}
