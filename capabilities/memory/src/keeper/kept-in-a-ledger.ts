import { Unavailable, type Conflict, type NotFound } from '@on.auto/operations';
import { Effect } from 'effect';

import { memoryBounds } from '../document/memory-bounds.ts';
import { memoryDecider } from '../facts/memory-decider.ts';
import { addressOfScope, keeperInWords, memoryStreamOf, type MemoryAt } from '../facts/memory-streams.ts';
import { memoriesName } from '../projection/memory-rows.ts';
import { erasedIn } from './erased-in-a-ledger.ts';
import type { Acting, ForgottenStatus, MemoryKeeper, MemoryLedger, RememberAsk } from './memory-keeper.ts';
import { markedMovedIn } from './moved-in-a-ledger.ts';

export interface KeptIn {
  readonly ledger: MemoryLedger;
  readonly mostKept?: number;
}

const counted = new Intl.NumberFormat('en');

function roomAt(ledger: MemoryLedger, mostKept: number, { place, scope }: MemoryAt): Effect.Effect<void, Unavailable> {
  return Effect.flatMap(
    ledger.countProjectedRows(memoriesName, addressOfScope(place, scope), [{ column: 'status', equals: 'kept' }]),
    (keptAlready) =>
      keptAlready < mostKept
        ? Effect.void
        : Effect.fail(
            new Unavailable({
              detail: `${keeperInWords(scope)} already keeps ${counted.format(keptAlready)} memories, as many as it may: forget some before remembering more`,
              kind: 'memories_full',
            }),
          ),
  );
}

function rememberingOf({ at, memory, replaces }: RememberAsk, { context }: Acting) {
  return { kind: 'remember', memory, replaces, at, context } as const;
}

function replacedStillKept(
  ledger: MemoryLedger,
  ask: RememberAsk,
  acting: Acting,
): Effect.Effect<void, NotFound | Conflict> {
  const command = rememberingOf(ask, acting);
  return Effect.flatMap(ledger.load(memoryStreamOf(ask.at), memoryDecider), ({ state }) =>
    Effect.asVoid(Effect.fromResult(memoryDecider.decide(command, state))),
  );
}

export function memoryKeeperOn({ ledger, mostKept = memoryBounds.mostKept }: KeptIn): MemoryKeeper {
  return {
    readyToRemember: (ask, acting) =>
      ask.replaces ? replacedStillKept(ledger, ask, acting) : roomAt(ledger, mostKept, ask.at),
    remembered: (ask, acting) =>
      Effect.map(
        ledger.execute(memoryStreamOf(ask.at), memoryDecider, rememberingOf(ask, acting), acting.lineage),
        ({ state }) => state.version,
      ),
    rowsRead: (address, query) => ledger.readProjectedRows(memoriesName, address, query),
    standingOf: (at) => Effect.map(ledger.load(memoryStreamOf(at), memoryDecider), ({ state }) => state.status),
    forgotten: (at, { context, lineage }) =>
      Effect.map(
        ledger.execute(memoryStreamOf(at), memoryDecider, { kind: 'forget', at, context }, lineage),
        ({ state }): ForgottenStatus => (state.status === 'erased' ? 'erased' : 'forgotten'),
      ),
    erased: (at, acting) => erasedIn(ledger, at, acting),
    moved: (from, to, acting) => markedMovedIn(ledger, { from, to }, acting),
  };
}
