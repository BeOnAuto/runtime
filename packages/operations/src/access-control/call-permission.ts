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
import { allowedEachOf, enforcedBy } from './enforcement.ts';
import type { PolicyDecisionPoint } from './policy-decision-point.ts';
import { reportedBeside, type AskedCall } from './report-only.ts';

export interface CallAsked extends AskedOfACaller {
  readonly operation: OperationDeclaration;
}

type MayCallEach = (asked: readonly CallAsked[]) => Effect.Effect<readonly boolean[]>;

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

function grantedByTheCredential({ operation, caller }: CallAsked): boolean {
  return permissionRefusalOf(operation.permissions, caller) === undefined;
}

function eachGrantedByTheCredential(asked: readonly CallAsked[]): Effect.Effect<readonly boolean[]> {
  return Effect.succeed(asked.map((each) => grantedByTheCredential(each)));
}

export const CallPermission = Context.Reference<MayCallEach>('@on.auto/operations/CallPermission', {
  defaultValue: () => eachGrantedByTheCredential,
});

export function callPermissionDecidedBy(decisionPoint: PolicyDecisionPoint): MayCallEach {
  return (asked) =>
    InAConversation.use((inAConversation) =>
      allowedEachOf(
        decisionPoint,
        asked.map((each) => accessRequestOfAsking(each.operation, each, inAConversation)),
      ),
    );
}

export function callPermissionReportedTo(decisionPoint: PolicyDecisionPoint): MayCallEach {
  return (asked) =>
    InAConversation.use((inAConversation) =>
      Effect.forEach(asked, (each) => {
        const granted = grantedByTheCredential(each);
        return Effect.as(reportedBeside(decisionPoint, askedCallOf(each, inAConversation), granted), granted);
      }),
    );
}

export function callAdmittedBy(decisionPoint: PolicyDecisionPoint): CallAdmitted {
  return (asked) =>
    InAConversation.use((inAConversation) =>
      enforcedBy(decisionPoint, askedCallOf(asked, inAConversation), refusedByTheCredential(asked)),
    );
}

export function mayCallEach(asked: readonly CallAsked[]): Effect.Effect<readonly boolean[]> {
  return CallPermission.use((may) => may(asked));
}

export function mayCall(asked: CallAsked): Effect.Effect<boolean> {
  return Effect.map(mayCallEach([asked]), ([may]) => may === true);
}
