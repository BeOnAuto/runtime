import { capitalized } from '@on.auto/phrasing';
import { Array as Arr, Effect } from 'effect';

import { allPermissions } from '../caller/permission.ts';
import { busyDetail, busyWaitsOf } from '../outcome/busy.ts';
import type { ForbiddenKind } from '../outcome/forbidden.ts';
import { rejected, type Rejected } from '../outcome/outcome.ts';
import { roleRefusal, tokenTypeRefusal, type Explanation } from '../plain-language/plain-language.ts';
import { askedInTime, batchAskedInTime, unansweredInTimeBy } from './asked-in-time.ts';
import type { AccessDecision, AccessRequest, PolicyDecisionPoint, ResourceReference } from './policy-decision-point.ts';
import type { AskedCall } from './report-only.ts';

type EnforcedDecision =
  | { readonly decision: 'allow' }
  | { readonly decision: 'deny'; readonly cause: 'grant' | 'role' | 'token_type' }
  | { readonly decision: 'indeterminate'; readonly errors: readonly string[] }
  | Busy;

interface Busy {
  readonly decision: 'busy';
  readonly retryAfter: number;
}

function detailOf({ why, remedy }: Explanation): string {
  return `${capitalized(why)}. ${remedy}`;
}

export const roleRefusalDetail = detailOf(roleRefusal);

export const roleRefusalKind: ForbiddenKind = 'permission_denied';

export const tokenTypeRefusalDetail = detailOf(tokenTypeRefusal);

export const undecidedMessage =
  'The policy decision point could not decide a call, so the call is refused as unavailable';

export const busyMessage = 'The policy decision point did not answer a call in time, so the call is refused as busy';

const undecided = 'Whether this call is allowed could not be decided just now; nothing was done';

export const nothingDone = 'nothing was done';

const notAllowedByTheGrant = 'The caller may not make this call';

const allowed: EnforcedDecision = { decision: 'allow' };

const deniedByTheGrant: EnforcedDecision = { decision: 'deny', cause: 'grant' };

const deniedForTheRole: EnforcedDecision = { decision: 'deny', cause: 'role' };

const deniedForTheTokenType: EnforcedDecision = { decision: 'deny', cause: 'token_type' };

function orgOf(resource: ResourceReference): string {
  return resource.type === 'org' ? resource.id : resource.org;
}

function withTheGrantLifted(request: AccessRequest): AccessRequest {
  return {
    ...request,
    context: {
      ...request.context,
      granted: { org: orgOf(request.resource), permissions: allPermissions, playbooks: '*' },
    },
  };
}

function inStudio(request: AccessRequest): AccessRequest {
  return { ...request, context: { ...request.context, via: 'studio' } };
}

function indeterminateOf(decided: AccessDecision | Busy): EnforcedDecision | undefined {
  if (decided.decision === 'busy') {
    return decided;
  }
  return decided.errors.length === 0 ? undefined : { decision: 'indeterminate', errors: decided.errors };
}

function heardInTime(decisionPoint: PolicyDecisionPoint, request: AccessRequest): Effect.Effect<AccessDecision | Busy> {
  const waits = busyWaitsOf(decisionPoint);
  return Effect.map(askedInTime(decisionPoint, request), (decided): AccessDecision | Busy => {
    if (unansweredInTimeBy(decided)) {
      return { decision: 'busy', retryAfter: waits.refused() };
    }
    waits.answered();
    return decided;
  });
}

function causeOnceAllowed(
  decisionPoint: PolicyDecisionPoint,
  request: AccessRequest,
  allowedCause: EnforcedDecision,
  otherwise: (request: AccessRequest) => Effect.Effect<EnforcedDecision>,
): Effect.Effect<EnforcedDecision> {
  return Effect.flatMap(heardInTime(decisionPoint, request), (decided) => {
    const indeterminate = indeterminateOf(decided);
    if (indeterminate !== undefined) {
      return Effect.succeed(indeterminate);
    }
    return decided.decision === 'allow' ? Effect.succeed(allowedCause) : otherwise(request);
  });
}

function causeBeyondTheGrant(
  decisionPoint: PolicyDecisionPoint,
  lifted: AccessRequest,
): Effect.Effect<EnforcedDecision> {
  if (lifted.principal.type !== 'person') {
    return Effect.succeed(deniedForTheTokenType);
  }
  if (lifted.context.via === 'studio') {
    return Effect.succeed(deniedForTheRole);
  }
  return causeOnceAllowed(decisionPoint, inStudio(lifted), deniedForTheTokenType, () =>
    Effect.succeed(deniedForTheRole),
  );
}

