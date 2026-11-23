import { Redacted } from 'effect';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { fakeMcpInProcess, inProcessFetch, type FakeMcpServer } from '../testing/index.ts';
import { rsaKeys } from '../testing/token-sources.ts';
import { AssertionRefused } from './assertion-refused.ts';
import { assertedTokensOf, type Assertion } from './signed-assertions.ts';
import { TokenRequestFailed } from './token-request-failed.ts';
import type { TokenRequest } from './token-requests.ts';

const appId = '1234567';

const tokensPath = '/apps/installations/7/tokens';

const moment = Date.parse('2026-11-22T09:00:00.000Z');

const anHourOn = '2026-11-22T10:00:00Z';

const aToken: unknown = expect.stringMatching(/^token-1-/u);

const keys = { publicKey: '', privateKey: '' };

const closing: (() => Promise<void>)[] = [];

beforeAll(() => {
  Object.assign(keys, rsaKeys());
});

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function service(): FakeMcpServer {
  const fake = fakeMcpInProcess({
    client: { clientId: appId, publicKey: keys.publicKey, expiresInSeconds: 3600, tokenRequestPath: tokensPath },
  });
  closing.push(fake.close);
  return fake;
}

const toTheTokenAlone: TokenRequest['issued'] = { access_token: '/token' };

function requestAt(origin: string, issued = toTheTokenAlone): TokenRequest {
  return { method: 'POST', url: `${origin}${tokensPath}`, issued };
}

function assertionOf(origin: string, changes: Partial<Assertion> = {}): Assertion {
  return {
    issuer: origin,
    clientId: appId,
    subject: undefined,
    scope: undefined,
    privateKey: Redacted.make(keys.privateKey),
    algorithm: 'RS256',
    tokenRequest: requestAt(origin, { access_token: '/token', expires_at: '/expires_at' }),
    ...changes,
  };
}

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

function recordingFetch(answer: (address: string, init: object) => Promise<Response>) {
  const sent: Sent[] = [];
  const fetch = async (...[address, init]: readonly [unknown, unknown?]) => {
    const request = new Request(String(address), Object.assign({}, init));
    const { url, method } = request;
    sent.push({ url, method, headers: Object.fromEntries(request.headers), body: await request.text() });
    return answer(String(address), Object.assign({}, init));
  };
  return { fetch, sent };
}

function answering(status: number, body: unknown) {
  return recordingFetch(() =>
    Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })),
  ).fetch;
}

function bearerOf(sent: readonly Sent[]): string {
  return String(sent[0]?.headers['authorization']).replace(/^Bearer /u, '');
}

const origin = 'https://api.service.example.com';

describe('a token asked through a request the service has of its own', () => {
  it('posts nothing but the signed assertion as the Bearer, to the address the request names, reading no metadata, the assertion naming the client and the clock alone, issued a minute back', async () => {
    const fake = service();
    const recording = recordingFetch(inProcessFetch);

    const tokens = await assertedTokensOf(assertionOf(fake.origin), { fetch: recording.fetch, now: () => moment });
    const signed = bearerOf(recording.sent);

    expect(tokens).toMatchObject({ access_token: aToken });
    expect(recording.sent.map(({ url, method, body }) => [url, method, body])).toEqual([
      [`${fake.origin}${tokensPath}`, 'POST', ''],
    ]);
    expect(recording.sent[0]?.headers['accept']).toBe('application/json');
    expect(decodeProtectedHeader(signed)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decodeJwt(signed)).toEqual({ iss: appId, iat: moment / 1000 - 60, exp: moment / 1000 + 300 });
    expect(fake.tokenRequests()).toBe(1);
  });
});

const answersOfAToken: readonly (readonly [string, unknown, unknown])[] = [
  ['a token and the time it ends', { token: 't-1', expires_at: anHourOn }, { access_token: 't-1', expires_in: 3600 }],
  ['no time it ends', { token: 't-1' }, { access_token: 't-1' }],
  ['a time it ends that is no time', { token: 't-1', expires_at: 'soon' }, { access_token: 't-1' }],
  ['a time already past', { token: 't-1', expires_at: '2026-11-22T08:00:00Z' }, { access_token: 't-1' }],
  ['a time that is not text', { token: 't-1', expires_at: 1_800_000_000 }, { access_token: 't-1' }],
];

const unreadableAnswers: readonly (readonly [string, unknown])[] = [
  ['no token', { expires_at: anHourOn }],
  ['an empty token', { token: '' }],
  ['a token that is not text', { token: 42 }],
  ['text that is not JSON', 'token=t-1'],
];

describe('the answer of a token request of its own', () => {
  it.each(answersOfAToken)(
    'gives the token and its end at the pointers the request names, from an answer of %s',
    async (_case, body, read) => {
      const fetch = answering(201, body);

      expect(await assertedTokensOf(assertionOf(origin), { fetch, now: () => moment })).toEqual(read);
    },
  );

  it('gives the token where a request names no pointer to its end', async () => {
    const fetch = answering(201, { access: { token: 't-2' }, expires_at: anHourOn });
    const tokenRequest = requestAt(origin, { access_token: '/access/token' });

    expect(await assertedTokensOf(assertionOf(origin, { tokenRequest }), { fetch, now: () => moment })).toEqual({
      access_token: 't-2',
    });
  });

  it.each(unreadableAnswers)('fails, as an answer it cannot read, where a success holds %s', async (_case, body) => {
    const failed = assertedTokensOf(assertionOf(origin), { fetch: answering(201, body), now: () => moment });

    await expect(failed).rejects.toBeInstanceOf(TokenRequestFailed);
    await expect(failed).rejects.toMatchObject({ status: 201, host: 'api.service.example.com', passing: false });
  });
});

const failingStatuses: readonly (readonly [number, boolean])[] = [
  [408, false],
  [429, true],
  [500, true],
  [503, true],
  [302, false],
];

describe('a token request the service does not answer with a token', () => {
  it.each([400, 401, 403, 404, 422])('is refused, naming the status, where it answers %i', async (status) => {
    const refused = assertedTokensOf(assertionOf(origin), {
      fetch: answering(status, { message: 'Not Found' }),
      now: () => moment,
    });

    await expect(refused).rejects.toBeInstanceOf(AssertionRefused);
    await expect(refused).rejects.toMatchObject({ code: `HTTP ${String(status)}` });
  });

  it.each(failingStatuses)(
    'fails with its status, never as a refusal, where it answers %i',
    async (status, passing) => {
      const failed = assertedTokensOf(assertionOf(origin), { fetch: answering(status, ''), now: () => moment });

      await expect(failed).rejects.toBeInstanceOf(TokenRequestFailed);
      await expect(failed).rejects.toMatchObject({ status, passing });
    },
  );

  it('is refused by a service for an assertion another key signed', async () => {
    const fake = service();
    const signedByAnother = assertionOf(fake.origin, { privateKey: Redacted.make(rsaKeys().privateKey) });

    await expect(assertedTokensOf(signedByAnother, { fetch: inProcessFetch, now: () => moment })).rejects.toMatchObject(
      { code: 'HTTP 401' },
    );
  });
});
