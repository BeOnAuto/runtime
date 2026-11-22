import { Redacted } from 'effect';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { fakeMcpInProcess, inProcessFetch, type ClientRegistration, type FakeMcpServer } from '../testing/index.ts';
import { rsaKeys } from '../testing/token-sources.ts';
import { assertionCheckedOf } from './assertion-checks.ts';
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
