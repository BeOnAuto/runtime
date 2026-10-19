import { generateKeyPairSync, sign } from 'node:crypto';

import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { identityServiceOf, type IdentityService, type IssuerFetch } from '../index.ts';
import { fakeIssuer, hostedStudio, signedTokens, testPublicUrl } from '../testing/index.ts';

const issuer = 'https://keys.example';

const seconds = Math.floor(Date.now() / 1000);

const claims = { iss: issuer, sub: 'ada', aud: testPublicUrl, exp: seconds + 300, org_id: 'acme' };

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
