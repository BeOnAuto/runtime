import {
  Ledger,
  checkedContext,
  recordingOf,
  type Conflict,
  type Context,
  type Decided,
  type Decider,
  type DeclarableReason,
  type Recorded,
  type Rejection,
  type StreamReader,
  type StreamState,
  type StreamWriter,
} from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { appendedFactsReaderOf } from './appended/appended-reader.ts';
import { eventAppenderOf } from './event-appender.ts';
import type { LedgerStore, Streams } from './event-store.ts';
import { foldEvents } from './fold-events.ts';
import { runOutcomesReaderOf } from './outcomes/run-outcomes-reader.ts';
import { recordedEventReaderOf, recordedReaderOf } from './recorded/recorded-reader.ts';
import { streamReaderOf } from './stream-reader.ts';
import { retriedOnVersionConflict, type VersionConflict } from './version-conflict.ts';

export type StreamLoad<Loaded> = (stream: string) => Effect.Effect<Loaded>;

export interface DecidedPlace {
  readonly expectedVersion: number;
  readonly context: Context;
}

export type StreamAppend<Event extends Recorded, Loaded = unknown> = (
  stream: string,
  events: readonly Decided<Event>[],
  place: DecidedPlace,
  loaded: Loaded,
) => Effect.Effect<void, VersionConflict>;

export interface Decision<Loaded, State, Event> extends StreamState<State> {
  readonly loaded: Loaded;
  readonly events: readonly Event[];
}

export type DecisionLoop<Loaded, State, Command, Event, R extends DeclarableReason> = (
  stream: string,
  command: Command,
) => Effect.Effect<Decision<Loaded, State, Event>, Rejection<R> | Conflict>;

export function decisionLoop<
  Loaded extends StreamState<State>,
  State,
  Command,
  Event extends Recorded,
  R extends DeclarableReason,
>(
  load: StreamLoad<Loaded>,
  append: StreamAppend<Event, Loaded>,
  decider: Decider<State, Command, Event, R>,
): DecisionLoop<Loaded, State, Command, Event, R> {
  const recorded = recordingOf(decider.eventSchema);
  const attempt = (
    stream: string,
    command: Command,
  ): Effect.Effect<Result.Result<Decision<Loaded, State, Event>, Rejection<R>>, VersionConflict> =>
    Effect.gen(function* () {
      const loaded = yield* load(stream);
      const decided = decider.decide(command, loaded.state);
      if (Result.isFailure(decided)) {
        return Result.fail(decided.failure);
      }
      if (decided.success.length === 0) {
        return Result.succeed({ loaded, events: [], state: loaded.state, version: loaded.version });
      }
      const context = yield* Effect.sync(() => checkedContext(decider.context(command, loaded.state)));
      const events = yield* Effect.sync(() => decided.success.map((event) => recorded(event, context)));
      yield* append(stream, decided.success, { expectedVersion: loaded.version, context }, loaded);
      return Result.succeed({
        loaded,
        events,
        state: foldEvents(decider.evolve, loaded.state, events),
        version: loaded.version + events.length,
      });
    });
  return (stream, command) =>
    retriedOnVersionConflict(attempt(stream, command)).pipe(Effect.flatMap(Effect.fromResult));
}

export function streamPortsOf(streams: Streams): StreamReader & StreamWriter {
  const load = streamReaderOf(streams);
  return {
    load,
    execute: (stream, decider, command, lineage) =>
      decisionLoop(
        (named: string) => load(named, decider),
        (named, events, place) =>
          eventAppenderOf(streams, decider.eventSchema)(named, events, {
            ...place,
            ...(lineage === undefined ? {} : { lineage }),
          }),
        decider,
      )(stream, command).pipe(
        Effect.map(({ state, version, loaded }) => ({ state, version, decidedOn: loaded.state })),
      ),
  };
}

export function makeLedger(store: LedgerStore): Ledger['Service'] {
  return Ledger.of({
    ...streamPortsOf(store),
    ageOfLastAppend: (stream) => Effect.promise(() => store.ageOfLastAppend(stream)),
    readRecorded: recordedReaderOf(store),
    readRecordedEvent: recordedEventReaderOf(store),
    ...appendedFactsReaderOf(store),
    readRunOutcomes: runOutcomesReaderOf(store),
    readProjectedRows: store.readProjectedRows,
    countProjectedRows: store.countProjectedRows,
    readDueRows: store.readDueRows,
    nextDueOf: store.nextDueOf,
    advanceRow: store.advanceRow,
    content: store.content,
  });
}
