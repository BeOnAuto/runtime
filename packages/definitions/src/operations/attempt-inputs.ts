import { Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import { inputOf, type PayloadAsRead } from '../payloads/run-payloads.ts';
import type { RecordedRunState } from '../runs/run-state.ts';
import type { RunDetail } from '../runs/run.ts';
import { answeredWith, type AttemptOfARun } from './attempt-endings.ts';
import type { DocumentLoss } from './unread-texts.ts';

export type AttemptWithoutItsInput = Omit<AttemptOfARun, 'input'>;

export type AttemptToEnd = Pick<AttemptOfARun, 'id' | 'context' | 'number'>;

export type NextAttempt =
  | { readonly type: 'answered'; readonly answer: RunDetail }
  | { readonly type: 'attempt'; readonly attempt: AttemptOfARun };

const inputUnavailable = new Unavailable({
  detail:
    "The run's input, which its playbook keeps outside the run's record, could not be read just now, so its next attempt is not made; ask again in a moment",
});

export const inputToRunOf = Effect.fnUntraced(function* (run: Pick<RecordedRunState, 'input'>) {
  const read = yield* inputOf(run);
  return 'unread' in read && read.unread === 'unavailable' ? yield* inputUnavailable : read;
});

export function interruptedByItsCancel({ id, context, number }: AttemptToEnd) {
  return answeredWith(id, context, { type: 'run_interrupted' }, number);
}

const endedForItsLostInput = Effect.fnUntraced(function* (
  { id, context, number }: AttemptToEnd,
  read: Extract<PayloadAsRead, { readonly unread: unknown }>,
) {
  yield* Effect.logError(
    `The input of the run ${id}, kept under ${read.kept.sha256}, is ${read.unread}, so its next attempt cannot run and the run is rejected`,
  );
  const rejection = {
    reason: 'conflict',
    detail: `The input this run was given, which its playbook kept outside the run's record, is ${read.unread}, so no attempt of it can run; start it again with its input`,
    because: 'input_missing',
  } as const;
  return yield* answeredWith(id, context, { type: 'run_rejected', data: { rejection } }, number);
});

export const endedForItsLostDocument = Effect.fnUntraced(function* (
  { id, context, number }: AttemptToEnd,
  { detail, because }: DocumentLoss,
) {
  yield* Effect.logError(
    `The document of the run ${id} is lost, so its next attempt cannot run and the run is rejected: ${detail}`,
  );
  const rejection = { reason: 'conflict', detail, because } as const;
  return yield* answeredWith(id, context, { type: 'run_rejected', data: { rejection } }, number);
});

export function nextAttemptWith(attempt: AttemptWithoutItsInput, input: PayloadAsRead) {
  return 'read' in input
    ? Effect.succeed<NextAttempt>({ type: 'attempt', attempt: { ...attempt, input: input.read } })
    : Effect.map(Effect.uninterruptible(endedForItsLostInput(attempt, input)), (answer): NextAttempt => ({
        type: 'answered',
        answer,
      }));
}
