import { Option, Result, Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { additionOfProvider, exchangeOfProvider, type GivenToProvider, type ProviderEntry } from '../index.ts';
import { decodedEntry } from '../testing/entry-problems.ts';
import { asAManagedServiceAccount, asTheCompanysServiceAccount, mail } from '../testing/own-app-providers.ts';

const anyWords: unknown = expect.any(String);

function resolved(provider: ProviderEntry, given: GivenToProvider) {
  return Result.getOrThrow(additionOfProvider(provider, given));
}

function refused(provider: ProviderEntry, given: GivenToProvider) {
  return Result.getOrThrow(Result.flip(additionOfProvider(provider, given)));
}

const exchanging = decodedEntry({ ...mail, credentials: [asTheCompanysServiceAccount, asAManagedServiceAccount] });

const [ownWay, managedWay] = exchanging.credentials;

const ownValues = { project: '123456789012', account: 'robot@acme.example.com' };

describe('the addition a provider of a way that exchanges a token makes', () => {
  it('records the endpoint, and asks the values of the company’s own account but none of an account Auto creates', () => {
    expect([
      resolved(exchanging, { kind: 'token_exchange', placeholders: ownValues }).credential,
      resolved({ ...exchanging, credentials: [asAManagedServiceAccount] }, {}).credential,
      refused({ ...exchanging, credentials: [asAManagedServiceAccount] }, { placeholders: ownValues }),
    ]).toMatchObject([
      { kind: 'token_exchange', token_endpoint: 'https://sts.mail.example.com/v1/token', scope: 'mail.read' },
      { kind: 'token_exchange', service_account: 'managed' },
      [{ pointer: '/placeholders/project' }, { pointer: '/placeholders/account' }],
    ]);
  });
});

describe('an addition through the way of the company’s own account that gives none of its values', () => {
  it('is taken with no values, and one that gives some of them is checked for the rest', () => {
    expect([
      resolved(exchanging, { kind: 'token_exchange' }),
      refused(exchanging, { kind: 'token_exchange', placeholders: { project: ownValues.project } }),
    ]).toMatchObject([
      {
        placeholders: {},
        credential: { kind: 'token_exchange', token_endpoint: 'https://sts.mail.example.com/v1/token' },
      },
      [{ pointer: '/placeholders/account', detail: anyWords }],
    ]);
  });

  it('leaves the exchange unplaced until the values are given', () => {
    const way = Option.getOrThrow(Option.fromNullishOr(ownWay));

    expect(Result.getOrThrow(Result.flip(exchangeOfProvider(exchanging, way, {})))).toEqual([
      { pointer: '/placeholders/project', detail: anyWords },
      { pointer: '/placeholders/account', detail: anyWords },
    ]);
  });
});

describe('the exchange a way places', () => {
  it('places its values in the audiences and the impersonation address', () => {
    expect(
      Result.getOrThrow(exchangeOfProvider(exchanging, Option.getOrThrow(Option.fromNullishOr(ownWay)), ownValues)),
    ).toEqual({
      token_endpoint: 'https://sts.mail.example.com/v1/token',
      audience: '//identity.mail.example.com/projects/123456789012/pools/auto/providers/auto',
      subject_token: {
        type: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'https://identity.mail.example.com/projects/123456789012/pools/auto/providers/auto',
      },
      parameters: {
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: 'https://mail.example.com/auth/platform',
      },
      impersonation: {
        method: 'POST',
        url: 'https://credentials.mail.example.com/v1/accounts/robot@acme.example.com:token',
        request: { scope: '/scope' },
        issued: { access_token: '/accessToken', expires_at: '/expireTime' },
      },
      scope: 'mail.read',
    });
  });
});

describe('an exchange a way cannot place', () => {
  it.each([
    ['token_endpoint', { token_endpoint: 'http://sts.mail.example.com/v1/token' }],
    [
      'impersonation/url',
      { impersonation: { ...asTheCompanysServiceAccount.impersonation, url: 'ftp://x/{account}' } },
    ],
  ] as const)('is refused where its %s is not an https address once placed', (field, changes) => {
    const way = { ...Option.getOrThrow(Option.fromNullishOr(managedWay)), ...changes };

    expect(Result.getOrThrow(Result.flip(exchangeOfProvider(exchanging, way, ownValues)))).toEqual([
      { pointer: `/credential/${field}`, detail: anyWords },
    ]);
  });
});

describe('an exchange with nothing beside the token', () => {
  it('places an exchange with no parameters and no impersonation', () => {
    const way = Struct.omit(Option.getOrThrow(Option.fromNullishOr(ownWay)), ['parameters', 'impersonation']);

    expect(Result.getOrThrow(exchangeOfProvider(exchanging, way, ownValues))).toEqual({
      token_endpoint: 'https://sts.mail.example.com/v1/token',
      audience: '//identity.mail.example.com/projects/123456789012/pools/auto/providers/auto',
      subject_token: {
        type: 'urn:ietf:params:oauth:token-type:jwt',
        audience: 'https://identity.mail.example.com/projects/123456789012/pools/auto/providers/auto',
      },
      scope: 'mail.read',
    });
  });
});

describe('an exchange with values that do not fit', () => {
  it('is refused where a value does not fit the way', () => {
    const way = Option.getOrThrow(Option.fromNullishOr(ownWay));

    expect(Result.isFailure(exchangeOfProvider(exchanging, way, { ...ownValues, project: 'acme' }))).toBe(true);
  });
});
