import { Cause, Effect, Option, Predicate } from 'effect';

import {
  deniedFor,
  type AccessDecision,
  type AccessRequest,
  type PolicyDecisionPoint,
} from './policy-decision-point.ts';

const decisionPointPatience = '1 second';

const unansweredInTime = 'The policy decision point did not answer within a second';

const failedToAnswer = 'The policy decision point failed';

export function askedInTime(decisionPoint: PolicyDecisionPoint, request: AccessRequest): Effect.Effect<AccessDecision> {
  return Effect.suspend(() => decisionPoint.decide(request)).pipe(
    Effect.timeoutOption(decisionPointPatience),
    Effect.map(Option.getOrElse(() => deniedFor([unansweredInTime]))),
    Effect.catchCauseIf(Predicate.not(Cause.hasInterruptsOnly), () => Effect.succeed(deniedFor([failedToAnswer]))),
  );
}
