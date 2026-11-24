import { asAManagedServiceAccount, asTheCompanysServiceAccount, signingInToMail } from '@on.auto/providers/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { added, adding, issuesIn, lastFact } from '../testing/additions.ts';
import { addedThe, exchanging, type Port } from '../testing/exchange-harness.ts';
import { exchangeProvidersWith, managedWay, ownValues, ownWay, tokenEndpoint } from '../testing/exchanges.ts';
import { ada, operationNamed } from '../testing/harness.ts';

describe('a connection added by the way of the company’s own service account', () => {
  it('records the values the person gives and the endpoint of the exchange', async () => {
    const { h } = exchanging();

    const own = await addedThe(h, ownWay, { placeholders: ownValues });

    expect(await lastFact(h)).toMatchObject({ connection: own.id });
    expect((await h.facts())[0]?.data).toMatchObject({
      placeholders: ownValues,
      credential: { kind: 'token_exchange', token_endpoint: tokenEndpoint },
    });
  });
});

describe('a connection added by the way of a service account Auto creates', () => {
  it('asks the person for no values and records the way as managed', async () => {
    const { h } = exchanging();

    await addedThe(h, managedWay);

    expect((await h.facts())[0]?.data).toMatchObject({
      placeholders: {},
      credential: { kind: 'token_exchange', service_account: 'managed' },
    });
  });
});

const signingInOrExchanging = exchangeProvidersWith(
  signingInToMail,
  asTheCompanysServiceAccount,
  asAManagedServiceAccount,
);

interface Taken {
  readonly credential: Readonly<Record<string, unknown>>;
  readonly accountType?: string;
}

const takenWhereNoneIsNamed: readonly (readonly [string, readonly Port[], Readonly<Record<string, string>>, Taken])[] =
  [
    [
      'the service account Auto creates, before the company’s own and a sign-in, where it is created here',
      [],
      {},
      { credential: { kind: 'token_exchange', service_account: 'managed' } },
    ],
    [
      'the company’s own service account, where its values are given',
      [],
      ownValues,
      { credential: { kind: 'token_exchange', token_endpoint: tokenEndpoint } },
    ],
    [
      'the company’s own service account, given no values, where none is created here',
      ['managedServiceAccounts'],
      {},
      { credential: { kind: 'token_exchange', token_endpoint: tokenEndpoint } },
    ],
    [
      'a sign-in as a service account, where no token is exchanged here',
      ['subjectTokens', 'managedServiceAccounts'],
      {},
      { credential: { kind: 'authorization', permissions: 'delegated' }, accountType: 'service' },
    ],
  ];

const AddedFactSchema = Schema.Struct({
  data: Schema.Struct({
    credential: Schema.Record(Schema.String, Schema.Unknown),
    placeholders: Schema.Record(Schema.String, Schema.String),
    account_type: Schema.optionalKey(Schema.String),
  }),
});

describe('a connection added with no way named', () => {
  it.each(takenWhereNoneIsNamed)('takes %s', async (_case, without, placeholders, taken) => {
    const { h } = exchanging({ providers: signingInOrExchanging }, without);

    await added(h, { provider: 'mail', placeholders });
    const { data } = Schema.decodeUnknownSync(AddedFactSchema)((await h.facts())[0]);

    expect(data).toMatchObject({ credential: taken.credential, placeholders });
    expect('service_account' in data.credential).toBe('service_account' in taken.credential);
    expect(data.account_type).toBe(taken.accountType);
  });

  it.each([
    ['where a service account is created here', []],
    ['where none is', ['managedServiceAccounts']],
  ] as const)('is refused given some of the company’s own values, %s', async (_where, without) => {
    const { h } = exchanging({ providers: signingInOrExchanging }, without);

    const outcome = await adding(h, { provider: 'mail', placeholders: { project: ownValues.project } });

    expect(outcome).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(await h.facts()).toEqual([]);
  });

  it('records a sign-in as a person’s own account where the way is named by its kind, as before', async () => {
    const { h } = exchanging({ providers: signingInOrExchanging });

    await addedThe(h, { kind: 'authorization' });

    expect((await h.facts())[0]?.data).toMatchObject({
      credential: { kind: 'authorization' },
      account_type: 'personal',
    });
  });
});

