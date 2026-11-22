import { readFileSync } from 'node:fs';

import type { ProviderList } from '@on.auto/providers';
import { drive, messages, providerListOf, providerOf, tracker } from '@on.auto/providers/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ConnectionEventSchema, type ConnectionAdded, type RecordedConnectionEvent } from './connection-events.ts';
import { connectionsFoldOf } from './registry-decider.ts';

const decodeFact = Schema.decodeUnknownSync(ConnectionEventSchema);

function recordedIn(release: string): RecordedConnectionEvent {
  return decodeFact(JSON.parse(readFileSync(new URL(`./${release}/connection_added.json`, import.meta.url), 'utf8')));
}

function actingOf(providers: ProviderList, facts: readonly RecordedConnectionEvent[]) {
  const { evolve, initialState } = connectionsFoldOf(providers);
  const [kept] = facts.reduce((registry, fact) => evolve(registry, fact), initialState).values();
  return [kept?.connection.credential.permissions, kept?.connection.account_type];
}

const none = providerListOf();

const files = { ...drive, name: 'files' };

describe('a connection an earlier release recorded, which records neither its permissions nor its account type', () => {
  it.each([
    ['0.46.0', none, ['delegated', 'personal']],
    ['0.49.0', none, ['delegated', 'personal']],
    ['0.49.0', providerListOf(providerOf(files)), ['delegated', 'personal']],
    ['0.57.0', none, ['delegated', 'personal']],
    ['0.59.0', none, ['delegated', 'personal']],
    ['0.60.0', providerListOf(providerOf(messages)), ['application', null]],
    ['0.60.0', none, ['delegated', 'personal']],
    ['0.69.0', none, ['delegated', 'personal']],
  ] as const)('of release %s reads, with its provider as the list declares it, as %o', (release, providers, acting) => {
    expect(actingOf(providers, [recordedIn(release)])).toEqual(acting);
  });
});

function addedFrom(provider: string | null, credential: ConnectionAdded['data']['credential']): ConnectionAdded {
  return {
    type: 'connection_added',
    data: {
      connection: 'connection-1',
      name: 'tracker',
      server_type: 'mcp',
      provider,
      placeholders: provider === null ? null : { site: 'acme' },
      entry: { url: 'https://acme.tracker.example.com/mcp' },
      credential,
      says: {},
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
    context: { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' },
  };
}

const [aKey] = tracker.credentials;

const key = { kind: 'secret', name: 'Authorization', in: 'header', scheme: 'Bearer' } as const;

function trackerWith(...ways: readonly unknown[]): ProviderList {
  return providerListOf(providerOf({ ...tracker, credentials: ways }));
}

describe('what an earlier connection of a provider is read as', () => {
  it.each([
    ['its way declares nothing', trackerWith(aKey), ['delegated', 'personal']],
    ['its way acts as the app', trackerWith({ ...aKey, permissions: 'application' }), ['application', null]],
    [
      'its way takes a service account alone',
      trackerWith({ ...aKey, account_types: ['service'] }),
      ['delegated', 'service'],
    ],
    [
      'two ways of its kind leave it to its kind',
      trackerWith(aKey, { ...aKey, permissions: 'application' }),
      ['delegated', 'personal'],
    ],
  ] as const)('where %s: %o', (_where, providers, acting) => {
    expect(actingOf(providers, [addedFrom('tracker', key)])).toEqual(acting);
  });

  it.each([
    [{ kind: 'client_credentials', issuer: 'https://auth.tracker.example.com' }, ['application', null]],
    [{ kind: 'none' }, [undefined, null]],
    [{ kind: 'reference', variable: 'TRACKER_KEY', name: 'Authorization', in: 'header' }, ['delegated', 'personal']],
  ] as const)('given by hand as %o, by its kind: %o', (credential, acting) => {
    expect(actingOf(none, [addedFrom(null, credential)])).toEqual(acting);
  });
});

describe('a connection this release recorded', () => {
  it('reads as it was recorded, whatever its provider declares now', () => {
    const recorded = addedFrom('tracker', { ...key, permissions: 'delegated' });
    const withItsType: ConnectionAdded = { ...recorded, data: { ...recorded.data, account_type: 'service' } };

    expect(actingOf(trackerWith({ ...aKey, permissions: 'application' }), [withItsType])).toEqual([
      'delegated',
      'service',
    ]);
  });

  it('takes the account type set after it was added', () => {
    const recorded = addedFrom(null, { ...key, permissions: 'delegated' });
    const setting: RecordedConnectionEvent = {
      type: 'connection_account_type_set',
      data: { connection: 'connection-1', account_type: 'service' },
      context: { by: 'person:grace', at: '2026-10-15T15:00:00.000Z' },
    };

    expect(actingOf(none, [recorded, setting])).toEqual(['delegated', 'service']);
  });
});
