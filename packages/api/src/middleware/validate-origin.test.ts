import type { Authenticator } from '@on.auto/identity';
import { servedStudio } from '@on.auto/identity/testing';
import { describe, expect, it } from 'vitest';

import { call, echoRequestId, createTestHandler } from '../testing/api-calls.ts';

const allowed = 'https://app.example';

describe('the Origin check', () => {
  it('lets a request without an Origin header through', async () => {
    expect(await call(createTestHandler().handler, '/nowhere')).toMatchObject({ status: 404 });
  });

  it('lets an allowed origin through', async () => {
    const { handler } = createTestHandler({ allowedOrigins: [allowed] });

    expect(await call(handler, '/nowhere', { headers: { origin: allowed } })).toMatchObject({ status: 404 });
  });

  it.each([
    'https://evil.example',
    'http://studio.on.auto',
    'https://studio.on.auto.evil.example',
    'http://app.example',
    'https://app.example:8443',
    'https://app.example.evil',
    'null',
    '',
  ])('rejects the origin "%s" with 403', async (origin) => {
    const { handler } = createTestHandler({ allowedOrigins: [allowed] });

    expect(await call(handler, '/nowhere', { headers: { origin } })).toMatchObject({
      status: 403,
      body: { reason: 'origin_not_allowed', detail: 'The origin of this request is not allowed' },
    });
  });

  it('validates requests to mounted routes', async () => {
    const { handler } = createTestHandler({ routes: [echoRequestId] });

    expect(await call(handler, '/echo', { headers: { origin: 'https://evil.example' } })).toMatchObject({
      status: 403,
    });
  });

  it('does not validate requests to the health check', async () => {
    const { handler } = createTestHandler();

    expect(await call(handler, '/health', { headers: { origin: 'https://evil.example' } })).toMatchObject({
      status: 200,
    });
  });
});

describe('the Origin check, for the studio', () => {
  it('lets the studio through without being listed', async () => {
    expect(
      await call(createTestHandler().handler, '/nowhere', { headers: { origin: 'https://studio.on.auto' } }),
    ).toMatchObject({ status: 404 });
  });
});

const signingIn: Authenticator = {
  mode: 'credentials',
  resource: { publicUrl: 'https://runtime.example', authorizationServers: ['https://login.example'] },
  authenticate: () => Promise.resolve({ because: undefined }),
};

describe('the Origin check, for a page at the origin of the runtime itself', () => {
  it('lets the origin the request came in on through where the runtime serves Studio', async () => {
    const { handler } = createTestHandler({ studio: servedStudio });

    expect(await call(handler, '/nowhere', { headers: { origin: 'http://localhost' } })).toMatchObject({ status: 404 });
  });

  it('refuses that origin where the runtime serves no Studio', async () => {
    expect(
      await call(createTestHandler().handler, '/nowhere', { headers: { origin: 'http://localhost' } }),
    ).toMatchObject({ status: 403, body: { reason: 'origin_not_allowed' } });
  });

  it('takes PUBLIC_URL as the origin of the runtime where people sign in, not the address the request came in on', async () => {
    const { handler } = createTestHandler({ studio: servedStudio, authenticator: signingIn });

    expect([
      (await call(handler, '/health', { headers: { origin: 'https://runtime.example' } })).status,
      (await call(handler, '/nowhere', { headers: { origin: 'https://runtime.example' } })).status,
      (await call(handler, '/nowhere', { headers: { origin: 'http://localhost' } })).status,
    ]).toEqual([200, 401, 403]);
  });
});
