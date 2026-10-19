import { recordingOf } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConnectionCommand } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { registryDecider } from './registry-decider.ts';

const recorded = recordingOf(registryDecider.eventSchema);

const acted = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

const driveAdded: ConnectionEvent = {
  type: 'connection_added',
  data: {
    connection: 'drive-id',
    name: 'drive',
    server_type: 'mcp',
    provider: 'drive',
    placeholders: {},
    entry: { url: 'https://mcp.drive.example.com/mcp' },
    credential: { kind: 'authorization', issuer: 'https://accounts.drive.example.com' },
  },
};

const linkIssued: ConnectionEvent = {
  type: 'connection_link_issued',
  data: { connection: 'drive-id', token_sha256: 'a1b2', expires_at: '2026-10-15T14:10:00.000Z' },
};

function decided(command: ConnectionCommand, ...history: readonly ConnectionEvent[]) {
  const registry = history.reduce(
    (state, event) => registryDecider.evolve(state, recorded(event, acted)),
    registryDecider.initialState,
  );
  return registryDecider.decide(command, registry);
}

const byConsent =
  'The connection drive is connected by signing in to its provider and allowing Auto, which its page starts';

describe('a credential given to a connection of consent', () => {
  it('is refused, though the link is open', () => {
    const giving: ConnectionCommand = {
      type: 'give',
      connection: 'drive-id',
      token_sha256: 'a1b2',
      bindsPerson: true,
      secret_id: 'secret-1',
      ...acted,
    };

    expect(decided(giving, driveAdded, linkIssued)).toMatchObject(Result.fail({ detail: byConsent }));
  });
});
