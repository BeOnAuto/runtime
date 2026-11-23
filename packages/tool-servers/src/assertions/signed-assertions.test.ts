import type { FetchOfACall } from '@on.auto/operations';
import { Redacted, Schema } from 'effect';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { fakeMcpInProcess, inProcessFetch, type ClientRegistration, type FakeMcpServer } from '../testing/index.ts';
import { askingFetch, rsaKeys } from '../testing/token-sources.ts';
import { AssertionConflict } from './assertion-conflict.ts';
import { AssertionRefused } from './assertion-refused.ts';
import { assertedTokensOf, jwtBearerGrant, type Assertion } from './signed-assertions.ts';
import { TokenRequestFailed } from './token-request-failed.ts';

const robot = 'robot@acme.example.com';

const inbox = 'inbox@acme.example.com';

const readScope = 'https://mail.example.com/read';

const moment = Date.parse('2026-11-22T09:00:00.000Z');

const atTheMoment = { now: () => moment };

const aToken: unknown = expect.stringMatching(/^token-1-/u);

const keys = { publicKey: '', privateKey: '' };

const closing: (() => Promise<void>)[] = [];

beforeAll(() => {
  Object.assign(keys, rsaKeys());
});

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function issuer(changes: Partial<ClientRegistration> = {}): FakeMcpServer {
  const fake = fakeMcpInProcess({
    client: { clientId: robot, publicKey: keys.publicKey, expiresInSeconds: 3600, subjects: [inbox], ...changes },
  });
  closing.push(fake.close);
  return fake;
}

function assertionOf(fake: FakeMcpServer, changes: Partial<Assertion> = {}): Assertion {
  return {
    issuer: fake.origin,
    clientId: robot,
    subject: inbox,
    scope: readScope,
    privateKey: Redacted.make(keys.privateKey),
    algorithm: 'RS256',
    ...changes,
  };
}

const metadataOf = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

const tokensHost = 'tokens.example.com';

function answeringTokensWith(status: number, body = '') {
  return (...[address, init]: readonly [unknown, unknown?]) =>
    String(address).endsWith('/token')
      ? Promise.resolve(new Response(body, { status }))
      : inProcessFetch(String(address), Object.assign({}, init));
}

function sendingTokensTo(origin: string, sent: FetchOfACall) {
  return (...[address, init]: readonly [unknown, unknown?]) => {
    const url = new URL(String(address));
    return sent(url.hostname === tokensHost ? `${origin}${url.pathname}` : url.href, Object.assign({}, init));
  };
}

async function metadataNamingAPlainEndpoint(...[address, init]: readonly [unknown, unknown?]): Promise<Response> {
  const answer = await inProcessFetch(String(address), Object.assign({}, init));
  return String(address).includes('.well-known')
    ? Response.json({ ...metadataOf(await answer.json()), token_endpoint: `http://${tokensHost}/token` })
    : answer;
}

function sentAssertion(bodies: readonly Readonly<Record<string, string>>[], index = 0): string {
  return String(bodies[index]?.['assertion']);
}

describe('a token asked with a signed assertion', () => {
  it('asks the token endpoint the issuer’s metadata names, with the grant and an assertion of the client, the subject, the scope and the clock', async () => {
    const fake = issuer();
    const asking = askingFetch();

    const tokens = await assertedTokensOf(assertionOf(fake), { fetch: asking.fetch, ...atTheMoment });
    const assertion = sentAssertion(asking.bodies());

    expect(tokens).toEqual({ access_token: aToken, expires_in: 3600 });
    expect(asking.bodies().map((body) => Object.keys(body).toSorted())).toEqual([['assertion', 'grant_type']]);
    expect(asking.bodies()[0]?.['grant_type']).toBe(jwtBearerGrant);
    expect(decodeProtectedHeader(assertion)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decodeJwt(assertion)).toEqual({
      iss: robot,
      sub: inbox,
      aud: `${fake.origin}/token`,
      scope: readScope,
      iat: moment / 1000,
      exp: moment / 1000 + 300,
    });
  });

  it('gives the access token alone where the authorization server says no lifetime', async () => {
    const fake = issuer({ expiresInSeconds: null });

    expect(await assertedTokensOf(assertionOf(fake), { fetch: inProcessFetch, ...atTheMoment })).toEqual({
      access_token: aToken,
    });
  });
});

describe('the subject of a token asked', () => {
  it('is the account the assertion names, its claims in the order they always had, or none, for the client itself, where it names none', async () => {
    const fake = issuer({ subjects: [] });
    const namingTheInbox = issuer();
    const asking = askingFetch();

    const ofTheClient = await assertedTokensOf(assertionOf(fake, { subject: undefined }), {
      fetch: asking.fetch,
      ...atTheMoment,
    });
    await assertedTokensOf(assertionOf(namingTheInbox), { fetch: asking.fetch, ...atTheMoment });
    const itself = decodeJwt(sentAssertion(asking.bodies(), 0));
    const forTheInbox = decodeJwt(sentAssertion(asking.bodies(), 1));

    expect(ofTheClient).toEqual({ access_token: aToken, expires_in: 3600 });
    expect(itself).toEqual({
      iss: robot,
      aud: `${fake.origin}/token`,
      scope: readScope,
      iat: moment / 1000,
      exp: moment / 1000 + 300,
    });
    expect(Object.keys(forTheInbox)).toEqual(['scope', 'iss', 'sub', 'aud', 'iat', 'exp']);
    expect(forTheInbox).toMatchObject({ sub: inbox });
  });
});

