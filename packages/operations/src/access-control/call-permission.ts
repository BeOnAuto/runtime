import { Context, Effect } from 'effect';

import { permissionRefusalOf } from '../authorization/authorization.ts';
import { callSummaryOf } from '../dispatch/request.ts';
import { rejected, type Rejected } from '../outcome/outcome.ts';
import {
  InAConversation,
  accessRequestOfAsking,
  type AskedOfACaller,
  type OperationDeclaration,
} from './access-request-of-a-call.ts';
import { enforcedBy, enforcedDecisionOf } from './enforcement.ts';
import type { PolicyDecisionPoint } from './policy-decision-point.ts';
import { reportedBeside, type AskedCall } from './report-only.ts';

export interface CallAsked extends AskedOfACaller {
  readonly operation: OperationDeclaration;
}

type MayCall = (asked: CallAsked) => Effect.Effect<boolean>;

export type CallAdmitted = (asked: CallAsked) => Effect.Effect<void, Rejected>;

function askedCallOf(asked: CallAsked, inAConversation: boolean): AskedCall {
  return {
    registration: asked.operation,
    summary: callSummaryOf(asked.operation.name, asked, asked.playbook),
    request: accessRequestOfAsking(asked.operation, asked, inAConversation),
  };
}

function refusedByTheCredential({ operation, caller }: CallAsked): Effect.Effect<void, Rejected> {
  const refusal = permissionRefusalOf(operation.permissions, caller);
  return refusal === undefined ? Effect.void : Effect.fail(rejected('forbidden', refusal));
}

function grantedByTheCredential({ operation, caller }: CallAsked): Effect.Effect<boolean> {
  return Effect.succeed(permissionRefusalOf(operation.permissions, caller) === undefined);
}

export const CallPermission = Context.Reference<MayCall>('@on.auto/operations/CallPermission', {
  defaultValue: () => grantedByTheCredential,
});

export function callPermissionDecidedBy(decisionPoint: PolicyDecisionPoint): MayCall {
  return (asked) =>
    InAConversation.use((inAConversation) =>
      Effect.map(
        enforcedDecisionOf(decisionPoint, accessRequestOfAsking(asked.operation, asked, inAConversation)),
        ({ decision }) => decision === 'allow',
      ),
    );
}

export function callPermissionReportedTo(decisionPoint: PolicyDecisionPoint): MayCall {
  return (asked) =>
    InAConversation.use((inAConversation) =>
      Effect.tap(grantedByTheCredential(asked), (granted) =>
        reportedBeside(decisionPoint, askedCallOf(asked, inAConversation), granted),
      ),
    );
}

export function callAdmittedBy(decisionPoint: PolicyDecisionPoint): CallAdmitted {
  return (asked) =>
    InAConversation.use((inAConversation) =>
      enforcedBy(decisionPoint, askedCallOf(asked, inAConversation), refusedByTheCredential(asked)),
    );
}

export function mayCall(asked: CallAsked): Effect.Effect<boolean> {
  return CallPermission.use((may) => may(asked));
}
