import {
  checkedContext,
  recordingOf,
  type Conflict,
  type DecidedState,
  type DeclarableReason,
  type Lineage,
  type MultiStreamWriter,
  type Recorded,
  type Rejection,
  type StreamDecision,
  type StreamReader,
} from '@on.auto/operations';
import { Effect, Result, type Schema } from 'effect';

import { foldEvents } from '../fold-events.ts';
import { retriedOnVersionConflict, VersionConflict } from '../version-conflict.ts';
import { multiStreamAppenderOf, type DecidedStreamAppend } from './multi-stream-appender.ts';
import type { MultiStreamAppends } from './multi-stream-appends.ts';
import { StreamRefused } from './stream-refused.ts';

interface DecidedOnAStream<State, Event extends Recorded> extends DecidedState<State> {
  readonly append?: DecidedStreamAppend<Event>;
}

type Decided<State, Event extends Recorded, R extends DeclarableReason> = Result.Result<
  DecidedOnAStream<State, Event>,
  Rejection<R>
>;

function decidedOn<State, Command, Event extends Recorded, R extends DeclarableReason>(
  load: StreamReader['load'],
  { stream, decider, command }: StreamDecision<State, Command, Event, R>,
  lineage: Lineage | undefined,
): Effect.Effect<Decided<State, Event, R>> {
  return Effect.gen(function* () {
    const loaded = yield* load(stream, decider);
    const decided = decider.decide(command, loaded.state);
    if (Result.isFailure(decided)) {
      return Result.fail(decided.failure);
    }
    const { state, version } = loaded;
    if (decided.success.length === 0) {
      return Result.succeed({ state, version, decidedOn: state });
    }
    const context = yield* Effect.sync(() => checkedContext(decider.context(command, state)));
    const recorded = recordingOf(decider.eventSchema);
    const events = yield* Effect.sync(() => decided.success.map((event) => recorded(event, context)));
    const place = { expectedVersion: version, context, ...(lineage === undefined ? {} : { lineage }) };
    return Result.succeed({
      state: foldEvents(decider.evolve, state, events),
      version: version + events.length,
      decidedOn: state,
      append: { stream, events: decided.success, place },
    });
  });
}

function conflictOfTheAppend(error: unknown): VersionConflict | Conflict {
  return error instanceof StreamRefused ? error.conflict : new VersionConflict();
}

function appendedWhole<State, Event extends Recorded>(
  store: MultiStreamAppends,
  eventSchema: Schema.ConstraintCodec<Event, unknown> | undefined,
  decided: readonly DecidedOnAStream<State, Event>[],
): Effect.Effect<void, VersionConflict | Conflict> {
  const appends = decided.flatMap(({ append }) => (append === undefined ? [] : [append]));
  return eventSchema === undefined || appends.length === 0
    ? Effect.void
    : multiStreamAppenderOf(store, eventSchema)(appends).pipe(Effect.mapError(conflictOfTheAppend));
}

export function multiStreamExecutorOf(
  store: MultiStreamAppends,
  load: StreamReader['load'],
): MultiStreamWriter['executeMultiStream'] {
  return <State, Command, Event extends Recorded, R extends DeclarableReason>(
    decisions: readonly StreamDecision<State, Command, Event, R>[],
    lineage?: Lineage,
  ) => {
    const attempt = Effect.gen(function* () {
      const decided: DecidedOnAStream<State, Event>[] = [];
      for (const decision of decisions) {
        const one = yield* decidedOn(load, decision, lineage);
        if (Result.isFailure(one)) {
          return Result.fail(one.failure);
        }
        decided.push(one.success);
      }
      yield* appendedWhole(store, decisions[0]?.decider.eventSchema, decided);
      return Result.succeed(decided.map(({ state, version, decidedOn: on }) => ({ state, version, decidedOn: on })));
    });
    return retriedOnVersionConflict(attempt).pipe(Effect.flatMap(Effect.fromResult));
  };
}
