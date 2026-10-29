import { Clock, Effect, Layer, Result, Schema } from 'effect';

import { memoryRecordedContent } from '../content/memory-content.ts';
import {
  Conflict,
  Ledger,
  checkedContext,
  messageIdOf,
  noLineage,
  recordingOf,
  type Context,
  type Fold,
  type Lineage,
  type Recorded,
  type RunOutcomeMapping,
  type KeyedProjection,
  type StreamState,
} from '../index.ts';
import { memoryProjections, type AppendedFact, type MemoryProjections } from '../projections/memory-projections.ts';
import { memoryRunOutcomes, type MemoryRunOutcomes } from '../run-outcomes/memory-run-outcomes.ts';
import { memoryAppendedReader } from './memory-appended.ts';
import { memoryRecordedReader, type MemoryRecord } from './memory-recorded.ts';

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
  readonly outcomes: MemoryRunOutcomes;
  readonly projected: MemoryProjections;
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

function storedIn({ streams }: Kept, stream: string): readonly AppendedFact[] {
  return streams.get(stream) ?? [];
}

function appendedTo(kept: Kept, { stream, stored, lineage }: Appended, at: number): void {
  const version = storedIn(kept, stream).length;
  kept.outcomes.project(stream, stored, version + 1);
  kept.projected.project(stream, stored, version + 1);
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
        return { state, version };
      }
      const context = yield* Effect.sync(() => checkedContext(decider.context(command, state)));
      const recorded = recordingOf(decider.eventSchema);
      const events = yield* Effect.sync(() => decided.success.map((event) => recorded(event, context)));
      const stored = yield* Effect.forEach(events, encodedWith(decider.eventSchema, context));
      appendedTo(kept, { stream, stored, lineage }, yield* Clock.currentTimeMillis);
      return { state: foldedOver(decider, state, events), version: version + events.length };
    });
}

export function memoryLedger(
  runOutcomes?: RunOutcomeMapping,
  projections: readonly KeyedProjection[] = [],
): MemoryLedger {
  const log: MemoryRecord[] = [];
  const appends = memoryAppendedReader(log);
  const kept: Kept = {
    streams: new Map(),
    appendedAt: new Map(),
    log,
    logged: (records) => {
      log.push(...records);
      appends.appended();
    },
    outcomes: memoryRunOutcomes(runOutcomes),
    projected: memoryProjections(projections),
  };
  const { projected } = kept;
  const recordedReader = memoryRecordedReader(kept.log);
  const service = Ledger.of({
    load: (stream, fold) => Effect.suspend(() => folded(fold, storedIn(kept, stream))),
    ageOfLastAppend: ageOn(kept),
    execute: executedOn(kept),
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
    content: memoryRecordedContent(),
  });
  return { service, layer: Layer.succeed(Ledger, service), streamNames: () => [...kept.streams.keys()] };
}
