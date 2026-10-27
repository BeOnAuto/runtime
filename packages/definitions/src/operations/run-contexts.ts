import { Cause, Effect, type Schema } from 'effect';

import type { CapabilityAnswer, CapabilityRejection } from '../capability/capability.ts';
import type { InterruptedAttempt, RunOutcome } from '../runs/run-commands.ts';
import { isTaken } from '../runs/run-decisions.ts';
import type { JournalledRun, Prepared } from './prepared-context.ts';
import { answerAfterAnother, answeredRun, loadCalls, loadRun } from './run-access.ts';
import { attempt, failedAttempt, interruptedAttempt, isTakenByAnother } from './run-attempt.ts';

export function answeredWith(
  id: string,
  context: JournalledRun,
  outcome: RunOutcome | InterruptedAttempt,
  number: number,
) {
  return Effect.gen(function* () {
    const causationId = outcome.type === 'run_deferred' ? context.lineage.startId : yield* context.journal.latest;
    const lineage = { causationId, correlationId: context.lineage.correlationId };
    return yield* answeredRun(id, { type: 'finish', result: outcome, attempt: number }, lineage);
  });
}

export interface AttemptOfARun {
  readonly id: string;
  readonly run: Prepared;
  readonly input: Schema.Json;
  readonly context: JournalledRun;
  readonly number: number;
}

type Restore = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

const interruptedAs = Effect.fnUntraced(function* ({ id, run, context, number }: AttemptOfARun) {
  const interrupted = interruptedAttempt(run.prepared.resumesAfterMs);
  if ((yield* loadRun(id))?.cancel === undefined) {
    return yield* answeredWith(id, context, interrupted, number);
  }
  const { ends } = run.prepared.cancelledAttempt(yield* loadCalls(id));
  yield* Effect.forEach(ends, (end) => Effect.ignore(context.journal.record(end)), { discard: true });
  const { record } = run.prepared.cancelledAttempt(yield* loadCalls(id));
  return yield* answeredWith(id, context, record === undefined ? interrupted : { ...interrupted, record }, number);
});

export const attemptEnded = Effect.fnUntraced(function* (
  attempting: AttemptOfARun,
  ran: Effect.Effect<CapabilityAnswer, CapabilityRejection>,
) {
  const { id, context, number } = attempting;
  const outcome = yield* attempt(ran).pipe(
    Effect.onError((cause) =>
      Effect.ignore(
        Cause.hasInterruptsOnly(cause) ? interruptedAs(attempting) : answeredWith(id, context, failedAttempt, number),
      ),
    ),
  );
  return isTakenByAnother(outcome)
    ? yield* answerAfterAnother(id)
    : yield* answeredWith(id, context, outcome, number).pipe(Effect.catchIf(isTaken, () => answerAfterAnother(id)));
});

export function answeredAttempt(attempting: AttemptOfARun, restore: Restore) {
  const { run, input, context } = attempting;
  const running = run.prepared.run(input, context);
  return attemptEnded(attempting, run.prepared.whenCancelled === 'finish' ? running : restore(running));
}
