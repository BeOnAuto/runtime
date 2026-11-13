import { keptOutside, type ContentStore, type KeptOutside } from '@on.auto/content';
import { memoryContentStore } from '@on.auto/content/testing';
import { Clock, Effect, Layer, Result, Schema } from 'effect';

import type { DefinitionNames } from '../definition-names/name-judgement.ts';
import {
  Conflict,
  Ledger,
  checkedContext,
  messageIdOf,
  noLineage,
  noStreamToScrub,
  notAPositionOfTheStream,
  notTheShapeOf,
  recordingOf,
  type ContentHolders,
  type Lineage,
  type RunOutcomeMapping,
  type KeptProjection,
  type StreamProjection,
} from '../index.ts';
import type { AppendedFact, LoggedFact } from '../projections/memory-projections.ts';
import { memoryAppendedReader, type MemoryAppends } from './memory-appended.ts';
import { encodedWith, folded, foldedOver, payloadsHeaded, requireHeldAsMeasured } from './memory-payloads.ts';
import { memoryRecordedReader, type MemoryRecord } from './memory-recorded.ts';
import { keptTablesOf, type KeptTables, type MemoryTables } from './memory-tables.ts';

export interface MemoryLedger {
  readonly service: Ledger['Service'];
  readonly layer: Layer.Layer<Ledger>;
  readonly streamNames: () => readonly string[];
  readonly eraseExpired: KeptOutside['eraseExpired'];
  readonly names: KeptTables['names']['held'];
}

interface Appended {
  readonly stream: string;
  readonly stored: readonly AppendedFact[];
  readonly lineage: Lineage;
}

interface Kept extends KeptTables {
  readonly streams: Map<string, readonly AppendedFact[]>;
  readonly appendedAt: Map<string, number>;
  readonly log: readonly MemoryRecord[];
  readonly logged: (records: readonly MemoryRecord[]) => void;
  readonly rewritten: (stream: string, position: number, fact: AppendedFact) => void;
}

function storedIn({ streams }: Pick<Kept, 'streams'>, stream: string): readonly AppendedFact[] {
  return streams.get(stream) ?? [];
}

function appendedTo(kept: Kept, { stream, stored, lineage }: Appended, at: number): Conflict | undefined {
  const version = storedIn(kept, stream).length;
  const commits = [
    kept.references.staged(stream, stored),
    kept.outcomes.staged(stream, stored, version + 1),
    kept.projected.staged(stream, stored, version + 1),
  ];
  const names = kept.names.staged(
    stored.map((fact, index) => ({ ...messageOf(stream, version + index + 1, fact), stream })),
  );
  if ('refused' in names) {
    return names.refused;
  }
  for (const commit of [...commits, names.commit]) {
    commit();
  }
  kept.logged(
    stored.map(({ type, data, context, payloadBytes }, index) => ({
      position: kept.log.length + index + 1,
      id: messageIdOf(stream, version + index + 1),
      ...lineage,
      stream,
      streamPosition: version + index + 1,
      type,
      data,
      context,
      payloadBytes,
      recordedAt: new Date(at).toISOString(),
    })),
  );
  kept.streams.set(stream, [...storedIn(kept, stream), ...stored]);
  kept.appendedAt.set(stream, at);
  return undefined;
}

function ageOn({ appendedAt }: Kept): Ledger['Service']['ageOfLastAppend'] {
  return (stream) =>
    Effect.map(Clock.currentTimeMillis, (now) => now - (appendedAt.get(stream) ?? Number.NEGATIVE_INFINITY));
}

function executedOn(kept: Kept): Ledger['Service']['execute'] {
  return (stream, decider, command, lineage = noLineage) =>
    Effect.gen(function* () {
      const { state, version } = yield* folded(decider, storedIn(kept, stream));
      yield* Effect.yieldNow;
      const decided = decider.decide(command, state);
      if (Result.isFailure(decided)) {
        return yield* Effect.fail(decided.failure);
      }
      if (storedIn(kept, stream).length !== version) {
        return yield* Effect.fail(
          new Conflict({ detail: 'The state changed while the command was decided', kind: 'concurrent_change' }),
        );
      }
      if (decided.success.length === 0) {
        return { state, version, decidedOn: state };
      }
      const context = yield* Effect.sync(() => checkedContext(decider.context(command, state)));
      const recorded = recordingOf(decider.eventSchema);
      const events = yield* Effect.sync(() => decided.success.map((event) => recorded(event, context)));
      const stored = yield* Effect.forEach(events, encodedWith(decider.eventSchema, context));
      yield* Effect.sync(() => {
        requireHeldAsMeasured(kept.holders, stream, stored);
      });
      yield* payloadsHeaded(kept.heads, kept.holders, stream, stored);
      const refused = appendedTo(kept, { stream, stored, lineage }, yield* Clock.currentTimeMillis);
      if (refused !== undefined) {
        return yield* Effect.fail(refused);
      }
      return { state: foldedOver(decider, state, events), version: version + events.length, decidedOn: state };
    });
}

