import { keptOutside, type ContentStore, type KeptOutside } from '@on.auto/content';
import { memoryContentStore } from '@on.auto/content/testing';
import { Clock, Effect, Layer, Schema } from 'effect';

import type { DefinitionNames } from '../definition-names/name-judgement.ts';
import { Ledger, type ContentHolders, type RunOutcomeMapping, type KeptProjection } from '../index.ts';
import { keptLedgerOf, storedIn, type Kept } from './memory-appends.ts';
import { executedOn, multiStreamExecutedOn } from './memory-decisions.ts';
import { folded } from './memory-payloads.ts';
import { scrubbedOn } from './memory-scrubs.ts';
import type { MemoryTables } from './memory-tables.ts';

export interface MemoryLedger {
  readonly service: Ledger['Service'];
  readonly layer: Layer.Layer<Ledger>;
  readonly streamNames: () => readonly string[];
  readonly eraseExpired: KeptOutside['eraseExpired'];
  readonly names: Kept['names']['held'];
}

function factAtIn(kept: Kept): Ledger['Service']['factAt'] {
  return (stream, position, eventSchema) =>
    Effect.suspend(() => {
      const fact = storedIn(kept, stream)[position - 1];
      return fact === undefined || position < 1
        ? Effect.undefined
        : Effect.orDie(Schema.decodeUnknownEffect(Schema.toCodecJson(eventSchema))(fact));
    });
}

function ageOn({ appendedAt }: Kept): Ledger['Service']['ageOfLastAppend'] {
  return (stream) =>
    Effect.map(Clock.currentTimeMillis, (now) => now - (appendedAt.get(stream) ?? Number.NEGATIVE_INFINITY));
}

function namesReadIn(
  kept: Kept,
): Pick<Ledger['Service'], 'holderOfName' | 'nameHeldBy' | 'namesHeldIn' | 'holderOfStream'> {
  return {
    holderOfName: (named) => Effect.sync(() => kept.names.holderOf(named)),
    nameHeldBy: (definitionKey) => Effect.sync(() => kept.names.heldBy(definitionKey)),
    namesHeldIn: (kind) => Effect.sync(() => kept.names.heldIn(kind)),
    holderOfStream: ({ playbookKey, stream }) =>
      Effect.sync(() =>
        kept.names
          .definitionsIn(playbookKey)
          .toSorted()
          .find((definitionKey) => storedIn(kept, `${definitionKey}${stream}`).length > 0),
      ),
  };
}

function runIdsReadIn(kept: Kept): Pick<Ledger['Service'], 'holderOfRunId'> {
  return { holderOfRunId: (claimed) => Effect.sync(() => kept.runIds.holderOf(claimed)) };
}

export interface MemoryLedgerOptions {
  readonly runOutcomes?: RunOutcomeMapping | undefined;
  readonly projections?: readonly KeptProjection[];
  readonly holders?: ContentHolders | undefined;
  readonly store?: ContentStore;
  readonly definitionNames?: DefinitionNames;
  readonly runIds?: MemoryTables['runIds'];
}

export function memoryLedger(
  runOutcomes?: RunOutcomeMapping,
  projections: readonly KeptProjection[] = [],
  holders?: ContentHolders,
  store: ContentStore = memoryContentStore(),
): MemoryLedger {
  return memoryLedgerWith({ runOutcomes, projections, holders, store });
}

export function memoryLedgerWith({
  runOutcomes,
  projections = [],
  holders,
  store = memoryContentStore(),
  definitionNames,
  runIds,
}: MemoryLedgerOptions): MemoryLedger {
  const { kept, appends, recordedReader } = keptLedgerOf({
    runOutcomes,
    projections,
    holders,
    definitionNames,
    runIds,
  });
  const { projected, references } = kept;
  const outside = keptOutside(kept.heads, store);
  const service = Ledger.of({
    load: (stream, fold) => Effect.suspend(() => folded(fold, storedIn(kept, stream))),
    factAt: factAtIn(kept),
    ageOfLastAppend: ageOn(kept),
    execute: executedOn(kept),
    executeMultiStream: multiStreamExecutedOn(kept),
    ...namesReadIn(kept),
    ...runIdsReadIn(kept),
    scrubFact: scrubbedOn(kept),
    ...recordedReader,
    ...appends.reader,
    readRunOutcomes: kept.outcomes.readRunOutcomes,
    readProjectedRows: projected.readProjectedRows,
    countProjectedRows: projected.countProjectedRows,
    readProjectedRowsOfKeys: projected.readProjectedRowsOfKeys,
    readTogether: projected.readTogether,
    readDueRows: projected.readDueRows,
    nextDueOf: projected.nextDueOf,
    advanceRow: projected.advanceRow,
    content: outside.content,
    removeUnheld: references.removalOver(outside),
  });
  const streamNames = () => [...kept.streams.keys()];
  return {
    service,
    layer: Layer.succeed(Ledger, service),
    streamNames,
    eraseExpired: outside.eraseExpired,
    names: kept.names.held,
  };
}
