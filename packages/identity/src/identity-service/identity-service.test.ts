import { allPermissions } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { identityServiceOf, type IssuerFetch } from '../index.ts';
import {
  fakeIssuer,
  hostedStudio,
  principalIn,
  signedTokens,
  testPublicUrl,
  type Claims,
  type FakeSigner,
} from '../testing/index.ts';

const startedAt = Date.parse('2026-10-13T09:00:00Z');

const seconds = startedAt / 1000;

const atStart = { now: () => startedAt };

const signers: readonly FakeSigner[] = ['RS256', 'PS256', 'ES256', 'EdDSA'];

function segmentOf(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('a token signed by the identity service', () => {
  it.each(signers)('is verified when signed with %s', async (signer) => {
    const { token, callerOf } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await callerOf(await token({}, { signer }))).toBe('person:ada');
  });

  it.each(signers)('is refused when signed with %s by another key under the same kid', async (signer) => {
    const { identityService } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const other = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await other.token({}, { signer }), '/mcp')).toEqual({
      because: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    });
  });

  it.each([['at+jwt'], ['application/at+jwt'], ['JWT'], ['application/jwt'], [null]])(
    'is verified with the typ %s',
    async (typ) => {
      const { token, callerOf } = await signedTokens(fakeIssuer('https://login.example'), atStart);

      expect(await callerOf(await token({}, { typ }))).toBe('person:ada');
    },
  );

  it.each([
    ['the public URL', testPublicUrl, ''],
    ['the public URL with a slash', `${testPublicUrl}/`, '/mcp'],
    ['the public URL and the endpoint the request reached', `${testPublicUrl}/orgs/acme/mcp`, '/orgs/acme/mcp'],
    ['a list that holds the public URL', ['https://other.example', testPublicUrl], '/mcp'],
  ])('is verified for an audience of %s', async (_case, aud: string | readonly string[], resourcePath) => {
    const { token, callerOf } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await callerOf(await token({ aud }), resourcePath)).toBe('person:ada');
  });

  it('is verified within the 60 seconds of leeway around its times', async () => {
    const { token, callerOf } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await callerOf(await token({ exp: seconds - 59, nbf: seconds + 59, iat: seconds + 59 }))).toBe('person:ada');
  });
});

describe('the person a token names', () => {
  it('is admitted to the org its org_id claim names, with every permission its scopes grant over every playbook, and nowhere else', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const person = await identityService.personOf(await token({ org_id: 'globex', sub: 'user|ada/ü 1' }), '/mcp');

    expect(person).toMatchObject({
      own: {
        id: 'person:user|ada/ü 1',
        name: 'Ada Lovelace',
        org: 'globex',
        permissions: ['org:read', 'org:write', 'playbook:read', 'playbook:write'],
        playbooks: '*',
      },
    });
    expect(['globex', 'acme'].map((org) => principalIn(person)?.callerIn(org)?.org)).toEqual(['globex', undefined]);
  });
});

const readScopes = ['org:read', 'playbook:read'];

const grantedScopes: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ['every scope a sign-in asks for', 'user:org:read org:read org:write playbook:read playbook:write', allPermissions],
  ['the two read scopes', 'user:org:read org:read playbook:read', readScopes],
  ['none of the four permissions', 'user:org:read', []],
  [
    'scopes repeated, unknown, out of order or apart by two spaces',
    'playbook:read  openid org:read playbook:read',
    readScopes,
  ],
];

describe('the permissions of the person a token names', () => {
  it.each(grantedScopes)('are the permissions among its scopes, for %s', async (_case, scope, permissions) => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await token({ scope }), '/mcp')).toMatchObject({
      own: { id: 'person:ada', org: 'acme', permissions, playbooks: '*' },
    });
  });

  it('are none for a token without a scope claim, which still admits the person to their org', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const person = principalIn(await identityService.personOf(await token({ scope: undefined }), '/mcp'));

    expect(person?.callerIn('acme')).toEqual({
      id: 'person:ada',
      name: 'Ada Lovelace',
      org: 'acme',
      permissions: [],
      playbooks: '*',
    });
  });

  it('are the four for a token that holds them without user:org:read, since org_id is what binds the org', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const scope = allPermissions.join(' ');

    expect(await identityService.personOf(await token({ scope }), '/mcp')).toMatchObject({
      own: { id: 'person:ada', org: 'acme', permissions: allPermissions },
    });
  });
});

