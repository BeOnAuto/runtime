import { recordingOf } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConnectionCommand } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { connectionsStreamOfOrg, registryDecider } from './registry-decider.ts';
import { mostConnectionsOfAnOrg } from './registry-decisions.ts';

const recorded = recordingOf(registryDecider.eventSchema);

const acted = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

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
    added_by: { id: 'person:ada', name: 'Ada Lovelace' },
  },
};

function decided(command: ConnectionCommand, ...history: readonly ConnectionEvent[]) {
  const registry = history.reduce(
    (state, event) => registryDecider.evolve(state, recorded(event, acted)),
    registryDecider.initialState,
  );
  return registryDecider.decide(command, registry);
}

describe('giving a credential to a connection that takes none', () => {
  it('is refused, though the link is open', () => {
    const linkIssued: ConnectionEvent = {
      type: 'connection_link_issued',
      data: { connection: 'crm-id', token_sha256: 'a1b2', expires_at: '2026-10-15T14:10:00.000Z' },
    };
    const giving: ConnectionCommand = {
      type: 'give',
      connection: 'crm-id',
      token_sha256: 'a1b2',
      bindsPerson: true,
      connected_by: { id: 'person:ada', name: 'Ada Lovelace' },
      secret_id: 'secret-1',
      ...acted,
    };

    expect(decided(giving, crmAdded, linkIssued)).toMatchObject(
      Result.fail({ detail: 'The connection crm takes no credential to give, so it is approved as it is' }),
    );
  });
});

describe('the stream of the connections of an org', () => {
  it('is named under the org, beside its playbooks', () => {
    expect(connectionsStreamOfOrg('acme')).toBe('org/acme/connections');
  });
});

const connected: ConnectionEvent = {
  type: 'connection_connected',
  data: { connection: 'crm-id', connected_by: { id: 'person:ada', name: 'Ada Lovelace' } },
};

const breaking: ConnectionCommand = {
  type: 'break',
  connection: 'crm-id',
  connected_at: acted.at,
  reason: 'The credential of the connection crm cannot be read',
  ...acted,
};

describe('breaking a connection whose credential cannot be read', () => {
  it('records why for a connected one, and nothing for one that is pending, broken already or removed', () => {
    const brokenAlready: ConnectionEvent = {
      type: 'connection_broken',
      data: { connection: 'crm-id', reason: 'Gone' },
    };
    const removed: ConnectionEvent = { type: 'connection_removed', data: { connection: 'crm-id' } };

    expect([
      decided(breaking, crmAdded, connected),
      decided(breaking, crmAdded),
      decided(breaking, crmAdded, connected, brokenAlready),
      decided(breaking, crmAdded, connected, removed),
    ]).toEqual([
      Result.succeed([{ type: 'connection_broken', data: { connection: 'crm-id', reason: breaking.reason } }]),
      Result.succeed([]),
      Result.succeed([]),
      Result.succeed([]),
    ]);
  });

  it('records nothing for a connection connected again since the use that found it broken', () => {
    const foundAnHourBefore: ConnectionCommand = { ...breaking, connected_at: '2026-10-15T13:00:00.000Z' };

    expect(decided(foundAnHourBefore, crmAdded, connected)).toEqual(Result.succeed([]));
  });
});

function addedAs(index: number): ConnectionEvent {
  return {
    type: 'connection_added',
    data: {
      connection: `id-${index}`,
      name: `crm-${index}`,
      server_type: 'mcp',
      provider: null,
      placeholders: null,
      entry: { url: 'https://crm.example.com/mcp' },
      credential: { kind: 'none' },
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
  };
}

describe('adding a connection to an org that holds the most it may', () => {
  it('is refused, and a removed connection leaves room for another', () => {
    const full = Array.from({ length: mostConnectionsOfAnOrg }, (_, index) => addedAs(index));
    const adding: ConnectionCommand = {
      type: 'add',
      connection: 'wiki-id',
      name: 'wiki',
      server_type: 'mcp',
      provider: null,
      placeholders: null,
      entry: { url: 'https://wiki.example.com/mcp' },
      credential: { kind: 'none' },
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
      link: { token_sha256: 'c3d4', expires_at: '2026-10-15T14:10:00.000Z' },
      ...acted,
    };
    const removedOne: ConnectionEvent = { type: 'connection_removed', data: { connection: 'id-0' } };

    expect(decided(adding, ...full)).toMatchObject(
      Result.fail({
        detail: `The org holds ${mostConnectionsOfAnOrg} connections, the most it may; remove one before adding another`,
        kind: 'connections_full',
      }),
    );
    expect(Result.isSuccess(decided(adding, ...full, removedOne))).toBe(true);
  });
});
