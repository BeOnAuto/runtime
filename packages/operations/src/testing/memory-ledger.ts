import { keptOutside, type ContentStore } from '@on.auto/content';
import { memoryContentHeads, memoryContentStore } from '@on.auto/content/testing';
import { Clock, Effect, Layer, Result, Schema } from 'effect';

import {
  Conflict,
  Ledger,
  checkedContext,
  messageIdOf,
  noLineage,
  recordingOf,
  type ContentHolders,
  type Context,
  type Fold,
  type Lineage,
  type Recorded,
  type RunOutcomeMapping,
  type KeyedProjection,
  type StreamState,
} from '../index.ts';
import { noStreamToScrub, notAPositionOfTheStream, notTheShapeOf } from '../ledger/fact-scrub.ts';
import {
  memoryProjections,
  type AppendedFact,
  type LoggedFact,
  type MemoryProjections,
} from '../projections/memory-projections.ts';
import { memoryRunOutcomes, type MemoryRunOutcomes } from '../run-outcomes/memory-run-outcomes.ts';
import { memoryAppendedReader, type MemoryAppends } from './memory-appended.ts';
import { memoryRecordedReader, type MemoryRecord } from './memory-recorded.ts';
import { memoryReferences, type MemoryReferences } from './memory-references.ts';

export interface MemoryLedger {
  readonly service: Ledger['Service'];
  readonly layer: Layer.Layer<Ledger>;
  readonly streamNames: () => readonly string[];
}

interface Appended {
  readonly stream: string;
  readonly stored: readonly AppendedFact[];
  readonly lineage: Lineage;
}

interface Kept {
  readonly streams: Map<string, readonly AppendedFact[]>;
  readonly appendedAt: Map<string, number>;
  readonly log: readonly MemoryRecord[];
  readonly logged: (records: readonly MemoryRecord[]) => void;
  readonly rewritten: (stream: string, position: number, fact: AppendedFact) => void;
  readonly outcomes: MemoryRunOutcomes;
  readonly projected: MemoryProjections;
  readonly references: MemoryReferences;
}

const EncodedFactSchema = Schema.Struct({ type: Schema.String, data: Schema.Unknown });

const encodedFactOf = Schema.decodeUnknownSync(EncodedFactSchema);

function folded<State, Event extends Recorded>(
  fold: Fold<State, Event>,
  stored: readonly AppendedFact[],
): Effect.Effect<StreamState<State>> {
  const decodeEvent = Schema.decodeUnknownEffect(Schema.toCodecJson(fold.eventSchema));
  return Effect.forEach(stored, ({ type, data, context }) => Effect.orDie(decodeEvent({ type, data, context }))).pipe(
    Effect.map((events: readonly Event[]) => ({
      state: foldedOver(fold, fold.initialState, events),
      version: events.length,
    })),
  );
}

function foldedOver<State, Event extends Recorded>(
  fold: Fold<State, Event>,
  from: State,
  events: readonly Event[],
): State {
  let state = from;
  for (const event of events) {
    state = fold.evolve(state, event);
  }
  return state;
}

function storedIn({ streams }: Pick<Kept, 'streams'>, stream: string): readonly AppendedFact[] {
  return streams.get(stream) ?? [];
}

function appendedTo(kept: Kept, { stream, stored, lineage }: Appended, at: number): void {
  const version = storedIn(kept, stream).length;
  kept.outcomes.project(stream, stored, version + 1);
  kept.projected.project(stream, stored, version + 1);
  kept.references.project(stream, stored);
  kept.logged(
    stored.map(({ type, data, context }, index) => ({
      position: kept.log.length + index + 1,
      id: messageIdOf(stream, version + index + 1),
      ...lineage,
      stream,
      streamPosition: version + index + 1,
      type,
      data,
      context,
      recordedAt: new Date(at).toISOString(),
    })),
  );
  kept.streams.set(stream, [...storedIn(kept, stream), ...stored]);
  kept.appendedAt.set(stream, at);
}

function ageOn({ appendedAt }: Kept): Ledger['Service']['ageOfLastAppend'] {
  return (stream) =>
    Effect.map(Clock.currentTimeMillis, (now) => now - (appendedAt.get(stream) ?? Number.NEGATIVE_INFINITY));
}

function encodedWith<Event extends Recorded>(
  eventSchema: Schema.ConstraintCodec<Event, unknown>,
  context: Context,
): (event: Event) => Effect.Effect<AppendedFact> {
  const encodeEvent = Schema.encodeUnknownEffect(Schema.toCodecJson(eventSchema));
  return (event) =>
    Effect.orDie(encodeEvent(event)).pipe(
      Effect.map((encoded) => {
        const { type, data } = encodedFactOf(encoded);
        return { type, data, context };
      }),
    );
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
      appendedTo(kept, { stream, stored, lineage }, yield* Clock.currentTimeMillis);
      return { state: foldedOver(decider, state, events), version: version + events.length, decidedOn: state };
    });
}

function messageOf(stream: string, position: number, { type, data, context }: AppendedFact) {
  return { id: messageIdOf(stream, position), position, type, data, context };
}

function loggedFactsOf({ log }: Kept): readonly LoggedFact[] {
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
      const after = { ...fact, data: scrubbed.data };
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

interface MemoryTables {
  readonly runOutcomes: RunOutcomeMapping | undefined;
  readonly projections: readonly KeyedProjection[];
  readonly holders: ContentHolders | undefined;
}

function keptLedgerOf({ runOutcomes, projections, holders }: MemoryTables): KeptLedger {
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
          log[index] = { ...record, data: fact.data };
        }
      }
    },
    outcomes: memoryRunOutcomes(runOutcomes),
    projected: memoryProjections(projections),
    references: memoryReferences(holders),
  };
  return { kept, appends };
}

export function memoryLedger(
  runOutcomes?: RunOutcomeMapping,
  projections: readonly KeyedProjection[] = [],
  holders?: ContentHolders,
  store: ContentStore = memoryContentStore(),
): MemoryLedger {
  const { kept, appends } = keptLedgerOf({ runOutcomes, projections, holders });
  const { projected, references } = kept;
  const outside = keptOutside(memoryContentHeads(references.heldIn), store);
  const recordedReader = memoryRecordedReader(kept.log);
  const service = Ledger.of({
    load: (stream, fold) => Effect.suspend(() => folded(fold, storedIn(kept, stream))),
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
    advanceRow: projected.advanceRow,
    content: outside.content,
    removeUnheld: references.removalOver(outside),
  });
  return { service, layer: Layer.succeed(Ledger, service), streamNames: () => [...kept.streams.keys()] };
}
