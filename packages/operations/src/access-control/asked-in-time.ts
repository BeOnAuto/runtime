import { Cause, Context, Effect, Option, Predicate } from 'effect';

import {
  deniedFor,
  type AccessDecision,
  type AccessRequest,
  type PolicyDecisionPoint,
} from './policy-decision-point.ts';

/**
 * How long, in milliseconds, a call waits for the policy decision point before its silence counts as a denial: a
 * second, unless the shell gives another, as a test does to drive it with its own clock.
 */
export const DecisionPointPatience = Context.Reference<number>('@on.auto/operations/DecisionPointPatience', {
  defaultValue: () => 1000,
});

const unansweredInTime = 'The policy decision point did not answer in the time a call waits for it';

const failedToAnswer = 'The policy decision point failed';

export function askedInTime(decisionPoint: PolicyDecisionPoint, request: AccessRequest): Effect.Effect<AccessDecision> {
  return Effect.flatMap(DecisionPointPatience, (patience) =>
    Effect.suspend(() => decisionPoint.decide(request)).pipe(Effect.timeoutOption(patience)),
  ).pipe(
    Effect.map(Option.getOrElse(() => deniedFor([unansweredInTime]))),
    Effect.catchCauseIf(Predicate.not(Cause.hasInterruptsOnly), () => Effect.succeed(deniedFor([failedToAnswer]))),
  );
}

export function unansweredInTimeBy({ errors }: AccessDecision): boolean {
  return errors.includes(unansweredInTime);
}

function eachDeniedFor(requests: readonly AccessRequest[], error: string): readonly AccessDecision[] {
  return requests.map(() => deniedFor([error]));
}

function answeredFor(
  requests: readonly AccessRequest[],
  decided: readonly AccessDecision[],
): readonly AccessDecision[] {
  return decided.length === requests.length ? decided : eachDeniedFor(requests, failedToAnswer);
}

export function batchAskedInTime(
  decisionPoint: PolicyDecisionPoint,
  requests: readonly AccessRequest[],
): Effect.Effect<readonly AccessDecision[]> {
  return Effect.flatMap(DecisionPointPatience, (patience) =>
    Effect.suspend(() => decisionPoint.decideBatch(requests)).pipe(Effect.timeoutOption(patience)),
  ).pipe(
    Effect.map(
      Option.match({
        onNone: () => eachDeniedFor(requests, unansweredInTime),
        onSome: (decided) => answeredFor(requests, decided),
      }),
    ),
    Effect.catchCauseIf(Predicate.not(Cause.hasInterruptsOnly), () =>
      Effect.succeed(eachDeniedFor(requests, failedToAnswer)),
    ),
  );
}
