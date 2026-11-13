import { once } from 'node:events';
import { createServer } from 'node:http';

import { Schema } from 'effect';
import { onTestFinished } from 'vitest';

const decodeAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

function isOfTheBucketAlone(url = '/'): boolean {
  return new URL(url, 'http://store').pathname.split('/').filter((segment) => segment !== '').length === 1;
}

export async function aStoreAnswering(bucketStatus: number, objectStatus = 404): Promise<string> {
  const server = createServer((request, response) => {
    response.writeHead(isOfTheBucketAlone(request.url) ? bucketStatus : objectStatus).end();
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(async () => {
    server.close();
    await once(server, 'close');
  });
  return `127.0.0.1:${String(decodeAddress(server.address()).port)}`;
}
