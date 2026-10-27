import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { ConnectionEventSchema } from './connection-events.ts';

const decoded = Schema.decodeUnknownResult(ConnectionEventSchema);

function addedWith(provider: string | null, credential: Readonly<Record<string, unknown>>) {
  return {
    type: 'connection_added',
    data: {
      connection: 'connection-1',
      name: 'files',
      server_type: 'mcp',
      provider,
      placeholders: null,
      entry: { url: 'https://mcp.files.example.com/mcp' },
      credential,
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
    context: { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' },
  };
}

const issuer = 'https://auth.files.example.com';

describe('the credential a connection of consent given by hand is recorded with', () => {
  it('holds its clients, each one the runtime makes for itself, where a provider’s way may leave them to their default', () => {
    const outcomes = [
      addedWith(null, { kind: 'authorization', issuer, clients: ['dynamic'] }),
      addedWith(null, { kind: 'authorization', issuer }),
      addedWith(null, { kind: 'authorization', issuer, clients: ['registered', 'dynamic'] }),
      addedWith('files', { kind: 'authorization', issuer }),
      addedWith(null, { kind: 'none' }),
    ].map((fact: unknown) => Result.isSuccess(decoded(fact)));

    expect(outcomes).toEqual([true, false, false, true, true]);
  });
});
