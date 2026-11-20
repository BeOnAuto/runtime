import type { Decided } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import type { RecordedEvents } from '@on.auto/providers';
import { throughItsTools } from '@on.auto/providers/testing';
import { Effect, Result } from 'effect';

import { ConnectionEventSchema, type RecordedConnectionEvent } from '../registry/connection-events.ts';
import { connectionsStreamOfOrg } from '../registry/registry-decider.ts';

const theSecret = {
  kind: 'secret',
  name: 'Authorization',
  in: 'header',
  instructions: 'Make a key under Settings.',
  key_page: 'https://keys.example.com/settings/keys',
} as const;

interface Beside {
  readonly playbooks?: readonly string[];
  readonly events?: RecordedEvents;
}

export function addedFact(
  connection: string,
  name: string,
  provider: string | null,
  { playbooks, events }: Beside = {},
): Decided<RecordedConnectionEvent> {
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
      ...(events === undefined ? {} : { events }),
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
  };
}

function recordedAt(at: string) {
  return {
    initialState: null,
    evolve: () => null,
    eventSchema: ConnectionEventSchema,
    decide: (facts: readonly Decided<RecordedConnectionEvent>[]) => Result.succeed(facts),
    context: () => ({ at, by: 'person:ada' }),
  };
}

type Recorded = readonly [string, readonly Decided<RecordedConnectionEvent>[]];

export async function registryOf(...recorded: readonly Recorded[]) {
  const registry = memoryLedger().service;
  const stream = connectionsStreamOfOrg('acme');
  await Effect.runPromise(
    Effect.forEach(recorded, ([at, facts]) => registry.execute(stream, recordedAt(at), facts), { discard: true }),
  );
  return registry;
}

const jwtWithoutItsAlgorithm = { scheme: 'jwt', secret: 'subscription', token: '$request.header.X-Tracker-Token' };

export function givenByHand() {
  return registryOf([
    '2026-11-17T07:00:00.000Z',
    [
      addedFact('connection-8', 'hooks', null, { events: { destinations: [throughItsTools] } }),
      addedFact('connection-9', 'refused', null, {
        events: { destinations: [{ ...throughItsTools, verify: jwtWithoutItsAlgorithm }] },
      }),
      addedFact('connection-10', 'tracked', 'tracker'),
    ],
  ]);
}
