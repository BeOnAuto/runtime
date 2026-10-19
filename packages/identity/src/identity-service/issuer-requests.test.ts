import { once } from 'node:events';
import { createServer } from 'node:http';

import { Result, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { issuerRequestsOverTheNetwork, jsonAt } from './issuer-requests.ts';

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

const server = createServer((request, response) => {
  if (request.url === '/moved') {
    response.writeHead(302, { location: 'http://127.0.0.1/elsewhere' });
    response.end();
    return;
  }
  response.setHeader('content-type', 'application/json');
  response.end('{"issuer":"https://login.example"}');
});

afterEach(() => {
  server.close();
});

describe('the requests to an issuer over the network', () => {
  it('fetch the document at an address with the fetch of the platform, within its bound, and read the time of the platform', async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = portOf(server.address());

    const before = Date.now();
    const now = issuerRequestsOverTheNetwork.now();
    const after = Date.now();

    expect(await jsonAt(issuerRequestsOverTheNetwork, `http://127.0.0.1:${port}/`, 64)).toEqual(
      Result.succeed({ issuer: 'https://login.example' }),
    );
    expect([now >= before, now <= after]).toEqual([true, true]);
  });

  it('follow no redirect, and say that the address answers one', async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = portOf(server.address());

    expect(await jsonAt(issuerRequestsOverTheNetwork, `http://127.0.0.1:${port}/moved`, 64)).toEqual(
      Result.fail('answers a redirect, which the runtime does not follow'),
    );
  });
});
