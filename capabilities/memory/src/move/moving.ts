import { Effect } from 'effect';

import { keeperOf, type MemoryPorts } from '../capability/memory-ports.ts';
import type { MemoryScope } from '../facts/memory-facts.ts';
import type { MemoryPlace } from '../facts/memory-streams.ts';
import type { Acting } from '../keeper/memory-keeper.ts';
import type { Remembered } from '../remember/remembering.ts';

export interface MoveAsked {
  readonly id: string;
  readonly to: MemoryScope;
}

function otherScopeThan(scope: MemoryScope): MemoryScope {
  return scope === 'playbook' ? 'organization' : 'playbook';
}

export const moved = Effect.fnUntraced(function* (
  ports: MemoryPorts,
  place: MemoryPlace,
  { id, to }: MoveAsked,
  acting: Acting,
) {
  const from = { place, scope: otherScopeThan(to), id };
  const { as, memory } = yield* keeperOf(ports, place, from).moved(from, to, acting);
  if (memory !== undefined) {
    yield* keeperOf(ports, place, as).remembered({ at: as, memory, replaces: false }, acting);
  }
  const answer: Remembered = { id: as.id, version: 1, scope: to };
  return answer;
});