function causeOfTheDenial(decisionPoint: PolicyDecisionPoint, request: AccessRequest): Effect.Effect<EnforcedDecision> {
  return causeOnceAllowed(decisionPoint, withTheGrantLifted(request), deniedByTheGrant, (lifted) =>
    causeBeyondTheGrant(decisionPoint, lifted),
  );
}

export function enforcedDecisionOf(
  decisionPoint: PolicyDecisionPoint,
  request: AccessRequest | undefined,
): Effect.Effect<EnforcedDecision> {
  if (request === undefined) {
    return Effect.succeed(deniedByTheGrant);
  }
  return Effect.flatMap(heardInTime(decisionPoint, request), (decided) => {
    const indeterminate = indeterminateOf(decided);
    if (indeterminate !== undefined) {
      return Effect.succeed(indeterminate);
    }
    if (decided.decision === 'allow') {
      return Effect.succeed(allowed);
    }
    return request.context.via === 'run' ? Effect.succeed(deniedByTheGrant) : causeOfTheDenial(decisionPoint, request);
  });
}

/**
 * Whether a caller may call one operation of a batch: allowed or not, or, where its decision carried an error, XACML's
 * Indeterminate, an outcome of its own that is neither.
 */
export type MayCall = boolean | 'indeterminate';

function mayCallOf(decided: AccessDecision): MayCall {
  return decided.errors.length === 0 ? decided.decision === 'allow' : 'indeterminate';
}

function eachHeardInTime(
  decisionPoint: PolicyDecisionPoint,
  requests: readonly AccessRequest[],
): Effect.Effect<readonly AccessDecision[] | Busy> {
  const waits = busyWaitsOf(decisionPoint);
  return Effect.map(batchAskedInTime(decisionPoint, requests), (decided): readonly AccessDecision[] | Busy => {
    if (decided.some((each) => unansweredInTimeBy(each))) {
      return { decision: 'busy', retryAfter: waits.refused() };
    }
    waits.answered();
    return decided;
  });
}

export function allowedEachOf(
  decisionPoint: PolicyDecisionPoint,
  requests: readonly (AccessRequest | undefined)[],
): Effect.Effect<readonly MayCall[] | Busy> {
  const asked = requests.filter((request) => request !== undefined);
  return Effect.map(eachHeardInTime(decisionPoint, asked), (decided): readonly MayCall[] | Busy => {
    if ('decision' in decided) {
      return decided;
    }
    const answered = new Map<AccessRequest | undefined, MayCall>(
      Arr.zip(asked, decided).map(([request, decision]: readonly [AccessRequest, AccessDecision]) => [
        request,
        mayCallOf(decision),
      ]),
    );
    return requests.map((request) => answered.get(request) ?? false);
  });
}

function refusedUndecided(
  { registration, summary }: AskedCall,
  errors: readonly string[],
): Effect.Effect<never, Rejected> {
  return Effect.logWarning(undecidedMessage).pipe(
    Effect.annotateLogs({ ...summary, scope: registration.scope, errors: errors.length }),
    Effect.andThen(Effect.fail(rejected('unavailable', undecided))),
  );
}

function busyRejection(retryAfter: number): Rejected {
  return {
    ...rejected('unavailable', busyDetail(nothingDone, retryAfter), undefined, 'busy'),
    retry_after: retryAfter,
  };
}

function refusedBusy({ registration, summary }: AskedCall, retryAfter: number): Effect.Effect<never, Rejected> {
  return Effect.logWarning(busyMessage).pipe(
    Effect.annotateLogs({ ...summary, scope: registration.scope, retry_after: retryAfter }),
    Effect.andThen(Effect.fail(busyRejection(retryAfter))),
  );
}

export function enforcedBy(
  decisionPoint: PolicyDecisionPoint,
  call: AskedCall,
  grantCheck: Effect.Effect<void, Rejected>,
): Effect.Effect<void, Rejected> {
  return Effect.flatMap(enforcedDecisionOf(decisionPoint, call.request), (enforced) => {
    if (enforced.decision === 'allow') {
      return Effect.void;
    }
    if (enforced.decision === 'indeterminate') {
      return refusedUndecided(call, enforced.errors);
    }
    if (enforced.decision === 'busy') {
      return refusedBusy(call, enforced.retryAfter);
    }
    if (enforced.cause === 'role') {
      return Effect.fail(rejected('forbidden', roleRefusalDetail, undefined, roleRefusalKind));
    }
    return enforced.cause === 'token_type'
      ? Effect.fail(rejected('forbidden', tokenTypeRefusalDetail, undefined, 'not_allowed_token_type'))
      : Effect.andThen(grantCheck, Effect.fail(rejected('forbidden', notAllowedByTheGrant)));
  });
}
