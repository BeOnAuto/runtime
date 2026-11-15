import { Cause, Effect, Exit, Predicate } from 'effect';

import type { Runnable } from '../definition/registration.ts';
import type { CallSummary } from '../dispatch/incident-reporter.ts';
import type { Rejected } from '../outcome/outcome.ts';
import { askedInTime } from './asked-in-time.ts';
import {
  deniedFor,
  type AccessDecision,
  type AccessRequest,
  type PolicyDecisionPoint,
} from './policy-decision-point.ts';

export const reportedDifferenceMessage =
  'The policy decision point, in report-only mode, decided a call otherwise than the check that decides it';

const unnamedPrincipal = 'The caller names no kind of principal';

export interface AskedCall {
  readonly registration: Runnable;
  readonly summary: CallSummary;
  readonly request: AccessRequest | undefined;
}

function askedOf(
  decisionPoint: PolicyDecisionPoint,
  request: AccessRequest | undefined,
): Effect.Effect<AccessDecision> {
  return request === undefined ? Effect.succeed(deniedFor([unnamedPrincipal])) : askedInTime(decisionPoint, request);
}

function loggedDifference(
  { registration, summary }: AskedCall,
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

function reported(decisionPoint: PolicyDecisionPoint, call: AskedCall, checkAllowed: boolean): Effect.Effect<void> {
  return Effect.gen(function* () {
    const decided = yield* askedOf(decisionPoint, call.request);
    if ((decided.decision === 'allow') !== checkAllowed) {
      yield* loggedDifference(call, checkAllowed, decided);
    }
  });
}

export function checkedReportingTo(
  decisionPoint: PolicyDecisionPoint,
  call: AskedCall,
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
