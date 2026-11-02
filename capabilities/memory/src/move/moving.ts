import { uuidV5 } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { MemoryPorts } from '../capability/memory-ports.ts';
import { memoryDecider, type AskedMemory } from '../facts/memory-decider.ts';
import type { MemoryScope, MovedFrom, MovedTo, RememberedData } from '../facts/memory-facts.ts';
import { memoryStreamOf, type MemoryAt, type MemoryPlace } from '../facts/memory-streams.ts';
import type { Acting, Remembered } from '../remember/remembering.ts';

const memoriesMoved = '7b1e9c2a-3f4d-4e8b-9a6c-2d5f8e1b0c3a';

export interface MoveAsked {
  readonly id: string;
  readonly to: MemoryScope;
}

function otherScopeThan(scope: MemoryScope): MemoryScope {
  return scope === 'playbook' ? 'organization' : 'playbook';
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

export const moved = Effect.fnUntraced(function* (
  ports: MemoryPorts,
  place: MemoryPlace,
  { id, to }: MoveAsked,
  { context, lineage }: Acting,
) {
  const from = { place, scope: otherScopeThan(to), id };
  const fromStream = memoryStreamOf(from);
  const at = { place, scope: to, id: uuidV5(memoriesMoved, JSON.stringify([fromStream, to])) };
  const { state } = yield* ports.ledger.execute(
    fromStream,
    memoryDecider,
    { kind: 'move', ...destinationOf(at), at: from, context },
    lineage,
  );
  yield* Effect.forEach(
    Option.toArray(Option.fromNullishOr(state.latest)),
    (latest) =>
      ports.ledger.execute(
        memoryStreamOf(at),
        memoryDecider,
        { kind: 'remember', memory: movedMemoryOf(latest, from), replaces: false, at, context },
        lineage,
      ),
    { discard: true },
  );
  const answer: Remembered = { id: at.id, version: 1, scope: to };
  return answer;
});
