import { recordingOf } from '@on.auto/operations';
import { providerListOf } from '@on.auto/providers/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConnectionAddition, ConnectionCommand } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { registryDeciderOf } from './registry-decider.ts';

const anyWords: unknown = expect.any(String);

const registryDecider = registryDeciderOf(providerListOf());

const recorded = recordingOf(registryDecider.eventSchema);

const acted = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

const ada = { id: 'person:ada', name: 'Ada Lovelace' };

const filesAdded: ConnectionEvent = {
  type: 'connection_added',
  data: {
    connection: 'files-id',
    name: 'files',
    server_type: 'mcp',
    provider: 'files',
    placeholders: {},
    entry: { url: 'https://mcp.files.example.com/mcp', playbooks: ['sales'] },
    credential: { kind: 'authorization', issuer: 'https://accounts.files.example.com' },
    says: {},
    added_by: ada,
  },
};

const link = { token_sha256: 'c3d4', expires_at: '2026-10-16T14:00:00.000Z' };

const messagesAdded: ConnectionAddition = {
  type: 'add',
  connection: 'messages-id',
  name: 'files',
  server_type: 'openapi',
  provider: 'messages',
  placeholders: {},
  entry: { document: 'https://gateway.messages.example.com/openapi.json', playbooks: ['sales'] },
  credential: { kind: 'authorization', issuer: 'https://messages.example.com' },
  says: {},
  added_by: ada,
  link,
};

interface Pressed {
  readonly by?: string;
  readonly takesOver?: boolean;
  readonly whilePending?: boolean;
}

function replacing({ by = acted.by, takesOver = false, whilePending = false }: Pressed = {}): ConnectionCommand {
  return {
    type: 'replace',
    connection: 'files-id',
    bindsPerson: true,
    takesOver,
    whilePending,
    addition: messagesAdded,
    ...acted,
    by,
  };
}

function decided(command: ConnectionCommand, ...history: readonly ConnectionEvent[]) {
  const registry = history.reduce(
    (state, event) => registryDecider.evolve(state, recorded(event, acted)),
    registryDecider.initialState,
  );
  return registryDecider.decide(command, registry);
}

const { link: _link, type: _type, ...addedData } = messagesAdded;

describe('a connection replaced by its addition from another provider', () => {
  it('is removed, and the addition recorded under the same name with its link, in one decision', () => {
    expect(decided(replacing(), filesAdded)).toEqual(
      Result.succeed([
        { type: 'connection_removed', data: { connection: 'files-id' } },
        { type: 'connection_added', data: addedData },
        { type: 'connection_link_issued', data: { connection: 'messages-id', ...link } },
      ]),
    );
  });

  it('is refused to anyone but the person who added it, where people sign in, and when it is removed or unknown', () => {
    const removed: ConnectionEvent = { type: 'connection_removed', data: { connection: 'files-id' } };

    expect(decided(replacing({ by: 'person:grace' }), filesAdded)).toMatchObject({
      failure: {
        _tag: 'forbidden',
        detail: anyWords,
      },
    });
    expect(decided(replacing(), filesAdded, removed)).toMatchObject({
      failure: {
        _tag: 'conflict',
        detail: anyWords,
      },
    });
    expect(decided(replacing())).toMatchObject({ failure: { _tag: 'not_found' } });
  });
});

describe('a connection replaced by a person the admission found may take it over', () => {
  it('is decided for them, whoever added it, but never once it is removed', () => {
    const removed: ConnectionEvent = { type: 'connection_removed', data: { connection: 'files-id' } };
    const takenOver = replacing({ by: 'person:grace', takesOver: true });

    expect(Result.isSuccess(decided(takenOver, filesAdded))).toBe(true);
    expect(decided(takenOver, filesAdded, removed)).toMatchObject({ failure: { _tag: 'conflict' } });
  });

  it('is decided only while the connection waits to be connected, where it is added again while pending', () => {
    const connected: ConnectionEvent = {
      type: 'connection_connected',
      data: { connection: 'files-id', connected_by: ada },
    };
    const whilePending = replacing({ by: 'person:grace', takesOver: true, whilePending: true });

    expect(Result.isSuccess(decided(whilePending, filesAdded))).toBe(true);
    expect(decided(whilePending, filesAdded, connected)).toMatchObject({
      failure: {
        _tag: 'conflict',
        detail: anyWords,
      },
    });
  });
});