const namedWays: readonly (readonly [string, Readonly<Record<string, unknown>>, Readonly<Record<string, string>>])[] = [
  ['a sign-in', { kind: 'authorization' }, {}],
  ['the company’s own service account, given no values', ownWay, {}],
  ['the company’s own service account, given its values', ownWay, ownValues],
];

const createdHereOrNot: readonly (readonly Port[])[] = [[], ['managedServiceAccounts']];

describe('a connection added with its way named', () => {
  it.each(namedWays)('takes %s, whether or not a service account is created here', async (_named, way, values) => {
    const taken = await Promise.all(
      createdHereOrNot.map(async (without) => {
        const { h } = exchanging({ providers: signingInOrExchanging }, without);
        await addedThe(h, way, { placeholders: values });
        return Schema.decodeUnknownSync(AddedFactSchema)((await h.facts())[0]).data;
      }),
    );

    expect(taken).toMatchObject([
      { credential: way, placeholders: values },
      { credential: way, placeholders: values },
    ]);
    expect(taken.map(({ credential }) => 'service_account' in credential)).toEqual([false, false]);
  });
});

const byHand = { name: 'mail', type: 'mcp', entry: { url: 'https://mcp.mail.example.com/mcp' } };

const refusedAdditions: readonly (readonly [string, Readonly<Record<string, unknown>>, string])[] = [
  [
    'values given for the way of a service account Auto creates',
    { provider: 'mail', credential: managedWay, placeholders: ownValues },
    '/placeholders/project',
  ],
  [
    'service_account beside another kind',
    { provider: 'mail', credential: { kind: 'secret', service_account: 'managed' } },
    '/credential/service_account',
  ],
  ['service_account without provider', { ...byHand, credential: managedWay }, '/credential/service_account'],
  ['a server given by hand exchanging a token', { ...byHand, credential: ownWay }, '/credential/kind'],
];

describe('an addition of a way that exchanges a token, refused', () => {
  it.each(refusedAdditions)('is refused for %s, and records nothing', async (_named, input, pointer) => {
    const { h } = exchanging();

    const outcome = await h.call(operationNamed(h.operations, 'add_connection'), ada, input);

    expect(outcome).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(issuesIn(outcome).map((issue) => issue.pointer)).toContain(pointer);
    expect(await h.facts()).toEqual([]);
  });
});

const managedListed = { kind: 'token_exchange', service_account: 'managed', read_only: true };

const listings: readonly (readonly [string, readonly Port[], readonly unknown[]])[] = [
  ['no subject tokens are signed here', ['subjectTokens'], []],
  [
    'no service accounts are created here',
    ['managedServiceAccounts'],
    [{ name: 'mail', credentials: [{ kind: 'token_exchange' }] }],
  ],
  ['both are', [], [{ name: 'mail', credentials: [{ kind: 'token_exchange' }, managedListed] }]],
];

describe('the ways that exchange a token, as they are listed', () => {
  it.each(listings)('are listed where %s', async (_named, without, providers) => {
    const { h } = exchanging({}, without);

    expect(await h.call(operationNamed(h.operations, 'list_providers'), ada)).toMatchObject({
      status: 'succeeded',
      output: { providers },
    });
  });

  it('refuses the way of a service account Auto creates where no service account is created here', async () => {
    const { h } = exchanging({}, ['managedServiceAccounts']);

    const outcome = await h.call(operationNamed(h.operations, 'add_connection'), ada, {
      provider: 'mail',
      credential: managedWay,
    });

    expect(outcome).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(await h.facts()).toEqual([]);
  });
});
