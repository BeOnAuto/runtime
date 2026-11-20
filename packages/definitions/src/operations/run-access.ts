import { messageIdOf, randomUUIDv7, type Lineage, runStreamNameOf } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import { recordedAttempt } from '../attempts/recorded-attempt.ts';
import type { RunAttempt } from '../capability/run-context.ts';
import type { RunFinish, RunStart } from '../runs/run-commands.ts';
import {
  isChangedSinceRead,
  runDecider,
  runDeciderAsRead,
  placeOfRun,
  placeToStart,
  readerAt,
  writerAt,
  type RunPlace,
} from '../runs/run-decider.ts';
import { stillRunning } from '../runs/run-decisions.ts';
import { runAnswered } from '../runs/run-lookup.ts';
import {
  calledAToolThatMayChangeSomething,
  fencingTokenOf,
  lastModelCallOf,
  startedRunOf,
  type RunState,
  type RunStreamState,
} from '../runs/run-state.ts';
import { commandMetadata } from './command-metadata.ts';

export const newRunId = Effect.sync(() => randomUUIDv7());

const noRunYet: RunStreamState = runDecider.initialState;

export const loadRunStream = Effect.fnUntraced(function* (id: string) {
  const place = yield* Effect.option(placeOfRun(id));
  if (Option.isNone(place)) {
    return noRunYet;
  }
  const { state } = yield* (yield* readerAt(place.value)).load(runStreamNameOf(id), runDecider);
  return state;
});

export function loadRun(id: string) {
  return Effect.map(loadRunStream(id), (state): RunState => startedRunOf(state));
}

export function runCalledAToolThatMayChangeSomething(id: string) {
  return Effect.map(loadRun(id), (state) => state !== undefined && calledAToolThatMayChangeSomething(state));
}

export function loadStartedRun(id: string) {
  return Effect.map(loadRunStream(id), (recorded) => ({ recorded, run: startedRunOf(recorded) }));
}

const recordedAt = Effect.fnUntraced(function* (
  place: RunPlace,
  id: string,
  command: RunStart | RunFinish,
  lineage: Lineage,
) {
  const metadata = yield* commandMetadata;
  const { state, version } = yield* (yield* writerAt(place)).execute(
    runStreamNameOf(id),
    runDecider,
    { ...command, ...metadata, runId: id },
    lineage,
  );
  const recorded = startedRunOf(state);
  return {
    state: recorded,
    messageId: messageIdOf(place.stream, version),
    startedAt: metadata.at,
    modelCallsBefore: lastModelCallOf(recorded),
  };
});

export function recordRun(id: string, command: RunFinish, lineage: Lineage) {
  return Effect.flatMap(placeOfRun(id), (place) => recordedAt(place, id, command, lineage));
}

export function recordStart(id: string, start: RunStart, definition: string, lineage: Lineage) {
  return Effect.flatMap(placeToStart(id, definition), (place) => recordedAt(place, id, start, lineage));
}

export const answerAfterAnother = Effect.fnUntraced(function* (id: string) {
  const answer = yield* runAnswered(id, yield* loadRunStream(id));
  return answer.status === 'started' ? yield* stillRunning : answer;
});

const attemptAt = Effect.fnUntraced(function* (place: RunPlace, id: string) {
  const { state, version } = yield* (yield* readerAt(place)).load(runStreamNameOf(id), recordedAttempt);
  const { startedAt, modelCallsBefore, calls } = state;
  const attempt: RunAttempt = { startedAt, modelCallsBefore, calls };
  return { attempt, version };
});

export const loadAttempt = Effect.fnUntraced(function* (id: string) {
  const place = yield* Effect.orDie(placeOfRun(id));
  const { attempt, version } = yield* attemptAt(place, id);
  const quietMs = yield* (yield* readerAt(place)).ageOfLastAppend(runStreamNameOf(id));
  return { attempt, quietMs, lastMessageId: messageIdOf(place.stream, version), readAt: version };
});

export const claimedAttempt = Effect.fnUntraced(function* (
  id: string,
  { readAt, attempt }: { readonly readAt: number; readonly attempt: number },
  lineage: Lineage,
) {
  const command = { type: 'resume' as const, attempt, ...(yield* commandMetadata), runId: id };
  const place = yield* Effect.orDie(placeOfRun(id));
  const { state, version } = yield* (yield* writerAt(place))
    .execute(runStreamNameOf(id), runDeciderAsRead, { readAt, command }, lineage)
    .pipe(Effect.catchIf(isChangedSinceRead, () => Effect.fail(stillRunning)));
  return {
    startId: messageIdOf(place.stream, version),
    fencingToken: fencingTokenOf(startedRunOf(state.state)),
  };
});

export const loadCalls = Effect.fnUntraced(function* (id: string) {
  const { attempt } = yield* attemptAt(yield* Effect.orDie(placeOfRun(id)), id);
  return attempt;
});
