import { Unavailable, type Conflict, type Context, type Lineage, type NotFound } from '@on.auto/operations';
import { Effect } from 'effect';

import type { MemoryPorts } from '../capability/memory-ports.ts';
import { memoryDecider, type AskedMemory } from '../facts/memory-decider.ts';
import type { MemoryScope } from '../facts/memory-facts.ts';
import { addressOfScope, keeperInWords, memoryStreamOf, type MemoryPlace } from '../facts/memory-streams.ts';
import { memoriesName } from '../projection/memory-rows.ts';

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

export interface Acting {
  readonly context: Context;
  readonly lineage?: Lineage;
}

const counted = new Intl.NumberFormat('en');

function roomFor(ports: MemoryPorts, place: MemoryPlace, scope: MemoryScope): Effect.Effect<void, Unavailable> {
  return Effect.flatMap(
    ports.ledger.countProjectedRows(memoriesName, addressOfScope(place, scope), [{ column: 'status', equals: 'kept' }]),
    (keptAlready) =>
      keptAlready < ports.mostKept
        ? Effect.void
        : Effect.fail(
            new Unavailable({
              detail: `${keeperInWords(scope)} already keeps ${counted.format(keptAlready)} memories, as many as it may: forget some before remembering more`,
              kind: 'memories_full',
            }),
          ),
  );
}

function commandOf({ memory, scope, id, replaces }: RememberAsked, place: MemoryPlace, context: Context) {
  return { kind: 'remember', memory, replaces, at: { place, scope, id }, context } as const;
}

function replacedStillKept(
  ports: MemoryPorts,
  place: MemoryPlace,
  asked: RememberAsked,
  context: Context,
): Effect.Effect<void, NotFound | Conflict> {
  const command = commandOf(asked, place, context);
  return Effect.flatMap(ports.ledger.load(memoryStreamOf(command.at), memoryDecider), ({ state }) =>
    Effect.asVoid(Effect.fromResult(memoryDecider.decide(command, state))),
  );
}

export function readyToRemember(
  ports: MemoryPorts,
  place: MemoryPlace,
  asked: RememberAsked,
  { context }: Acting,
): Effect.Effect<void, NotFound | Conflict | Unavailable> {
  return asked.replaces ? replacedStillKept(ports, place, asked, context) : roomFor(ports, place, asked.scope);
}

export function kept(
  ports: MemoryPorts,
  place: MemoryPlace,
  asked: RememberAsked,
  { context, lineage }: Acting,
): Effect.Effect<Remembered, NotFound | Conflict> {
  const command = commandOf(asked, place, context);
  return Effect.map(ports.ledger.execute(memoryStreamOf(command.at), memoryDecider, command, lineage), ({ state }) => ({
    id: asked.id,
    version: state.version,
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