function messageOf(stream: string, position: number, { type, data, context }: AppendedFact) {
  return { id: messageIdOf(stream, position), position, type, data, context };
}

function loggedFactsOf({ log }: Pick<Kept, 'log'>): readonly LoggedFact[] {
  return log.map(({ stream, streamPosition, type, data, context }) => ({
    stream,
    streamPosition,
    type,
    data,
    context,
  }));
}

function scrubbedOn(kept: Kept): Ledger['Service']['scrubFact'] {
  return (stream, position, { eventSchema, data, erasure, context, lineage = noLineage }) =>
    Effect.gen(function* () {
      const facts = storedIn(kept, stream);
      if (facts.length === 0) {
        return yield* Effect.fail(noStreamToScrub);
      }
      const fact = facts[position - 1];
      if (fact === undefined) {
        return yield* Effect.fail(notAPositionOfTheStream(position, facts.length));
      }
      const decodeFact = Schema.decodeUnknownEffect(Schema.toCodecJson(eventSchema));
      const decoded = yield* Effect.mapError(decodeFact({ type: fact.type, data, context: fact.context }), () =>
        notTheShapeOf(fact.type),
      );
      const scrubbed = yield* encodedWith(eventSchema, fact.context)(decoded);
      const checked = yield* Effect.sync(() => checkedContext(context));
      const recorded = yield* Effect.sync(() => recordingOf(eventSchema)(erasure, checked));
      const stored = yield* encodedWith(eventSchema, checked)(recorded);
      appendedTo(kept, { stream, stored: [stored], lineage }, yield* Clock.currentTimeMillis);
      const after = scrubbed;
      kept.rewritten(stream, position, after);
      kept.projected.refold(loggedFactsOf(kept), {
        stream,
        before: messageOf(stream, position, fact),
        after: messageOf(stream, position, after),
      });
      kept.outcomes.refold(stream, storedIn(kept, stream));
      kept.references.refold(stream, storedIn(kept, stream));
      return { version: facts.length + 1 };
    });
}

interface KeptLedger {
  readonly kept: Kept;
  readonly appends: MemoryAppends;
}

function keptLedgerOf(tables: MemoryTables): KeptLedger {
  const log: MemoryRecord[] = [];
  const streams = new Map<string, readonly AppendedFact[]>();
  const appends = memoryAppendedReader(log);
  const kept: Kept = {
    streams,
    appendedAt: new Map(),
    log,
    logged: (records) => {
      log.push(...records);
      appends.appended();
    },
    rewritten: (stream, position, fact) => {
      streams.set(stream, storedIn({ streams }, stream).with(position - 1, fact));
      for (const [index, record] of log.entries()) {
        if (record.stream === stream && record.streamPosition === position) {
          log[index] = { ...record, data: fact.data, payloadBytes: fact.payloadBytes };
        }
      }
    },
    ...keptTablesOf(tables, () => loggedFactsOf({ log })),
  };
  return { kept, appends };
}

export interface MemoryLedgerOptions {
  readonly runOutcomes?: RunOutcomeMapping | undefined;
  readonly projections?: readonly (KeptProjection | StreamProjection)[];
  readonly holders?: ContentHolders | undefined;
  readonly store?: ContentStore;
  readonly definitionNames?: DefinitionNames;
}

export function memoryLedger(
  runOutcomes?: RunOutcomeMapping,
  projections: readonly (KeptProjection | StreamProjection)[] = [],
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
}: MemoryLedgerOptions): MemoryLedger {
  const { kept, appends } = keptLedgerOf({ runOutcomes, projections, holders, definitionNames });
  const { projected, references } = kept;
  const outside = keptOutside(kept.heads, store);
  const recordedReader = memoryRecordedReader(kept.log);
  const service = Ledger.of({
    load: (stream, fold) => Effect.suspend(() => folded(fold, storedIn(kept, stream))),
    factAt: (stream, position, eventSchema) =>
      Effect.suspend(() => {
        const fact = storedIn(kept, stream)[position - 1];
        return fact === undefined || position < 1
          ? Effect.undefined
          : Effect.orDie(Schema.decodeUnknownEffect(Schema.toCodecJson(eventSchema))(fact));
      }),
    ageOfLastAppend: ageOn(kept),
    execute: executedOn(kept),
    scrubFact: scrubbedOn(kept),
    readRecorded: recordedReader.readRecorded,
    readRecordedEvent: recordedReader.readRecordedEvent,
    readAppendedFacts: appends.reader.readAppendedFacts,
    waitForAppend: appends.reader.waitForAppend,
    readRunOutcomes: kept.outcomes.readRunOutcomes,
    readProjectedRows: projected.readProjectedRows,
    countProjectedRows: projected.countProjectedRows,
    readDueRows: projected.readDueRows,
    nextDueOf: projected.nextDueOf,
    resetStreamProjection: projected.resetStreamProjection,
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