describe('the assertion of a token asked', () => {
  it('lasts the lifetime it is given, and carries no scope where the way asks none', async () => {
    const fake = issuer();
    const asking = askingFetch();

    await assertedTokensOf(assertionOf(fake, { scope: undefined }), {
      fetch: asking.fetch,
      ...atTheMoment,
      lifetimeMs: 60_000,
    });
    const claims = decodeJwt(sentAssertion(asking.bodies()));

    expect(claims).toMatchObject({ iat: moment / 1000, exp: moment / 1000 + 60 });
    expect(claims).not.toHaveProperty('scope');
  });

  it('is signed for a token endpoint on another host than the issuer, where the issuer’s metadata names one there', async () => {
    const fake = issuer({ endpointHost: tokensHost });
    const asking = askingFetch();
    const told: string[] = [];

    await assertedTokensOf(assertionOf(fake), {
      fetch: (...[address, init]: readonly [unknown, unknown?]) => {
        told.push(new URL(String(address)).hostname);
        return sendingTokensTo(fake.origin, asking.fetch)(address, init);
      },
      ...atTheMoment,
    });

    expect(told.at(-1)).toBe(tokensHost);
    expect(decodeJwt(sentAssertion(asking.bodies()))).toMatchObject({ aud: `https://${tokensHost}/token` });
  });
});

describe('a signed assertion the authorization server does not take', () => {
  it.each([
    ['a subject the client may not act as', () => ({ subject: 'ceo@acme.example.com' }), 'unauthorized_client'],
    ['a key the client did not register', () => ({ privateKey: Redacted.make(rsaKeys().privateKey) }), 'invalid_grant'],
    ['another client', () => ({ clientId: 'other@acme.example.com' }), 'invalid_grant'],
  ])('is refused with the code it answers, for %s', async (_case, changed, code) => {
    const fake = issuer();

    const refused = assertedTokensOf(assertionOf(fake, changed()), { fetch: inProcessFetch, ...atTheMoment });

    await expect(refused).rejects.toBeInstanceOf(AssertionRefused);
    await expect(refused).rejects.toMatchObject({ code });
  });

  it.each([
    ['a limited rate', 429, '{"error":"rate_limited"}'],
    ['a failure of its own', 503, '{"error":"temporarily_unavailable"}'],
    ['a refusal with no code', 400, 'Bad Request'],
    ['a code that says to try later', 400, '{"error":"temporarily_unavailable"}'],
    ['a code that says it failed itself', 401, '{"error":"server_error"}'],
  ])('fails with its status, never as a refusal, for %s', async (_case, status, body) => {
    const fake = issuer();

    const failed = assertedTokensOf(assertionOf(fake), { fetch: answeringTokensWith(status, body), ...atTheMoment });

    await expect(failed).rejects.toBeInstanceOf(TokenRequestFailed);
    await expect(failed).rejects.toMatchObject({ status });
  });

  it('fails where an answer of success holds no access token', async () => {
    const fake = issuer();
    const noToken = answeringTokensWith(200, '{"token_type":"Bearer"}');

    await expect(assertedTokensOf(assertionOf(fake), { fetch: noToken, ...atTheMoment })).rejects.toThrow(Error);
  });
});

describe('a signed assertion never sent', () => {
  it('is one whose issuer’s metadata names another issuer, publishes none, or names a token endpoint off https', async () => {
    const mismatched = issuer({ issuer: 'https://elsewhere.example.com' });
    const unpublished = issuer({ publishesMetadata: false });
    const plain = issuer({ endpointHost: tokensHost });

    await expect(
      assertedTokensOf(assertionOf(mismatched), { fetch: inProcessFetch, ...atTheMoment }),
    ).rejects.toMatchObject({ refusal: { refused: 'another_issuer', named: 'https://elsewhere.example.com' } });
    await expect(
      assertedTokensOf(assertionOf(unpublished), { fetch: inProcessFetch, ...atTheMoment }),
    ).rejects.toBeInstanceOf(AssertionConflict);
    await expect(
      assertedTokensOf(assertionOf(plain), { fetch: metadataNamingAPlainEndpoint, ...atTheMoment }),
    ).rejects.toMatchObject({ refusal: { refused: 'unpinned_endpoint', endpoint: `http://${tokensHost}/token` } });
    expect([mismatched, unpublished, plain].map((fake) => fake.tokenRequests())).toEqual([0, 0, 0]);
  });
});
