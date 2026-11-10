import { Unavailable, randomUUIDv7 } from '@on.auto/operations';
import { Effect } from 'effect';

import { inputOf, type PayloadAsRead } from '../runs/run-payloads.ts';
import type { RecordedRunState } from '../runs/run-state.ts';
import type { RunDetail } from '../runs/run.ts';
import { answeredWith, type AttemptOfARun } from './attempt-endings.ts';

export type AttemptWithoutItsInput = Omit<AttemptOfARun, 'input'>;

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

export function interruptedByItsCancel({ id, context, number }: AttemptWithoutItsInput) {
  return answeredWith(id, context, { type: 'run_interrupted' }, number);
}

const endedForItsLostInput = Effect.fnUntraced(function* (
  { id, context, number }: AttemptWithoutItsInput,
  read: Extract<PayloadAsRead, { readonly unread: unknown }>,
) {
  const incident = randomUUIDv7();
  yield* Effect.logError(
    `Incident ${incident}: the input of the run ${id}, kept under ${read.kept.sha256}, is ${read.unread}, so its next attempt cannot run and the run fails`,
  );
  return yield* answeredWith(id, context, { type: 'run_failed', data: { incident } }, number);
});

export function nextAttemptWith(attempt: AttemptWithoutItsInput, input: PayloadAsRead) {
  return 'read' in input
    ? Effect.succeed<NextAttempt>({ type: 'attempt', attempt: { ...attempt, input: input.read } })
    : Effect.map(Effect.uninterruptible(endedForItsLostInput(attempt, input)), (answer): NextAttempt => ({
        type: 'answered',
        answer,
      }));
}
