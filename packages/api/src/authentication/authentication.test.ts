import { authenticatorFor, createApiKey, defaultStudioOrigin } from '@on.auto/identity';
import { fakeIssuer } from '@on.auto/identity/testing';
import { describe, expect, it } from 'vitest';

import type { RegisterRoutes } from '../index.ts';
import { call, createTestHandler } from '../testing/api-calls.ts';

const acme = createApiKey({ id: 'acme-reader', org: 'acme', permissions: ['org:read'], playbooks: '*' });

const keyHolders = authenticatorFor({ host: '0.0.0.0', apiKeys: [acme.entry] });

const whoIsCalling: RegisterRoutes = (routes) => {
  routes.add('GET', '/v1/orgs/:org/whoami', (c) => c.json(c.get('principal').callerIn(c.req.param('org') ?? '')));
};

const protectedPath = '/v1/orgs/acme/whoami';

const malformedAuthorization: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
  ['credentials of another scheme', [['authorization', 'Basic YWNtZTpzZWNyZXQ=']]],
  ['a Request header with a token, a scheme the API does not know', [['authorization', 'Request a-request.a-digest']]],
  ['a Bearer header without a key', [['authorization', 'Bearer']]],
  ['a Request header without a token', [['authorization', 'Request']]],
  ['two words after Request', [['authorization', 'Request abc def']]],
  ['an empty Authorization header', [['authorization', '']]],
  ['two words after Bearer', [['authorization', 'Bearer abc def']]],
  ['text before Bearer and a valid key', [['authorization', `xBearer ${acme.key}`]]],
  ['text after a valid key', [['authorization', `Bearer ${acme.key} junk`]]],
  [
    'two Authorization headers',
    [
      ['authorization', `Bearer ${acme.key}`],
      ['authorization', `Bearer ${acme.key}`],
    ],
  ],
  [
    'a Bearer and a Request header together',
    [
      ['authorization', `Bearer ${acme.key}`],
      ['authorization', 'Request a-request.a-digest'],
    ],
  ],
  [
    'a Request and a Bearer header together',
    [
      ['authorization', 'Request a-request.a-digest'],
      ['authorization', `Bearer ${acme.key}`],
    ],
  ],
];

describe('authentication with API keys', () => {
  it('lets a route read the caller of a configured key', async () => {
    const { handler } = createTestHandler({ authenticator: keyHolders, routes: [whoIsCalling] });

    expect(await call(handler, protectedPath, { headers: { authorization: `Bearer ${acme.key}` } })).toMatchObject({
      status: 200,
      body: { id: 'acme-reader', org: 'acme', permissions: ['org:read'], playbooks: '*' },
    });
  });

  it('accepts the Bearer scheme in any letter case', async () => {
    const { handler } = createTestHandler({ authenticator: keyHolders, routes: [whoIsCalling] });

    expect(await call(handler, protectedPath, { headers: { authorization: `bearer ${acme.key}` } })).toMatchObject({
      status: 200,
    });
  });
});

describe('a malformed Authorization header', () => {
  it.each(malformedAuthorization)('answers %s with 400 and an invalid_request challenge', async (_case, headers) => {
    const { handler } = createTestHandler({ authenticator: keyHolders, routes: [whoIsCalling] });

    const answer = await handler.fetch(
      new Request(`http://localhost${protectedPath}`, { headers: headers.map(([name, value]) => [name, value]) }),
    );

    expect({ status: answer.status, body: await answer.json() }).toMatchObject({
      status: 400,
      body: {
        reason: 'bad_request',
        detail: 'The Authorization header must hold exactly one API key or access token, as Bearer <key or token>',
      },
    });
    expect(answer.headers.get('www-authenticate')).toBe('Bearer error="invalid_request"');
  });
});

