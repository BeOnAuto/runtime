import { fixtureProviders, providerListOf, providerOf } from '@on.auto/providers/testing';
import type { OrgConnection } from '@on.auto/tool-servers';
import { consentClientWith } from '@on.auto/tool-servers/testing';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeProviderOffering, makeProviderResolver } from '../index.ts';
import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { makeConnectionSource } from '../serving/connection-source.ts';
import { added } from '../testing/additions.ts';
import { ada, harness, harnessPages, operationNamed, type Harness } from '../testing/harness.ts';

const payments = providerOf({
  name: 'payments',
  title: 'Payments',
  description: 'Refund charges and pay out balances.',
  website: 'https://payments.example.com/mcp',
  type: 'mcp',
  url: 'https://mcp.payments.example.com',
  handles_money: true,
  credentials: [{ kind: 'none', description: 'No credential.' }],
});

const providers = providerListOf(...fixtureProviders.providers, payments);

const byProvider = { provider: 'payments', credential: { kind: 'none' } };

const byHand = {
  name: 'pay',
  type: 'mcp',
  entry: { url: 'https://mcp.payments.example.com' },
  credential: { kind: 'none' },
};

const tracked = { provider: 'tracker', placeholders: { site: 'acme' }, credential: { kind: 'none' } };

function addedIn(h: Harness, input: unknown) {
  return h.call(operationNamed(h.operations, 'add_connection'), ada, input);
}

function addedInTheListing(h: Harness, input: unknown) {
  return h.callListed(operationNamed(h.operations, 'add_connection'), ada, input);
}

const refused = {
  status: 'rejected',
  reason: 'unavailable',
  detail: 'The directory listing does not offer Payments, whose tools pay, refund, transfer or pay out money',
};

describe('a connection to a provider whose tools handle money, added through the directory listing', () => {
  it('is refused by the provider or by its address, and added through any other listing', async () => {
    const h = harness({ providers });

    expect([
      await addedInTheListing(h, byProvider),
      await addedInTheListing(h, byHand),
      await addedInTheListing(h, tracked),
      await addedIn(h, byProvider),
    ]).toMatchObject([refused, refused, { status: 'succeeded' }, { status: 'succeeded' }]);
  });
});

function serverOf(listed: OrgConnection | undefined) {
  return listed?.state.status === 'connected'
    ? listed.state.server
    : Effect.die(new Error('The connection is not connected'));
}

describe('a connection to a provider whose tools handle money', () => {
  it('is served, and its server read, as one that handles money', async () => {
    const h = harness({ providers });
    const { id, token } = await added(h, byProvider);
    await h.call(operationNamed(h.operations, 'approve'), ada, { id, token });
    const source = makeConnectionSource({
      registry: h.ledger.service,
      secrets: h.secrets,
      policy: connectionPolicyOf({}),
      variables: new Map(),
      modelProviders: [],
      providers,
      providerValues: new Map(),
      pages: harnessPages,
    });
    const [listed] = await Effect.runPromise(source.connectionsOf('acme'));
    const { settings } = await Effect.runPromise(serverOf(listed));

    expect([listed?.serving.handles_money, settings.handles_money]).toEqual([true, true]);
  });

  it('is offered with that said beside it', () => {
    const offering = makeProviderOffering({
      providers,
      providerValues: new Map(),
      policy: connectionPolicyOf({}),
      access: 'people',
      pages: harnessPages,
      consent: consentClientWith(),
    });

    expect(Effect.runSync(offering(ada))?.find(({ name }) => name === 'payments')).toMatchObject({
      handles_money: true,
    });
  });
});

describe('a tool server the configuration names by a provider whose tools handle money', () => {
  it('is read as one that handles money', () => {
    const resolved = makeProviderResolver(providers)({ provider: 'payments', placeholders: {}, credential: {} });

    expect(Result.map(resolved, ({ written }) => written.handles_money)).toEqual(Result.succeed(true));
  });
});
