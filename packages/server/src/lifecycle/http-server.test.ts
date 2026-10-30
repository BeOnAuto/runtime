import { afterEach, describe, expect, it } from 'vitest';

import { type RunningServer } from '../server-options/server-options.ts';
import { defaultServerOptions } from '../testing/entries/serving-options.ts';
import { ownOriginOf, tcpPort } from './http-server.ts';
import { startServer } from './lifecycle.ts';

describe('HTTP server', () => {
  let server: RunningServer | undefined;

  afterEach(async () => {
    await server?.stop();
  });

  async function request(path: string, method = 'GET'): Promise<{ status: number; body: unknown }> {
    server = await startServer({ HOST: '127.0.0.1', PORT: '0' }, defaultServerOptions);
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method });
    return { status: response.status, body: await response.json() };
  }

  it('reports healthy on GET /health', async () => {
    expect(await request('/health')).toEqual({ status: 200, body: { status: 'ok' } });
  });

  it('answers 404 with a problem document for unknown paths', async () => {
    expect(await request('/nope')).toEqual({
      status: 404,
      body: {
        type: 'https://on.auto/problems/not_found',
        title: 'Not found',
        status: 404,
        detail: 'No route matches the path',
        reason: 'not_found',
      },
    });
  });

  it('answers 405 for non-GET requests to /health', async () => {
    expect(await request('/health', 'POST')).toMatchObject({ status: 405, body: { reason: 'method_not_allowed' } });
  });
});

describe('tcpPort', () => {
  it('reads the port of a TCP address', () => {
    expect(tcpPort({ address: '127.0.0.1', family: 'IPv4', port: 4321 })).toBe(4321);
  });

  it.each([null, '/tmp/auto-runtime.sock'])('rejects %s because it is not a TCP address', (address) => {
    expect(() => tcpPort(address)).toThrow(new TypeError('The server is not listening on a TCP port'));
  });
});

describe('the origin of the server on its own machine', () => {
  it('names the loopback host it listens on, an IPv6 host in brackets', () => {
    expect([ownOriginOf('127.0.0.1', 5555), ownOriginOf('::1', 5555), ownOriginOf('localhost', 3000)]).toEqual([
      'http://127.0.0.1:5555',
      'http://[::1]:5555',
      'http://localhost:3000',
    ]);
  });
});