describe('a request without a valid API key', () => {
  it('answers a request without an Authorization header with 401 and a bare Bearer challenge', async () => {
    const { handler } = createTestHandler({ authenticator: keyHolders, routes: [whoIsCalling] });

    const answer = await call(handler, protectedPath);

    expect(answer).toMatchObject({
      status: 401,
      body: { reason: 'unauthenticated', type: 'https://on.auto/problems/unauthenticated' },
    });
    expect(answer.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('marks a presented key that is not valid as an invalid token', async () => {
    const { handler } = createTestHandler({ authenticator: keyHolders, routes: [whoIsCalling] });

    const answer = await call(handler, protectedPath, {
      headers: { authorization: `Bearer abk_acme-reader_${'A'.repeat(43)}` },
    });

    expect(answer.status).toBe(401);
    expect(answer.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
  });

  it('answers an unauthenticated request to an unknown path with 401, not 404', async () => {
    const { handler } = createTestHandler({ authenticator: keyHolders });

    expect(await call(handler, '/nowhere')).toMatchObject({ status: 401 });
    expect(await call(handler, '/nowhere', { headers: { authorization: `Bearer ${acme.key}` } })).toMatchObject({
      status: 404,
    });
  });
});

describe('the public /health path', () => {
  it('answers GET and HEAD without a key', async () => {
    const { handler } = createTestHandler({ authenticator: keyHolders });

    expect([
      (await call(handler, '/health')).status,
      (await call(handler, '/health', { method: 'HEAD' })).status,
    ]).toEqual([200, 200]);
  });

  it.each(['/healthz', '/health/details', '/healthcheck'])(
    'is exactly /health, so %s still needs a key',
    async (path) => {
      const { handler } = createTestHandler({ authenticator: keyHolders });

      expect(await call(handler, path)).toMatchObject({ status: 401, body: { reason: 'unauthenticated' } });
    },
  );

  it('answers any other method on /health with 405 and Allow, not 401', async () => {
    const { handler } = createTestHandler({ authenticator: keyHolders });

    const answer = await call(handler, '/health', { method: 'POST' });

    expect(answer).toMatchObject({ status: 405, body: { reason: 'method_not_allowed' } });
    expect(answer.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('authentication without API keys', () => {
  it('admits nobody when the list of keys is empty, whatever key is presented', async () => {
    const { handler } = createTestHandler({
      authenticator: authenticatorFor({ host: '0.0.0.0', apiKeys: [] }),
      routes: [whoIsCalling],
    });

    const answer = await call(handler, protectedPath, { headers: { authorization: `Bearer ${acme.key}` } });

    expect(answer.status).toBe(401);
    expect(answer.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
  });

  it('admits every request in local mode as the local developer of the org it names', async () => {
    const { handler } = createTestHandler({
      authenticator: authenticatorFor({ host: '127.0.0.1', apiKeys: undefined }),
      routes: [whoIsCalling],
    });

    expect(await call(handler, '/v1/orgs/globex/whoami', { headers: { host: 'localhost:5555' } })).toMatchObject({
      status: 200,
      body: { id: 'local', org: 'globex', playbooks: '*' },
    });
  });
});

describe('a credential presented in local mode', () => {
  it.each([
    ['the session of a page signed in to Auto', () => fakeIssuer('https://login.example').session(defaultStudioOrigin)],
    ['a key, where no key is set', () => Promise.resolve(acme.key)],
  ])('is ignored: a request that presents %s acts as the local developer', async (_case, presented) => {
    const { handler } = createTestHandler({
      authenticator: authenticatorFor({ host: '127.0.0.1', apiKeys: undefined }),
      routes: [whoIsCalling],
    });

    const answer = await call(handler, '/v1/orgs/globex/whoami', {
      headers: { host: 'localhost:5555', origin: defaultStudioOrigin, authorization: `Bearer ${await presented()}` },
    });

    expect(answer).toMatchObject({ status: 200, body: { id: 'local', org: 'globex', playbooks: '*' } });
  });
});