const refusedClaims: ReadonlyArray<readonly [string, Claims, string]> = [
  ['a wrong iss', { iss: 'https://elsewhere.example' }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its iss claim'],
  [
    'no aud, which makes it a session, whose org claim is o, not org_id',
    { aud: undefined },
    'ERR_JWT_CLAIM_VALIDATION_FAILED on its o claim',
  ],
  [
    'no aud, which makes it a session, and no azp',
    { aud: undefined, o: { id: 'acme' } },
    'ERR_JWT_CLAIM_VALIDATION_FAILED on its azp claim',
  ],
  ['an empty list as its aud', { aud: [] }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its aud claim'],
  ['an aud of another resource', { aud: 'https://other.example' }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its aud claim'],
  [
    'an aud of another endpoint',
    { aud: `${testPublicUrl}/orgs/globex/mcp` },
    'ERR_JWT_CLAIM_VALIDATION_FAILED on its aud claim',
  ],
  ['an exp past the leeway', { exp: seconds - 60 }, 'ERR_JWT_EXPIRED on its exp claim'],
  ['no exp', { exp: undefined }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its exp claim'],
  ['an nbf beyond the leeway', { nbf: seconds + 61 }, 'ERR_JWT_CLAIM_VALIDATION_FAILED on its nbf claim'],
  ['an iat beyond the leeway', { iat: seconds + 61 }, 'its iat is more than 60 seconds ahead'],
];

const refusedPersons: ReadonlyArray<readonly [string, Claims, string]> = [
  ['an org_id that is no org id', { org_id: 'ac me' }, 'its org_id claim is not an org id other than local'],
  ['the org of local mode', { org_id: 'local' }, 'its org_id claim is not an org id other than local'],
  ['an org_id that is not a string', { org_id: 7 }, 'its org_id claim is not an org id other than local'],
  [
    'an o and no org_id, since the o of a session names no org of an access token',
    { org_id: undefined, o: { id: 'acme' } },
    'ERR_JWT_CLAIM_VALIDATION_FAILED on its org_id claim',
  ],
  [
    'a scope that is not a string',
    { scope: ['org:read'] },
    'its scope claim is not a string of scopes separated by spaces',
  ],
];

describe('a token the runtime refuses, saying why', () => {
  it.each(refusedClaims)('is refused for %s', async (_case, claims, because) => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await token(claims), '/mcp')).toEqual({ because });
  });

  it.each(refusedPersons)('is refused for %s, with no org taken from anything else', async (_case, claims, because) => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await token(claims), '/mcp')).toEqual({ because });
  });
});

const noOrgClaim = { org_id: undefined, o: undefined };

const subjectAsOrgRefusal = 'its sub claim is not an org id other than local';

describe('the person a token that names no org names', () => {
  it('is admitted to the org of its sub, with the permissions its scopes grant over every playbook, and nowhere else', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const person = principalIn(
      await identityService.personOf(await token({ ...noOrgClaim, sub: 'user_2ada', scope: 'playbook:read' }), '/mcp'),
    );

    expect(person?.own).toEqual({
      id: 'person:user_2ada',
      name: 'Ada Lovelace',
      org: 'user_2ada',
      permissions: ['playbook:read'],
      playbooks: '*',
    });
    expect(['user_2ada', 'acme'].map((org) => person?.callerIn(org)?.org)).toEqual(['user_2ada', undefined]);
  });

  it.each([
    ['a sub that is no org id', 'user|ada'],
    ['the sub local, the org of local mode', 'local'],
  ])('is refused for %s, naming the claim the org would come from', async (_case, sub) => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await token({ ...noOrgClaim, sub }), '/mcp')).toEqual({
      because: subjectAsOrgRefusal,
    });
  });
});

describe('a token the runtime refuses for its form, saying why', () => {
  it('is refused for the typ of another kind of token', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await token({}, { typ: 'id_token+jwt' }), '/mcp')).toEqual({
      because: 'its typ is not that of an access token',
    });
  });

  it('is refused for the path form of its audience on a path that is no endpoint', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(await token({ aud: `${testPublicUrl}/orgs/acme/mcp` }), '')).toEqual({
      because: 'ERR_JWT_CLAIM_VALIDATION_FAILED on its aud claim',
    });
  });

  it('is refused for the algorithm none, and for a payload changed after it was signed', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'), atStart);
    const [header = '', payload = '', signature = ''] = (await token()).split('.');
    const claims = { iss: 'https://login.example', sub: 'ada', aud: testPublicUrl, exp: seconds + 300 };

    expect([
      await identityService.personOf(`${segmentOf({ alg: 'none', kid: 'rs256-1' })}.${payload}.`, '/mcp'),
      await identityService.personOf(`${header}.${segmentOf({ ...claims, org_id: 'globex' })}.${signature}`, '/mcp'),
    ]).toEqual([{ because: 'ERR_JOSE_ALG_NOT_ALLOWED' }, { because: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }]);
  });

  it.each([
    ['an opaque token', 'an-opaque-token-of-the-service'],
    ['a token of two segments', `${segmentOf({ alg: 'RS256' })}.${segmentOf({ sub: 'ada' })}`],
  ])('is refused for %s', async (_case, presented) => {
    const { identityService } = await signedTokens(fakeIssuer('https://login.example'), atStart);

    expect(await identityService.personOf(presented, '/mcp')).toEqual({ because: 'ERR_JWS_INVALID' });
  });
});

const answeringNothing: IssuerFetch = () => Promise.resolve(new Response('', { status: 404 }));

describe('the identity service of the protected resource', () => {
  it('is its one authorization server, with the public URL', async () => {
    const fake = fakeIssuer('https://login.example');
    const identityService = await identityServiceOf(
      { issuer: fake.issuer, publicUrl: testPublicUrl, studio: hostedStudio, allowedOrigins: [] },
      { fetch: fake.answer, ...atStart },
    );

    expect(identityService.resource).toEqual({
      publicUrl: testPublicUrl,
      authorizationServers: ['https://login.example'],
    });
  });

  it('stops the server at start, naming the service, when it cannot be read', async () => {
    await expect(
      identityServiceOf(
        { issuer: 'https://login.example', publicUrl: testPublicUrl, studio: hostedStudio, allowedOrigins: [] },
        { fetch: answeringNothing, now: Date.now },
      ),
    ).rejects.toMatchObject({
      name: 'UnusableIdentityServiceError',
      message:
        'The identity service at https://login.example cannot be used: no metadata of https://login.example could be used: https://login.example/.well-known/oauth-authorization-server answers 404; https://login.example/.well-known/openid-configuration answers 404',
    });
  });
});
