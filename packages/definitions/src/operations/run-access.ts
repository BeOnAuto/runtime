import {
  PlaybookContext,
  PlaybookReader,
  PlaybookWriter,
  messageIdOf,
  randomUUIDv7,
  streamPrefixOfPlaybook,
  type Lineage,
} from '@on.auto/operations';
import { Effect } from 'effect';

import { recordedAttempt } from '../attempts/recorded-attempt.ts';
import type { RunAttempt } from '../capability/run-context.ts';
import type { RunFinish, RunStart } from '../runs/run-commands.ts';
import { isChangedSinceRead, runDecider, runDeciderAsRead, runStreamNameOf } from '../runs/run-decider.ts';
import { stillRunning } from '../runs/run-decisions.ts';
import { answerOf } from '../runs/run-lookup.ts';
import { lastModelCallOf, startedRunOf, type RunState, type RunStreamState } from '../runs/run-state.ts';
import { commandMetadata } from './command-metadata.ts';

export const newRunId = Effect.sync(() => randomUUIDv7());

export function loadRunStream(id: string): Effect.Effect<RunStreamState, never, PlaybookReader> {
  return PlaybookReader.use((reader) => reader.load(runStreamNameOf(id), runDecider)).pipe(
    Effect.map(({ state }) => state),
  );
}

export function loadRun(id: string): Effect.Effect<RunState, never, PlaybookReader> {
  return Effect.map(loadRunStream(id), startedRunOf);
}

export function loadStartedRun(id: string) {
  return Effect.map(loadRunStream(id), (recorded) => ({ recorded, run: startedRunOf(recorded) }));
}

const streamOf = Effect.fnUntraced(function* (id: string) {
  return `${streamPrefixOfPlaybook(yield* PlaybookContext)}${runStreamNameOf(id)}`;
});

export const recordRun = Effect.fnUntraced(function* (id: string, command: RunStart | RunFinish, lineage: Lineage) {
  const metadata = yield* commandMetadata;
  const { state, version } = yield* (yield* PlaybookWriter).execute(
    runStreamNameOf(id),
    runDecider,
    { ...command, ...metadata, runId: id },
    lineage,
  );
  const recorded = startedRunOf(state);
  return {
    state: recorded,
    messageId: messageIdOf(yield* streamOf(id), version),
    startedAt: metadata.at,
    modelCallsBefore: lastModelCallOf(recorded),
  };
});

export const answerAfterAnother = Effect.fnUntraced(function* (id: string) {
  const answer = yield* answerOf(id, yield* loadRunStream(id));
  return answer.status === 'started' ? yield* stillRunning : answer;
});

const attemptIn = Effect.fnUntraced(function* (id: string) {
  const { state, version } = yield* (yield* PlaybookReader).load(runStreamNameOf(id), recordedAttempt);
  const { startedAt, modelCallsBefore, calls } = state;
  const attempt: RunAttempt = { startedAt, modelCallsBefore, calls };
  return { attempt, version };
});

export const loadAttempt = Effect.fnUntraced(function* (id: string) {
  const { attempt, version } = yield* attemptIn(id);
  const quietMs = yield* (yield* PlaybookReader).ageOfLastAppend(runStreamNameOf(id));
  return { attempt, quietMs, lastMessageId: messageIdOf(yield* streamOf(id), version), readAt: version };
});

export const claimedAttempt = Effect.fnUntraced(function* (
  id: string,
  { readAt, attempt }: { readonly readAt: number; readonly attempt: number },
  lineage: Lineage,
) {
  const command = { type: 'resume' as const, attempt, ...(yield* commandMetadata), runId: id };
  const { version } = yield* (yield* PlaybookWriter)
    .execute(runStreamNameOf(id), runDeciderAsRead, { readAt, command }, lineage)
    .pipe(Effect.catchIf(isChangedSinceRead, () => Effect.fail(stillRunning)));
  return messageIdOf(yield* streamOf(id), version);
});

export const loadCalls = Effect.fnUntraced(function* (id: string) {
  const { attempt } = yield* attemptIn(id);
  return attempt;
});
