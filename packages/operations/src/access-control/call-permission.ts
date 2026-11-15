import { Context, Effect } from 'effect';

import { permissionRefusalOf } from '../authorization/authorization.ts';
import type { Runnable } from '../definition/registration.ts';
import { accessRequestOfAsking, type AskedOfACaller } from './access-request-of-a-call.ts';
import { enforcedDecisionOf } from './enforcement.ts';
import type { PolicyDecisionPoint } from './policy-decision-point.ts';

export interface CallAsked extends AskedOfACaller {
  readonly operation: Runnable;
}

type MayCall = (asked: CallAsked) => Effect.Effect<boolean>;

function grantedByTheCredential({ operation, caller }: CallAsked): Effect.Effect<boolean> {
  return Effect.succeed(permissionRefusalOf(operation.permissions, caller) === undefined);
}

export const CallPermission = Context.Reference<MayCall>('@on.auto/operations/CallPermission', {
  defaultValue: () => grantedByTheCredential,
});

export function callPermissionDecidedBy(decisionPoint: PolicyDecisionPoint): MayCall {
  return (asked) =>
    Effect.map(
      enforcedDecisionOf(decisionPoint, accessRequestOfAsking(asked.operation, asked)),
      ({ decision }) => decision === 'allow',
    );
}

export function mayCall(asked: CallAsked): Effect.Effect<boolean> {
  return CallPermission.use((may) => may(asked));
}
