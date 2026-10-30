import { once } from 'node:events';
import { createServer } from 'node:http';

import { Schema } from 'effect';

const decodeAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

export async function aClosedPort(): Promise<string> {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = decodeAddress(server.address());
  server.close();
  await once(server, 'close');
  return `http://127.0.0.1:${String(port)}`;
}
