import { keptOutside, type ContentHeads, type ContentStore, type KeptOutside } from '@on.auto/content';
import { memoryContentHeads, memoryContentStore } from '@on.auto/content/testing';
import { Clock, Effect, Layer, Result, Schema } from 'effect';

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
  type Context,
  type Fold,
  type Lineage,
  type Recorded,
  type RunOutcomeMapping,
  type KeptProjection,
  type StreamProjection,
  type StreamState,
} from '../index.ts';
import {
  memoryProjections,
  type AppendedFact,
  type LoggedFact,
  type MemoryProjections,
} from '../projections/memory-projections.ts';
import { memoryRunOutcomes, type MemoryRunOutcomes } from '../run-outcomes/memory-run-outcomes.ts';
import { memoryAppendedReader, type MemoryAppends } from './memory-appended.ts';
import { measuredBy, payloadsHeaded, requireHeldAsMeasured } from './memory-payloads.ts';
import { memoryRecordedReader, type MemoryRecord } from './memory-recorded.ts';
import { memoryReferences, type MemoryReferences } from './memory-references.ts';

export interface MemoryLedger {
  readonly service: Ledger['Service'];
  readonly layer: Layer.Layer<Ledger>;
  readonly streamNames: () => readonly string[];
  readonly eraseExpired: KeptOutside['eraseExpired'];
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
  readonly holders: ContentHolders;
  readonly heads: ContentHeads;
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
  const commits = [
    kept.references.staged(stream, stored),
    kept.outcomes.staged(stream, stored, version + 1),
    kept.projected.staged(stream, stored, version + 1),
  ];
  for (const commit of commits) {
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
  const measured = measuredBy(eventSchema);
  return (event) =>
    Effect.orDie(encodeEvent(event)).pipe(
      Effect.map((encoded) => {
        const { type, data } = encodedFactOf(encoded);
        return measured({ type, data, context });
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
      yield* Effect.sync(() => {
        requireHeldAsMeasured(kept.holders, stream, stored);
      });
      yield* payloadsHeaded(kept.heads, kept.holders, stream, stored);
      appendedTo(kept, { stream, stored, lineage }, yield* Clock.currentTimeMillis);
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

interface MemoryTables {
  readonly runOutcomes: RunOutcomeMapping | undefined;
  readonly projections: readonly (KeptProjection | StreamProjection)[];
  readonly holders: ContentHolders | undefined;
}

function keptLedgerOf({ runOutcomes, projections, holders }: MemoryTables): KeptLedger {
  const log: MemoryRecord[] = [];
  const streams = new Map<string, readonly AppendedFact[]>();
  const appends = memoryAppendedReader(log);
  const references = memoryReferences(holders);
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
    outcomes: memoryRunOutcomes(runOutcomes),
    projected: memoryProjections(projections, () => loggedFactsOf({ log })),
    references,
    holders: holders ?? new Map(),
    heads: memoryContentHeads(references.heldIn),
  };
  return { kept, appends };
}

export function memoryLedger(
  runOutcomes?: RunOutcomeMapping,
  projections: readonly (KeptProjection | StreamProjection)[] = [],
  holders?: ContentHolders,
  store: ContentStore = memoryContentStore(),
): MemoryLedger {
  const { kept, appends } = keptLedgerOf({ runOutcomes, projections, holders });
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
  return { service, layer: Layer.succeed(Ledger, service), streamNames, eraseExpired: outside.eraseExpired };
}
