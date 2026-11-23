import { recordingOf } from '@on.auto/operations';
import { providerListOf } from '@on.auto/providers/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConnectionCommand } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { connectionsStreamOfOrg, registryDeciderOf } from './registry-decider.ts';
import { mostConnectionsOfAnOrg } from './registry-decisions.ts';

const anyWords: unknown = expect.any(String);

const registryDecider = registryDeciderOf(providerListOf());

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
    says: {},
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
      data: { connection: 'crm-id', token_sha256: 'a1b2' },
    };
    const giving: ConnectionCommand = {
      type: 'give',
      connection: 'crm-id',
      token_sha256: 'a1b2',
      connected_by: { id: 'person:ada', name: 'Ada Lovelace' },
      secret_id: 'secret-1',
      ...acted,
    };

    expect(decided(giving, crmAdded, linkIssued)).toMatchObject(Result.fail({ detail: anyWords }));
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
  kind: 'credential_gone',
  reason: 'The credential of the connection crm cannot be read',
  ...acted,
};

describe('breaking a connection whose credential cannot be read', () => {
  it('records why for a connected one, and nothing for one that is pending, broken already or removed', () => {
    const brokenAlready: ConnectionEvent = {
      type: 'connection_broken',
      data: { connection: 'crm-id', kind: 'credential_gone', reason: 'Gone' },
    };
    const removed: ConnectionEvent = { type: 'connection_removed', data: { connection: 'crm-id' } };

    expect([
      decided(breaking, crmAdded, connected),
      decided(breaking, crmAdded),
      decided(breaking, crmAdded, connected, brokenAlready),
      decided(breaking, crmAdded, connected, removed),
    ]).toEqual([
      Result.succeed([
        { type: 'connection_broken', data: { connection: 'crm-id', kind: 'credential_gone', reason: breaking.reason } },
      ]),
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

const connectedAgain: ConnectionEvent = {
  type: 'connection_connected',
  data: { connection: 'crm-id', connected_by: { id: 'person:grace', name: 'Grace Hopper' } },
};

const anHourLater = { by: 'person:grace', at: '2026-10-15T15:00:00.000Z' };

type Acted = Readonly<typeof acted>;

function identifying(connectedAt: string, id = '7001', account?: string): ConnectionCommand {
  return {
    type: 'identify',
    connection: 'crm-id',
    connected_at: connectedAt,
    user: { id, name: 'sam' },
    ...(account === undefined ? {} : { account: { id: account } }),
    by: 'runtime',
    at: '2026-10-15T14:01:00.000Z',
  };
}

function identifiedAs(connectedAt: string, id = '7001', account?: string): ConnectionEvent {
  const named = account === undefined ? {} : { account: { id: account } };
  return {
    type: 'connection_identified',
    data: { connection: 'crm-id', connected_at: connectedAt, user: { id, name: 'sam' }, ...named },
  };
}

function decidedAfter(command: ConnectionCommand, ...history: readonly (readonly [ConnectionEvent, Acted])[]) {
  const registry = history.reduce(
    (state, [event, context]) => registryDecider.evolve(state, recorded(event, context)),
    registryDecider.initialState,
  );
  return registryDecider.decide(command, registry);
}

describe('recording the account a connection acts as', () => {
  it('records the answer once for a connecting, with the account it is in where the answer names one, and nothing for a second answer of the same connecting', () => {
    expect([
      decided(identifying(acted.at), crmAdded, connected),
      decided(identifying(acted.at, '7001', 'S-0042'), crmAdded, connected),
      decided(identifying(acted.at, '9', 'S-0042'), crmAdded, connected, identifiedAs(acted.at)),
    ]).toEqual([
      Result.succeed([identifiedAs(acted.at)]),
      Result.succeed([identifiedAs(acted.at, '7001', 'S-0042')]),
      Result.succeed([]),
    ]);
  });

  it('records nothing for an answer of an earlier connecting, nor for a connection pending, broken or removed', () => {
    const broken: ConnectionEvent = {
      type: 'connection_broken',
      data: { connection: 'crm-id', kind: 'credential_refused', reason: 'Refused' },
    };
    const removed: ConnectionEvent = { type: 'connection_removed', data: { connection: 'crm-id' } };

    expect([
      decidedAfter(identifying(acted.at), [crmAdded, acted], [connected, acted], [connectedAgain, anHourLater]),
      decided(identifying(acted.at), crmAdded),
      decided(identifying(acted.at), crmAdded, connected, broken),
      decided(identifying(acted.at), crmAdded, connected, removed),
    ]).toEqual([Result.succeed([]), Result.succeed([]), Result.succeed([]), Result.succeed([])]);
  });

  it('records the answer of a new connecting after a reconnect cleared the one before, and refuses an unknown connection', () => {
    expect(
      decidedAfter(
        identifying(anHourLater.at, '9'),
        [crmAdded, acted],
        [connected, acted],
        [identifiedAs(acted.at), acted],
        [connectedAgain, anHourLater],
      ),
    ).toEqual(Result.succeed([identifiedAs(anHourLater.at, '9')]));
    expect(decided(identifying(acted.at))).toMatchObject(Result.fail({ _tag: 'not_found' }));
  });
});

function settingPlaybooks(playbooks: readonly string[] | null): ConnectionCommand {
  return { type: 'set_playbooks', connection: 'crm-id', playbooks, ...acted };
}

describe('setting which playbooks may use a connection', () => {
  it('records the playbooks for a connection pending, connected or broken, whose entry names other playbooks', () => {
    const broken: ConnectionEvent = {
      type: 'connection_broken',
      data: { connection: 'crm-id', kind: 'credential_gone', reason: 'Gone' },
    };
    const set: ConnectionEvent = {
      type: 'connection_playbooks_set',
      data: { connection: 'crm-id', playbooks: ['sales'] },
    };

    expect([
      decided(settingPlaybooks(['sales']), crmAdded),
      decided(settingPlaybooks(['sales']), crmAdded, connected),
      decided(settingPlaybooks(['sales']), crmAdded, connected, broken),
    ]).toEqual([Result.succeed([set]), Result.succeed([set]), Result.succeed([set])]);
  });

  it('records nothing for the playbooks the connection serves already, in any order, and records any others', () => {
    const toSalesAndSupport: ConnectionEvent = {
      type: 'connection_playbooks_set',
      data: { connection: 'crm-id', playbooks: ['sales', 'support'] },
    };

    expect([
      decided(settingPlaybooks(null), crmAdded),
      decided(settingPlaybooks(['support', 'sales']), crmAdded, toSalesAndSupport),
      decided(settingPlaybooks(['support']), crmAdded, toSalesAndSupport),
      decided(settingPlaybooks(['sales', 'support', 'billing']), crmAdded, toSalesAndSupport),
      decided(settingPlaybooks(null), crmAdded, toSalesAndSupport),
    ]).toEqual([
      Result.succeed([]),
      Result.succeed([]),
      Result.succeed([{ type: 'connection_playbooks_set', data: { connection: 'crm-id', playbooks: ['support'] } }]),
      Result.succeed([
        {
          type: 'connection_playbooks_set',
          data: { connection: 'crm-id', playbooks: ['sales', 'support', 'billing'] },
        },
      ]),
      Result.succeed([{ type: 'connection_playbooks_set', data: { connection: 'crm-id', playbooks: null } }]),
    ]);
  });
});

describe('setting the playbooks of a connection that is not there', () => {
  it('is refused for a connection removed or unknown', () => {
    const removed: ConnectionEvent = { type: 'connection_removed', data: { connection: 'crm-id' } };

    expect([
      decided(settingPlaybooks(['sales']), crmAdded, removed),
      decided(settingPlaybooks(['sales'])),
    ]).toMatchObject([
      Result.fail({ _tag: 'conflict', detail: 'The connection crm is removed, so no playbook may use it' }),
      Result.fail({ _tag: 'not_found', detail: 'There is no connection crm-id in this org' }),
    ]);
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
      says: {},
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
      says: {},
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
      link: { token_sha256: 'c3d4' },
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
