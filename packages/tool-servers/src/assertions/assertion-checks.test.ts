import {
  AuthorizationServerMismatchError,
  IssuerMismatchError,
  OAuthError,
  OAuthErrorCode,
  type FetchLike,
} from '@modelcontextprotocol/client';
import { Redacted } from 'effect';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { fakeMcpInProcess, inProcessFetch, type ClientRegistration, type FakeMcpServer } from '../testing/index.ts';
import { rsaKeys } from '../testing/token-sources.ts';
import {
  assertionCheckedOf,
  descriptionShownOf,
  mintCheckedOf,
  mostDescriptionCharacters,
} from './assertion-checks.ts';
import type { Assertion } from './signed-assertions.ts';

const robot = 'robot@acme.example.com';

const inbox = 'inbox@acme.example.com';

const atTheMoment = { now: () => Date.parse('2026-11-22T09:00:00.000Z') };

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

function assertionOf(fake: FakeMcpServer, subject = inbox): Assertion {
  return {
    issuer: fake.origin,
    clientId: robot,
    subject,
    scope: 'https://mail.example.com/read',
    privateKey: Redacted.make(keys.privateKey),
    algorithm: 'RS256',
  };
}

function answeringTokensWith(status: number, body = '') {
  return (...[address, init]: readonly [unknown, unknown?]) =>
    String(address).endsWith('/token')
      ? Promise.resolve(new Response(body, { status }))
      : inProcessFetch(String(address), Object.assign({}, init));
}

function unreachable(): Promise<Response> {
  return Promise.reject(new TypeError('fetch failed'));
}

describe('the check of a signed assertion', () => {
  it('is taken, or refused with the code the authorization server answers', async () => {
    const fake = issuer();

    expect(
      await Promise.all([
        assertionCheckedOf(assertionOf(fake), { fetch: inProcessFetch, ...atTheMoment }),
        assertionCheckedOf(assertionOf(fake, 'ceo@acme.example.com'), { fetch: inProcessFetch, ...atTheMoment }),
      ]),
    ).toEqual([{ kind: 'taken' }, { kind: 'refused', code: 'unauthorized_client' }]);
  });

  it('is unreached at the hosts it asked where they cannot be reached, limit its rate, fail themselves or say to try later', async () => {
    const fake = issuer();
    const hosts = [new URL(fake.origin).hostname];
    const checked = (fetch: typeof inProcessFetch) => assertionCheckedOf(assertionOf(fake), { fetch, ...atTheMoment });

    expect(
      await Promise.all([
        checked(unreachable),
        checked(answeringTokensWith(429)),
        checked(answeringTokensWith(503)),
        checked(answeringTokensWith(400, '{"error":"temporarily_unavailable"}')),
      ]),
    ).toEqual(Array.from({ length: 4 }, () => ({ kind: 'unreached', hosts })));
  });
});

describe('the check of a signed assertion the authorization server answers with what cannot be used', () => {
  it('is the conflict of its metadata, or the call its token endpoint answered with no code or no token', async () => {
    const fake = issuer();
    const mismatched = issuer({ issuer: 'https://elsewhere.example.com' });
    const host = new URL(fake.origin).hostname;
    const checked = (fetch: typeof inProcessFetch) => assertionCheckedOf(assertionOf(fake), { fetch, ...atTheMoment });

    expect(
      await Promise.all([
        assertionCheckedOf(assertionOf(mismatched), { fetch: inProcessFetch, ...atTheMoment }),
        checked(answeringTokensWith(400, 'Bad Request')),
        checked(answeringTokensWith(200, '{"token_type":"Bearer"}')),
      ]),
    ).toEqual([
      {
        kind: 'conflicting',
        refusal: { refused: 'another_issuer', named: 'https://elsewhere.example.com', by: 'authorization_server' },
      },
      { kind: 'unanswered', call: { step: 'token', host, answer: { status: 400, retryAfterMs: null } } },
      { kind: 'unanswered', call: { step: 'token', host, answer: { failed: 'unreadable' } } },
    ]);
  });
});

const theTokenEndpoint = 'https://login.example.com/acme/token';

function failingAfterTheToken(thrown: unknown) {
  return async (fetch: FetchLike): Promise<never> => {
    await fetch(theTokenEndpoint);
    throw thrown;
  };
}

function checkedAfter(thrown: unknown, status = 401) {
  return mintCheckedOf(failingAfterTheToken(thrown), () => Promise.resolve(new Response(null, { status })));
}

const hostsAsked = ['login.example.com'];

const theIssuer = 'https://login.example.com/acme';

describe('the check of a token the MCP client asks for', () => {
  it('is refused with the code the authorization server answers, and its description on one line where it gives one', async () => {
    expect(
      await Promise.all([
        checkedAfter(new OAuthError(OAuthErrorCode.InvalidClient, 'Invalid client secret.\r\n  Trace ID: 0f3c ')),
        checkedAfter(OAuthError.fromResponse({ error: 'unauthorized_client' })),
      ]),
    ).toEqual([
      { kind: 'refused', code: 'invalid_client', description: 'Invalid client secret. Trace ID: 0f3c' },
      { kind: 'refused', code: 'unauthorized_client' },
    ]);
  });

  it('is unreached where the authorization server says to try later, answers a code that is not one, or answers it with a status of no refusal', async () => {
    const invalidClient = new OAuthError(OAuthErrorCode.InvalidClient, 'Invalid client secret.');
    expect(
      await Promise.all([
        checkedAfter(new OAuthError(OAuthErrorCode.ServerError, 'HTTP 503: Invalid OAuth error response')),
        checkedAfter(new OAuthError(OAuthErrorCode.TemporarilyUnavailable, 'Down for maintenance'), 400),
        checkedAfter(new OAuthError('not a code', 'Refused')),
        checkedAfter(invalidClient, 429),
        checkedAfter(invalidClient, 503),
        mintCheckedOf(() => Promise.reject(invalidClient), inProcessFetch),
      ]),
    ).toEqual([
      ...Array.from({ length: 5 }, () => ({ kind: 'unreached', hosts: hostsAsked })),
      { kind: 'unreached', hosts: [] },
    ]);
  });

  it('is the conflict of an issuer its metadata names, or of an authorization server its server names', async () => {
    expect(
      await Promise.all([
        checkedAfter(new IssuerMismatchError('metadata', theIssuer, 'https://elsewhere.example.com')),
        checkedAfter(new AuthorizationServerMismatchError(theIssuer, 'https://elsewhere.example.com')),
      ]),
    ).toEqual([
      {
        kind: 'conflicting',
        refusal: { refused: 'another_issuer', named: 'https://elsewhere.example.com', by: 'authorization_server' },
      },
      {
        kind: 'conflicting',
        refusal: { refused: 'another_issuer', named: 'https://elsewhere.example.com', by: 'server' },
      },
    ]);
  });
});

describe('the description of a refusal', () => {
  it.each([
    ['cut to the most characters shown', 'Invalid client secret', 7, { description: 'Invalid' }],
    ['shown whole within them', 'Invalid', 7, { description: 'Invalid' }],
    ['left out where it is only blanks', ' \r\n ', 7, {}],
    ['left out where it only repeats the code', 'invalid_client', 20, {}],
  ] as const)('is %s', (_, message, most, shown) => {
    expect(descriptionShownOf({ code: 'invalid_client', message }, most)).toEqual(shown);
  });

  it('shows at most 300 characters by default', () => {
    expect(mostDescriptionCharacters).toBe(300);
  });
});
