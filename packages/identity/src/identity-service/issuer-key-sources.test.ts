import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  identityServiceOf,
  issuerKeysAt,
  issuerKeysGiven,
  IssuerKeySetSchema,
  type IdentityService,
  type IssuerFetch,
  type IssuerKeySet,
  type IssuerKeySource,
} from '../index.ts';
import { fakeIssuer, hostedStudio, principalIn, testPublicUrl, type FakeIssuer } from '../testing/index.ts';

const startedAt = Date.parse('2026-10-13T09:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(startedAt);
});

afterEach(() => {
  vi.useRealTimers();
});

function after(milliseconds: number): void {
  vi.setSystemTime(startedAt + milliseconds);
}

interface Asking {
  readonly fetch: IssuerFetch;
  readonly asked: () => readonly string[];
}

function asking(answer: IssuerFetch): Asking {
  const asked: string[] = [];
  return {
    fetch: (request) => {
      asked.push(request.url);
      return answer(request);
    },
    asked: () => [...asked],
  };
}

const unreachable: IssuerFetch = () => Promise.reject(new TypeError('fetch failed'));

const answeringNoKeys: IssuerFetch = () => Promise.resolve(Response.json({ keys: [] }));

const decodeKeySet = Schema.decodeUnknownSync(IssuerKeySetSchema);

async function keySetOf(fake: FakeIssuer): Promise<IssuerKeySet> {
  const answer = await fake.answer(new Request(`${fake.issuer}/jwks`));
  return decodeKeySet(await answer.json());
}

function serviceOf(fake: FakeIssuer, fetch: IssuerFetch, issuerKeys?: IssuerKeySource): Promise<IdentityService> {
  return identityServiceOf(
    {
      issuer: fake.issuer,
      publicUrl: testPublicUrl,
      studio: hostedStudio,
      allowedOrigins: [],
      ...(issuerKeys === undefined ? {} : { issuerKeys }),
    },
    { fetch, now: Date.now },
  );
}

function signedBy(fake: FakeIssuer): Promise<string> {
  const seconds = Math.floor(startedAt / 1000);
  return fake.sign({
    iss: fake.issuer,
    sub: 'ada',
    name: 'Ada Lovelace',
    aud: testPublicUrl,
    exp: seconds + 3600,
    org_id: 'acme',
  });
}

async function callerOf(identityService: IdentityService, token: string): Promise<string | undefined> {
  return principalIn(await identityService.personOf(token, '/mcp'))?.callerIn('acme')?.id;
}

describe('the key set of an issuer when none is given', () => {
  it('is found through the metadata of the issuer, which names where it is read', async () => {
    const fake = fakeIssuer('https://login.example');
    const network = asking(fake.answer);
    const identityService = await serviceOf(fake, network.fetch);

    expect(await callerOf(identityService, await signedBy(fake))).toBe('person:ada');
    expect(network.asked()).toEqual([
      'https://login.example/.well-known/oauth-authorization-server',
      'https://login.example/jwks',
    ]);
  });
});

describe('the key set at a URL', () => {
  it('is read once at start, from that URL alone, and kept for ten minutes, after which it is read again', async () => {
    const fake = fakeIssuer('https://login.example');
    const network = asking(fake.answer);
    const identityService = await serviceOf(fake, network.fetch, issuerKeysAt('https://login.example/jwks'));
    const signed = await signedBy(fake);
    const atStart = await callerOf(identityService, signed);
    after(599_999);
    const beforeTheAge = await callerOf(identityService, signed);
    const readBeforeTheAge = network.asked();
    after(600_001);

    expect([atStart, beforeTheAge, await callerOf(identityService, signed)]).toEqual([
      'person:ada',
      'person:ada',
      'person:ada',
    ]);
    expect([readBeforeTheAge, network.asked()]).toEqual([
      ['https://login.example/jwks'],
      ['https://login.example/jwks', 'https://login.example/jwks'],
    ]);
  });

  it('stops the server at start, naming the service and the URL, when the key set there holds no keys', async () => {
    const fake = fakeIssuer('https://login.example');

    await expect(serviceOf(fake, answeringNoKeys, issuerKeysAt('https://keys.example/jwks'))).rejects.toMatchObject({
      name: 'UnusableIdentityServiceError',
      message:
        'The identity service at https://login.example cannot be used: its key set at https://keys.example/jwks holds no keys',
    });
  });
});

describe('the key set given', () => {
  it('verifies a token signed with one of its keys, and reads nothing of the issuer, at start or ten minutes on', async () => {
    const fake = fakeIssuer('https://login.example');
    const network = asking(unreachable);
    const identityService = await serviceOf(fake, network.fetch, issuerKeysGiven(await keySetOf(fake)));
    const signed = await signedBy(fake);
    const atStart = await callerOf(identityService, signed);
    after(600_001);

    expect([atStart, await callerOf(identityService, signed)]).toEqual(['person:ada', 'person:ada']);
    expect(network.asked()).toEqual([]);
  });

  it('refuses a token signed with a key it does not hold', async () => {
    const fake = fakeIssuer('https://login.example');
    const identityService = await serviceOf(fake, unreachable, issuerKeysGiven(await keySetOf(fake)));
    const another = fakeIssuer('https://login.example');

    expect(await identityService.personOf(await signedBy(another), '/mcp')).toEqual({
      because: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
    });
  });
});

const refusedKeySets: ReadonlyArray<readonly [string, unknown]> = [
  ['no keys', { keys: [] }],
  ['a key without a kty', { keys: [{ kid: 'one' }] }],
  ['keys that are no array', { keys: { kty: 'RSA' } }],
];

describe('the schema of a key set given', () => {
  it('takes a set of keys that each name their kty, keeping every member of each key', () => {
    const key = { kty: 'OKP', crv: 'Ed25519', x: 'AAAA', kid: 'one', use: 'sig', key_ops: ['verify'] };

    expect(decodeKeySet({ keys: [key] })).toEqual({ keys: [key] });
  });

  it.each(refusedKeySets)('refuses a set with %s', (_case, keySet) => {
    expect(Schema.is(IssuerKeySetSchema)(keySet)).toBe(false);
  });
});
