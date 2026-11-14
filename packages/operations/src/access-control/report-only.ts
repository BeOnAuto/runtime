import { Cause, Effect, Exit, Option, Predicate } from 'effect';

import type { Runnable } from '../definition/registration.ts';
import type { CallSummary } from '../dispatch/incident-reporter.ts';
import type { Rejected } from '../outcome/outcome.ts';
import {
  deniedFor,
  type AccessDecision,
  type AccessRequest,
  type PolicyDecisionPoint,
} from './policy-decision-point.ts';

export const reportedDifferenceMessage =
  'The policy decision point, in report-only mode, decided a call otherwise than the check that decides it';

const decisionPointPatience = '1 second';

const unnamedPrincipal = 'The caller names no kind of principal';

const unansweredInTime = 'The policy decision point did not answer within a second';

const failedToAnswer = 'The policy decision point failed';

interface ReportedCall {
  readonly registration: Runnable;
  readonly summary: CallSummary;
  readonly request: AccessRequest | undefined;
}

function askedOf(
  decisionPoint: PolicyDecisionPoint,
  request: AccessRequest | undefined,
): Effect.Effect<AccessDecision> {
  if (request === undefined) {
    return Effect.succeed(deniedFor([unnamedPrincipal]));
  }
  return Effect.suspend(() => decisionPoint.decide(request)).pipe(
    Effect.timeoutOption(decisionPointPatience),
    Effect.map(Option.getOrElse(() => deniedFor([unansweredInTime]))),
    Effect.catchCauseIf(Predicate.not(Cause.hasInterruptsOnly), () => Effect.succeed(deniedFor([failedToAnswer]))),
  );
}

function loggedDifference(
  { registration, summary }: ReportedCall,
  checkAllowed: boolean,
  { decision, determiningPolicies, errors }: AccessDecision,
): Effect.Effect<void> {
  return Effect.logWarning(reportedDifferenceMessage).pipe(
    Effect.annotateLogs({
      ...summary,
      scope: registration.scope,
      check: checkAllowed ? 'allow' : 'deny',
      decision,
      determining_policies: determiningPolicies.join(','),
      errors: errors.length,
    }),
  );
}

function reported(decisionPoint: PolicyDecisionPoint, call: ReportedCall, checkAllowed: boolean): Effect.Effect<void> {
  return Effect.gen(function* () {
    const decided = yield* askedOf(decisionPoint, call.request);
    if ((decided.decision === 'allow') !== checkAllowed) {
      yield* loggedDifference(call, checkAllowed, decided);
    }
  });
}

export function checkedReportingTo(
  decisionPoint: PolicyDecisionPoint,
  call: ReportedCall,
  check: Effect.Effect<void, Rejected>,
): Effect.Effect<void, Rejected> {
  return Effect.gen(function* () {
    const checked = yield* Effect.exit(check);
    yield* reported(decisionPoint, call, Exit.isSuccess(checked)).pipe(
      Effect.catchCauseIf(Predicate.not(Cause.hasInterruptsOnly), () => Effect.void),
    );
    return yield* checked;
  });
}
