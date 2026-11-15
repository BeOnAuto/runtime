import { Context, Effect } from 'effect';

import { permissionRefusalOf } from '../authorization/authorization.ts';
import { callSummaryOf } from '../dispatch/request.ts';
import {
  InAConversation,
  accessRequestOfAsking,
  type AskedOfACaller,
  type OperationDeclaration,
} from './access-request-of-a-call.ts';
import { enforcedDecisionOf } from './enforcement.ts';
import type { PolicyDecisionPoint } from './policy-decision-point.ts';
import { reportedBeside } from './report-only.ts';

export interface CallAsked extends AskedOfACaller {
  readonly operation: OperationDeclaration;
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
        reportedBeside(
          decisionPoint,
          {
            registration: asked.operation,
            summary: callSummaryOf(asked.operation.name, asked, asked.playbook),
            request: accessRequestOfAsking(asked.operation, asked, inAConversation),
          },
          granted,
        ),
      ),
    );
}

export function mayCall(asked: CallAsked): Effect.Effect<boolean> {
  return CallPermission.use((may) => may(asked));
}
