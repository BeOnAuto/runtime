import { generateKeyPairSync, sign } from 'node:crypto';

import { allPermissions, type CallingClient } from '@on.auto/operations';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { type IdentityService, identityServiceOf, type IssuerFetch } from '../index.ts';
import { type Claims, fakeIssuer, hostedStudio, principalIn, signedTokens, testPublicUrl } from '../testing/index.ts';

const atStart = { now: () => Date.parse('2026-10-13T09:00:00Z') };

const agentsDocument = 'https://agent.example/oauth/client.json';

const clientsNamed: ReadonlyArray<readonly [string, Claims, CallingClient]> = [
  [
    'a client named by its metadata document, by its client_id, its client_name and the host of that document',
    { client_id: agentsDocument, client_name: 'An agent' },
    { id: agentsDocument, name: 'An agent', domain: 'agent.example' },
  ],
  [
    'a client registered with the issuer, by its client_id alone, with no domain',
    { client_id: 'f7d3b2a1' },
    { id: 'f7d3b2a1', name: null, domain: null },
  ],
  [
    'a client whose client_id is an address that is not https, with no domain',
    { client_id: 'http://agent.example/client.json', client_name: 'An agent' },
    { id: 'http://agent.example/client.json', name: 'An agent', domain: null },
  ],
  [
    'a client whose client_name is no name the facts take, with no name',
    { client_id: agentsDocument, client_name: 'An\u0000agent' },
    { id: agentsDocument, name: null, domain: 'agent.example' },
  ],
];

const namingNoClient: ReadonlyArray<readonly [string, Claims]> = [
  ['a token that holds no client_id', {}],
  ['a client_id that is no name the facts take', { client_id: 'x'.repeat(257), client_name: 'An agent' }],
  ['a client_id that is not a string', { client_id: 7 }],
];

describe('the client an access token was issued to', () => {
  it.each(clientsNamed)('is the client of the caller, for %s', async (_case, claims, client) => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const person = principalIn(await identityService.personOf(await token(claims), '/mcp'));

    expect([person?.own.client, person?.callerIn('acme')?.client]).toEqual([client, client]);
  });

  it.each(namingNoClient)('is none, the token taken all the same, for %s', async (_case, claims) => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const person = principalIn(await identityService.personOf(await token(claims), '/mcp'));

    expect(person?.own).toEqual({
      id: 'person:ada',
      name: 'Ada Lovelace',
      org: 'acme',
      permissions: allPermissions,
      playbooks: '*',
    });
    expect(person?.own).not.toHaveProperty('client');
  });
});

const issuer = 'https://keys.example';

const seconds = Math.floor(Date.now() / 1000);

const claims = {
  iss: issuer,
  sub: 'ada',
  name: 'Ada Lovelace',
  aud: testPublicUrl,
  exp: seconds + 300,
  org_id: 'acme',
};

const first = generateKeyPairSync('rsa', { modulusLength: 2048 });

const second = generateKeyPairSync('rsa', { modulusLength: 2048 });

type Jwk = Readonly<Record<string, unknown>>;

const firstJwk: Jwk = { ...first.publicKey.export({ format: 'jwk' }) };

const secondJwk: Jwk = { ...second.publicKey.export({ format: 'jwk' }) };

function keyOf(jwk: Jwk, extra: Readonly<Record<string, string>>): Jwk {
  return { ...jwk, ...extra };
}

function answeringKeys(keys: readonly Jwk[]): IssuerFetch {
  const documents = new Map<string, unknown>([
    [`${issuer}/.well-known/oauth-authorization-server`, { issuer, jwks_uri: `${issuer}/jwks` }],
    [`${issuer}/jwks`, { keys }],
  ]);
  return (request) =>
    Promise.resolve(
      documents.has(request.url) ? Response.json(documents.get(request.url)) : new Response(null, { status: 404 }),
    );
}

function serviceAnswering(keys: readonly Jwk[]): Promise<IdentityService> {
  return identityServiceOf(
    { issuer, publicUrl: testPublicUrl, studio: hostedStudio, allowedOrigins: [] },
    { fetch: answeringKeys(keys), now: Date.now },
  );
}

function signedByTheFirst(header: Readonly<Record<string, unknown>>): Promise<string> {
  return new SignJWT({ ...claims }).setProtectedHeader({ alg: 'RS256', ...header }).sign(first.privateKey);
}

function segmentOf(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signedUnder(header: Readonly<Record<string, unknown>>): string {
  const signed = `${segmentOf(header)}.${segmentOf(claims)}`;
  return `${signed}.${sign('sha256', Buffer.from(signed), first.privateKey).toString('base64url')}`;
}

describe('a token without a kid', () => {
  it('is verified by the only key of its algorithm in the key set', async () => {
    const { token, callerOf } = await signedTokens(fakeIssuer('https://login.example'));

    expect(await callerOf(await token({}, { kid: null }))).toBe('person:ada');
  });

  it('is refused when several keys of the key set fit it', async () => {
    const identityService = await serviceAnswering([keyOf(firstJwk, { kid: 'a' }), keyOf(secondJwk, { kid: 'b' })]);

    expect(await identityService.personOf(await signedByTheFirst({}), '/mcp')).toEqual({
      because: 'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
    });
  });
});

describe('a token the runtime cannot read, saying so without blaming the key set', () => {
  it('is refused for a header that is not JSON', async () => {
    const identityService = await serviceAnswering([keyOf(firstJwk, { kid: 'a' })]);
    const [, payload = '', signature = ''] = (await signedByTheFirst({ kid: 'a' })).split('.');

    expect(
      await identityService.personOf(
        `${Buffer.from('not json').toString('base64url')}.${payload}.${signature}`,
        '/mcp',
      ),
    ).toEqual({
      because: 'ERR_JWS_INVALID',
    });
  });

  it.each([[5], [null]])('is refused for a typ of %j, which is no media type', async (typ) => {
    const identityService = await serviceAnswering([keyOf(firstJwk, { kid: 'a' })]);

    expect(await identityService.personOf(signedUnder({ alg: 'RS256', kid: 'a', typ }), '/mcp')).toEqual({
      because: 'its typ is not that of an access token',
    });
    expect(
      await identityService.personOf(signedUnder({ alg: 'RS256', kid: 'a', typ: 'at+jwt' }), '/mcp'),
    ).toMatchObject({
      own: { org: 'acme' },
    });
  });

  it('is refused with words that name no value when its key is under 2048 bits', async () => {
    const small = keyOf(firstJwk, { kid: 'small', n: Buffer.alloc(128, 255).toString('base64url') });
    const identityService = await serviceAnswering([small]);

    expect(await identityService.personOf(await signedByTheFirst({ kid: 'small' }), '/mcp')).toEqual({
      because: 'it could not be verified',
    });
  });
});
