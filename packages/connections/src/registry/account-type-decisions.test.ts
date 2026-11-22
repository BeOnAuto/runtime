import type { AccountType, ProviderList } from '@on.auto/providers';
import { providerListOf, providerOf, tracker } from '@on.auto/providers/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RecordedCredential } from './acting-fields.ts';
import type { ConnectionAdded, RecordedConnectionEvent } from './connection-events.ts';
import { registryDeciderOf } from './registry-decider.ts';

const acted = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

function added(credential: RecordedCredential, accountType?: AccountType): ConnectionAdded {
  return {
    type: 'connection_added',
    data: {
      connection: 'connection-1',
      name: 'tracker',
      server_type: 'mcp',
      provider: 'tracker',
      placeholders: { site: 'acme' },
      entry: { url: 'https://acme.tracker.example.com/mcp' },
      credential,
      ...(accountType === undefined ? {} : { account_type: accountType }),
      says: {},
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
    context: acted,
  };
}

const removed: RecordedConnectionEvent = {
  type: 'connection_removed',
  data: { connection: 'connection-1' },
  context: acted,
};

const key: RecordedCredential = { kind: 'secret', permissions: 'delegated', name: 'Authorization', in: 'header' };

const appKey: RecordedCredential = { ...key, permissions: 'application' };

const [aKey] = tracker.credentials;

function trackerWith(...ways: readonly unknown[]): ProviderList {
  return providerListOf(providerOf({ ...tracker, credentials: ways }));
}

const personalOnly = trackerWith({ ...aKey, account_types: ['personal'] });

const bothTypes = trackerWith(aKey, { ...aKey, permissions: 'application' });

interface Case {
  readonly providers: ProviderList;
  readonly facts: readonly RecordedConnectionEvent[];
  readonly accountType: AccountType;
}

function decided({ providers, facts, accountType }: Case) {
  const decider = registryDeciderOf(providers);
  const registry = facts.reduce((state, fact) => decider.evolve(state, fact), decider.initialState);
  const decision = decider.decide(
    { type: 'set_account_type', connection: 'connection-1', account_type: accountType, ...acted },
    registry,
  );
  return Result.isSuccess(decision) ? decision.success.map(({ type }) => type) : decision.failure;
}

const cases = [
  {
    name: 'records the type it changes to',
    providers: bothTypes,
    facts: [added(key, 'personal')],
    accountType: 'service',
    outcome: ['connection_account_type_set'],
  },
  {
    name: 'records nothing for the type it has',
    providers: bothTypes,
    facts: [added(key, 'service')],
    accountType: 'service',
    outcome: [],
  },
  {
    name: 'refuses a connection it does not hold',
    providers: bothTypes,
    facts: [],
    accountType: 'service',
    outcome: { _tag: 'not_found' },
  },
  {
    name: 'refuses a removed connection',
    providers: bothTypes,
    facts: [added(key, 'personal'), removed],
    accountType: 'service',
    outcome: { _tag: 'conflict' },
  },
  {
    name: 'refuses a connection that acts as the app',
    providers: bothTypes,
    facts: [added(appKey)],
    accountType: 'personal',
    outcome: { _tag: 'conflict' },
  },
  {
    name: 'refuses a connection that holds no credential',
    providers: bothTypes,
    facts: [added({ kind: 'none' })],
    accountType: 'personal',
    outcome: { _tag: 'conflict' },
  },
  {
    name: 'refuses a type its way does not take',
    providers: personalOnly,
    facts: [added(key, 'personal')],
    accountType: 'service',
    outcome: { _tag: 'invalid_input' },
  },
  {
    name: 'takes either type where its provider is gone',
    providers: providerListOf(),
    facts: [added(key, 'personal')],
    accountType: 'service',
    outcome: ['connection_account_type_set'],
  },
] as const;

describe('setting the account type of a connection', () => {
  it.each(cases)('$name', ({ outcome, ...given }) => {
    expect(decided(given)).toMatchObject(outcome);
  });
});
