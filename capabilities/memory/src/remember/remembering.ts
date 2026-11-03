import type { Conflict, NotFound, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import { keeperOf, type MemoryPorts } from '../capability/memory-ports.ts';
import type { AskedMemory } from '../facts/memory-decider.ts';
import type { MemoryScope } from '../facts/memory-facts.ts';
import type { MemoryPlace } from '../facts/memory-streams.ts';
import type { Acting, RememberAsk } from '../keeper/memory-keeper.ts';

export interface RememberAsked {
  readonly memory: AskedMemory;
  readonly scope: MemoryScope;
  readonly id: string;
  readonly replaces: boolean;
}

export type Remembered = {
  readonly id: string;
  readonly version: number;
  readonly scope: MemoryScope;
};

function askOf(place: MemoryPlace, { memory, scope, id, replaces }: RememberAsked): RememberAsk {
  return { at: { place, scope, id }, memory, replaces };
}

export function readyToRemember(
  ports: MemoryPorts,
  place: MemoryPlace,
  asked: RememberAsked,
  acting: Acting,
): Effect.Effect<void, NotFound | Conflict | Unavailable> {
  const ask = askOf(place, asked);
  return keeperOf(ports, place, ask.at).readyToRemember(ask, acting);
}

export function kept(
  ports: MemoryPorts,
  place: MemoryPlace,
  asked: RememberAsked,
  acting: Acting,
): Effect.Effect<Remembered, NotFound | Conflict> {
  const ask = askOf(place, asked);
  return Effect.map(keeperOf(ports, place, ask.at).remembered(ask, acting), (version) => ({
    id: asked.id,
    version,
    scope: asked.scope,
  }));
}

export function remembered(
  ports: MemoryPorts,
  place: MemoryPlace,
  asked: RememberAsked,
  acting: Acting,
): Effect.Effect<Remembered, NotFound | Conflict | Unavailable> {
  return Effect.andThen(readyToRemember(ports, place, asked, acting), kept(ports, place, asked, acting));
}
