import { recordingOf } from '@on.auto/operations';
import { providerListOf } from '@on.auto/providers/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConnectionCommand } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { registryDeciderOf } from './registry-decider.ts';

const registryDecider = registryDeciderOf(providerListOf());

const recorded = recordingOf(registryDecider.eventSchema);

const acted = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

const ada = { id: 'person:ada', name: 'Ada Lovelace' };

function decided(command: ConnectionCommand, ...history: readonly ConnectionEvent[]) {
  const registry = history.reduce(
    (state, event) => registryDecider.evolve(state, recorded(event, acted)),
    registryDecider.initialState,
  );
  return registryDecider.decide(command, registry);
}

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
    added_by: ada,
  },
};

const managedAdded: ConnectionEvent = {
  type: 'connection_added',
  data: {
    ...crmAdded.data,
    connection: 'mail-id',
    name: 'mail',
    provider: 'mail',
    placeholders: {},
    credential: {
      kind: 'token_exchange',
      permissions: 'application',
      token_endpoint: 'https://sts.mail.example.com/v1/token',
      service_account: 'managed',
    },
  },
};

const mailLinked: ConnectionEvent = {
  type: 'connection_link_issued',
  data: { connection: 'mail-id', token_sha256: 'c3d4' },
};

const created = {
  connection: 'mail-id',
  email: 'auto-1@connections.mail.example.com',
  id: '1049',
  placeholders: { project: '566645377701', account: 'auto-1@connections.mail.example.com' },
};

const accountCreated: ConnectionEvent = { type: 'connection_service_account_created', data: created };

const recording: ConnectionCommand = {
  type: 'record_service_account',
  token_sha256: 'c3d4',
  ...created,
  ...acted,
};

const approving: ConnectionCommand = {
  type: 'approve',
  connection: 'mail-id',
  token_sha256: 'c3d4',
  connected_by: ada,
  ...acted,
};

describe('the service account Auto creates for a connection', () => {
  it('is recorded once for a pending connection of that way, whose approval waits for it', () => {
    expect([
      decided(recording, managedAdded, mailLinked),
      decided(recording, managedAdded, mailLinked, accountCreated),
      decided(approving, managedAdded, mailLinked),
      decided(approving, managedAdded, mailLinked, accountCreated),
    ]).toEqual([
      Result.succeed([accountCreated]),
      Result.succeed([]),
      Result.fail(expect.objectContaining({ _tag: 'conflict' })),
      Result.succeed([
        { type: 'connection_approved', data: { connection: 'mail-id' } },
        { type: 'connection_connected', data: { connection: 'mail-id', connected_by: approving.connected_by } },
      ]),
    ]);
  });

  it('is refused for a connection of another way, and one already connected', () => {
    const crmLinked: ConnectionEvent = {
      type: 'connection_link_issued',
      data: { connection: 'crm-id', token_sha256: 'c3d4' },
    };
    const mailConnected: ConnectionEvent = {
      type: 'connection_connected',
      data: { connection: 'mail-id', connected_by: ada },
    };

    expect([
      decided({ ...recording, connection: 'crm-id' }, crmAdded, crmLinked),
      decided(recording, managedAdded, mailLinked, accountCreated, mailLinked, mailConnected, mailLinked),
    ]).toEqual([
      Result.fail(expect.objectContaining({ _tag: 'conflict' })),
      Result.fail(expect.objectContaining({ _tag: 'conflict' })),
    ]);
  });
});
