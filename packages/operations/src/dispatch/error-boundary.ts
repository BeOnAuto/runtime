import { Cause, Effect, Predicate } from 'effect';

import { failed, type Succeeded, type Failed, type Outcome, type Rejected } from '../outcome/outcome.ts';
import { randomUUIDv7 } from '../uuid/uuid-v7.ts';
import { IncidentReporter, type CallSummary, type Incident } from './incident-reporter.ts';

const reporterPatience = '2 seconds';

function incidentOf(id: string, cause: Cause.Cause<unknown>, call: CallSummary | undefined): Incident {
  const original = Cause.squash(cause);
  return call === undefined ? { id, original } : { id, original, call };
}

export const failureOf = Effect.fnUntraced(function* (cause: Cause.Cause<unknown>, call?: CallSummary) {
  const id = randomUUIDv7();
  const reporter = yield* IncidentReporter;
  yield* Effect.suspend(() => reporter.report(incidentOf(id, cause, call))).pipe(
    Effect.timeout(reporterPatience),
    Effect.catchCause(() => Effect.logError(`The incident reporter did not record incident ${id}`)),
  );
  const failure: Failed = failed(id);
  return failure;
});

export function withErrorBoundary<A extends Succeeded, R>(
  pipeline: Effect.Effect<A, Rejected, R>,
  summary: CallSummary,
): Effect.Effect<Outcome<A>, never, R | IncidentReporter> {
  return Effect.uninterruptibleMask((restore) =>
    restore(pipeline).pipe(
      Effect.catch((rejection) => Effect.succeed(rejection)),
      Effect.catchCauseIf(Predicate.not(Cause.hasInterruptsOnly), (cause) => failureOf(cause, summary)),
    ),
  );
}
