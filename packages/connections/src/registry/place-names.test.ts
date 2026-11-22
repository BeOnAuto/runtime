import { changeCatalogOf, recordingOf } from '@on.auto/operations';
import { providerListOf } from '@on.auto/providers/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionChanges } from './connection-changes.ts';
import type { ConnectionCommand } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { registryDeciderOf } from './registry-decider.ts';

const registryDecider = registryDeciderOf(providerListOf());

const recorded = recordingOf(registryDecider.eventSchema);

const acted = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

const posted = 'com.example.chat.post';

const crmAdded: ConnectionEvent = {
  type: 'connection_added',
  data: {
    connection: 'crm-id',
    name: 'crm',
    server_type: 'mcp',
    provider: null,
    placeholders: null,
    entry: { url: 'https://crm.example.com/mcp' },
    credential: { kind: 'none' },
    says: {},
    added_by: { id: 'person:ada', name: 'Ada Lovelace' },
  },
};

const connected: ConnectionEvent = {
  type: 'connection_connected',
  data: { connection: 'crm-id', connected_by: { id: 'person:ada', name: 'Ada Lovelace' } },
};

const broken: ConnectionEvent = {
  type: 'connection_broken',
  data: { connection: 'crm-id', kind: 'credential_refused', reason: 'Refused' },
};

const removed: ConnectionEvent = { type: 'connection_removed', data: { connection: 'crm-id' } };

function decided(command: ConnectionCommand, ...history: readonly ConnectionEvent[]) {
  const registry = history.reduce(
    (state, event) => registryDecider.evolve(state, recorded(event, acted)),
    registryDecider.initialState,
  );
  return registryDecider.decide(command, registry);
}

function naming(connectedAt: string, name = 'support', subject = 'C1'): ConnectionCommand {
  return {
    type: 'name_place',
    connection: 'crm-id',
    connected_at: connectedAt,
    event_type: posted,
    subject,
    name,
    by: 'runtime',
    at: '2026-10-15T14:01:00.000Z',
  };
}

function namedAs(connectedAt: string, name = 'support', subject = 'C1'): ConnectionEvent {
  return {
    type: 'connection_place_named',
    data: { connection: 'crm-id', connected_at: connectedAt, event_type: posted, subject, name },
  };
}

const anotherPlace = naming(acted.at, 'support', 'C2');

describe('recording the name of a place a connection reaches', () => {
  it.each([
    ['a first name of the place', [crmAdded, connected], naming(acted.at), [namedAs(acted.at)]],
    ['the same name again', [crmAdded, connected, namedAs(acted.at)], naming(acted.at), []],
    ['another name', [crmAdded, connected, namedAs(acted.at)], naming(acted.at, 'help'), [namedAs(acted.at, 'help')]],
    ['another place', [crmAdded, connected, namedAs(acted.at)], anotherPlace, [namedAs(acted.at, 'support', 'C2')]],
    ['a connection pending', [crmAdded], naming(acted.at), []],
    ['a connection broken', [crmAdded, connected, broken], naming(acted.at), []],
    ['a connection removed', [crmAdded, connected, removed], naming(acted.at), []],
    ['an earlier connecting', [crmAdded, connected], naming('2026-10-15T13:00:00.000Z'), []],
  ] as const)('records for %s what is new', (_named, history, command, facts) => {
    expect(decided(command, ...history)).toEqual(Result.succeed(facts));
  });

  it('refuses an unknown connection', () => {
    expect(decided(naming(acted.at))).toMatchObject(Result.fail({ _tag: 'not_found' }));
  });
});

describe('the change the name of a place makes', () => {
  it('names nothing, since no read of the connection answers it', () => {
    const data = { connection: 'c1', connected_at: acted.at, event_type: posted, subject: 'C1', name: 'support' };
    const fact = { id: 'm1', stream: 'connections', type: 'connection_place_named', data, context: acted };

    expect(changeCatalogOf([connectionChanges]).changesOf(fact)).toEqual([]);
  });
});
