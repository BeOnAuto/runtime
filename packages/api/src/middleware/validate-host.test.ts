import { authenticatorFor } from '@on.auto/identity';
import { describe, expect, it } from 'vitest';

import { call, echoRequestId, createTestHandler } from '../testing/api-calls.ts';

const localAccess = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined });

const foreignHosts = [
  'evil.example',
  'localhost.evil.example',
  'evil.example:5555',
  '127.0.0.2',
  '10.0.0.1:5555',
  '',
  'evil.localhost',
  'xlocalhost:5555',
  'localhost:abc',
  'localhost:80x',
  '127.0.0.1:',
];

describe('the Host check in local mode', () => {
  it.each(['localhost', 'localhost:5555', '127.0.0.1', '127.0.0.1:1', '[::1]', '[::1]:443', 'LocalHost:3000'])(
    'lets the Host %s through',
    async (host) => {
      const { handler } = createTestHandler({ authenticator: localAccess });

      expect(await call(handler, '/nowhere', { headers: { host } })).toMatchObject({ status: 404 });
    },
  );

  it.each(foreignHosts)('rejects the Host "%s" with 403', async (host) => {
    const { handler } = createTestHandler({ authenticator: localAccess });

    expect(await call(handler, '/nowhere', { headers: { host } })).toMatchObject({
      status: 403,
      body: { reason: 'forbidden', detail: 'Local mode accepts only a localhost Host header' },
    });
  });

  it('rejects a request without a Host header', async () => {
    const { handler } = createTestHandler({ authenticator: localAccess });

    expect(await call(handler, '/nowhere')).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
  });

  it('validates requests to mounted routes', async () => {
    const { handler } = createTestHandler({ authenticator: localAccess, routes: [echoRequestId] });

    expect(await call(handler, '/echo', { headers: { host: 'evil.example' } })).toMatchObject({ status: 403 });
    expect(await call(handler, '/echo', { headers: { host: 'localhost:5555' } })).toMatchObject({ status: 200 });
  });

  it('does not validate requests to the health check', async () => {
    const { handler } = createTestHandler({ authenticator: localAccess });

    expect(await call(handler, '/health', { headers: { host: 'evil.example' } })).toMatchObject({ status: 200 });
  });

  it('is not applied outside local mode', async () => {
    const { handler } = createTestHandler();

    expect(await call(handler, '/nowhere', { headers: { host: 'evil.example' } })).toMatchObject({ status: 404 });
  });
});
