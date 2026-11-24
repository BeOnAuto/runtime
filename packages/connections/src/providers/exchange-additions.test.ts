import { describe, expect, it } from 'vitest';

import { issuesIn, lastFact } from '../testing/additions.ts';
import { addedThe, exchanging, type Port } from '../testing/exchange-harness.ts';
import { managedWay, ownValues, ownWay, tokenEndpoint } from '../testing/exchanges.ts';
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
