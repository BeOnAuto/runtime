import { uuidV5, type Conflict, type NotFound } from '@on.auto/operations';
import { Effect } from 'effect';

import { memoryDecider, type AskedMemory } from '../facts/memory-decider.ts';
import type { MemoryScope, MovedFrom, MovedTo, RememberedData } from '../facts/memory-facts.ts';
import { memoryStreamOf, type MemoryAt } from '../facts/memory-streams.ts';
import type { Acting, MarkedMoved, MemoryLedger } from './memory-keeper.ts';

const memoriesMoved = '7b1e9c2a-3f4d-4e8b-9a6c-2d5f8e1b0c3a';

export interface Moving {
  readonly from: MemoryAt;
  readonly to: MemoryScope;
}

function movedFromOf({ place, scope, id }: MemoryAt): MovedFrom {
  return scope === 'playbook' ? { scope, playbook: place.playbook, id } : { scope, id };
}

function destinationOf({ place, scope, id }: MemoryAt): MovedTo {
  return scope === 'playbook' ? { to: scope, as: id, playbook: place.playbook } : { to: scope, as: id };
}

function movedMemoryOf(latest: RememberedData, from: MemoryAt): AskedMemory {
  const { text, tags, about, expires_at: expiresAt } = latest;
  return {
    text,
    tags,
    ...(about === undefined ? {} : { about }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    movedFrom: movedFromOf(from),
  };
}

export function markedMovedIn(
  ledger: MemoryLedger,
  { from, to }: Moving,
  { context, lineage }: Acting,
): Effect.Effect<MarkedMoved, NotFound | Conflict> {
  const fromStream = memoryStreamOf(from);
  const as = { place: from.place, scope: to, id: uuidV5(memoriesMoved, JSON.stringify([fromStream, to])) };
  return Effect.map(
    ledger.execute(fromStream, memoryDecider, { kind: 'move', ...destinationOf(as), at: from, context }, lineage),
    ({ state }): MarkedMoved =>
      state.latest === undefined ? { as } : { as, memory: movedMemoryOf(state.latest, from) },
  );
}
