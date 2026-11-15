import { capitalized } from '@on.auto/phrasing';
import { Effect } from 'effect';

import { allPermissions } from '../caller/permission.ts';
import { rejected, type Rejected } from '../outcome/outcome.ts';
import { roleRefusal } from '../plain-language/plain-language.ts';
import { askedInTime } from './asked-in-time.ts';
import type { AccessDecision, AccessRequest, PolicyDecisionPoint, ResourceReference } from './policy-decision-point.ts';
import type { AskedCall } from './report-only.ts';

type EnforcedDecision =
  | { readonly decision: 'allow' }
  | { readonly decision: 'deny'; readonly cause: 'grant' | 'role' }
  | { readonly decision: 'indeterminate'; readonly errors: readonly string[] };

export const roleRefusalDetail = `${capitalized(roleRefusal.why)}. ${roleRefusal.remedy}`;

export const undecidedMessage =
  'The policy decision point could not decide a call, so the call is refused as unavailable';

const undecided = 'Whether this call is allowed could not be decided just now; nothing was done';

const notAllowedByTheGrant = 'The caller may not make this call';

const allowed: EnforcedDecision = { decision: 'allow' };

const deniedByTheGrant: EnforcedDecision = { decision: 'deny', cause: 'grant' };

const deniedForTheRole: EnforcedDecision = { decision: 'deny', cause: 'role' };

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

function indeterminateOf({ errors }: AccessDecision): EnforcedDecision | undefined {
  return errors.length === 0 ? undefined : { decision: 'indeterminate', errors };
}

function causeOfTheDenial(decisionPoint: PolicyDecisionPoint, request: AccessRequest): Effect.Effect<EnforcedDecision> {
  return Effect.map(
    askedInTime(decisionPoint, withTheGrantLifted(request)),
    (lifted) => indeterminateOf(lifted) ?? (lifted.decision === 'allow' ? deniedByTheGrant : deniedForTheRole),
  );
}

export function enforcedDecisionOf(
  decisionPoint: PolicyDecisionPoint,
  request: AccessRequest | undefined,
): Effect.Effect<EnforcedDecision> {
  if (request === undefined) {
    return Effect.succeed(deniedByTheGrant);
  }
  return Effect.flatMap(askedInTime(decisionPoint, request), (decided) => {
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

function refusedUndecided(
  { registration, summary }: AskedCall,
  errors: readonly string[],
): Effect.Effect<never, Rejected> {
  return Effect.logWarning(undecidedMessage).pipe(
    Effect.annotateLogs({ ...summary, scope: registration.scope, errors: errors.length }),
    Effect.andThen(Effect.fail(rejected('unavailable', undecided))),
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
    return enforced.cause === 'role'
      ? Effect.fail(rejected('forbidden', roleRefusalDetail, undefined, 'permission_denied'))
      : Effect.andThen(grantCheck, Effect.fail(rejected('forbidden', notAllowedByTheGrant)));
  });
}
