import type { Decided } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { ofEachSubscription, providersOf, tracker } from '@on.auto/providers/testing';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { ConnectionEventSchema, type RecordedConnectionEvent } from '../registry/connection-events.ts';
import { connectionsStreamOfOrg } from '../registry/registry-decider.ts';
import { loopConnectionsOf } from './loop-connections.ts';

const theSecret = {
  kind: 'secret',
  name: 'Authorization',
  in: 'header',
  instructions: 'Make a key under Settings.',
  key_page: 'https://keys.example.com/settings/keys',
} as const;

function addedFact(connection: string, name: string, provider: string | null, playbooks?: readonly string[]) {
  const entry = { url: `https://${name}.example.com/mcp` };
  return {
    type: 'connection_added',
    data: {
      connection,
      name,
      server_type: 'mcp',
      provider,
      placeholders: null,
      entry: playbooks === undefined ? entry : { ...entry, playbooks },
      credential: theSecret,
      says: {},
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
  } as const;
}

const connectedAt = '2026-11-17T08:00:00.000Z';

const added = [
  addedFact('connection-1', 'tracker', 'tracker'),
  addedFact('connection-2', 'notes', null),
  addedFact('connection-3', 'sales-only', null, ['sales']),
  addedFact('connection-4', 'gone', null),
  { type: 'connection_removed', data: { connection: 'connection-4' } },
] as const;

const connected = [
  {
    type: 'connection_connected',
    data: { connection: 'connection-1', secret_id: 'secret-9', connected_by: { id: 'person:ada', name: 'Ada' } },
  },
] as const;

function recordedAt(at: string) {
  return {
    initialState: null,
    evolve: () => null,
    eventSchema: ConnectionEventSchema,
    decide: (facts: readonly Decided<RecordedConnectionEvent>[]) => Result.succeed(facts),
    context: () => ({ at, by: 'person:ada' }),
  };
}

const providers = providersOf({ ...tracker, events: { destinations: [ofEachSubscription] } });

const declared = providers.providers.flatMap(({ entry }) => entry.events?.destinations ?? []);

async function connectionsOver() {
  const ledger = memoryLedger().service;
  const stream = connectionsStreamOfOrg('acme');
  await Effect.runPromise(ledger.execute(stream, recordedAt('2026-11-17T07:00:00.000Z'), added));
  await Effect.runPromise(ledger.execute(stream, recordedAt(connectedAt), connected));
  const connectionsOf = loopConnectionsOf({ registry: ledger, providers });
  return (org: string, playbook: string) => Effect.runPromise(connectionsOf({ org, playbook }));
}

describe('the connections the loop arranges through', () => {
  it('are those of the org not removed that serve the playbook, with when each was connected and what its entry declares', async () => {
    const connectionsOf = await connectionsOver();

    expect(await connectionsOf('acme', 'alpha')).toEqual([
      { connection: 'tracker', connected: connectedAt, destinations: declared },
      { connection: 'notes', destinations: [] },
    ]);
  });

  it('take in a connection that serves only some playbooks for those alone, and none of another org', async () => {
    const connectionsOf = await connectionsOver();
    const names = async (org: string, playbook: string) =>
      (await connectionsOf(org, playbook)).map(({ connection }) => connection);

    expect(await names('acme', 'sales')).toEqual(['tracker', 'notes', 'sales-only']);
    expect(await names('globex', 'alpha')).toEqual([]);
  });
});
