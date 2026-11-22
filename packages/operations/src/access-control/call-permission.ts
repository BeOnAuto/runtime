import { Context, Effect } from 'effect';

import { permissionRefusalOf } from '../authorization/authorization.ts';
import { callSummaryOf } from '../dispatch/request.ts';
import { busyRefusal } from '../outcome/busy.ts';
import { rejected, type Rejected } from '../outcome/outcome.ts';
import { Unavailable } from '../outcome/unavailable.ts';
import {
  InAConversation,
  accessRequestOfAsking,
  type AskedOfACaller,
  type OperationDeclaration,
} from './access-request-of-a-call.ts';
import { allowedEachOf, enforcedBy, nothingDone, undecidedMessage, type MayCall } from './enforcement.ts';
import type { PolicyDecisionPoint } from './policy-decision-point.ts';
import { reportedBeside, type AskedCall } from './report-only.ts';

export interface CallAsked extends AskedOfACaller {
  readonly operation: OperationDeclaration;
}

type MayCallEach = (asked: readonly CallAsked[]) => Effect.Effect<readonly MayCall[], Unavailable>;

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
      Effect.flatMap(
        allowedEachOf(
          decisionPoint,
          asked.map((each) => accessRequestOfAsking(each.operation, each, inAConversation)),
        ),
        (answers) =>
          'decision' in answers ? Effect.fail(busyRefusal(nothingDone, answers.retryAfter)) : Effect.succeed(answers),
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

const undecidedListing = 'Auto could not check what you may use just now. Ask again in a moment.';

/**
 * The refusal of a listing that asked about an operation whose decision carried an error: unavailable, plainly, never
 * a shorter list served as though it were complete. Logged once, with the numbers of operations asked and undecided.
 */
function refusedUndecidedListing(operations: number, undecided: number): Effect.Effect<never, Unavailable> {
  return Effect.logWarning(undecidedMessage).pipe(
    Effect.annotateLogs({ operations, undecided }),
    Effect.andThen(Effect.fail(new Unavailable({ detail: undecidedListing }))),
  );
}

function isDecided(may: MayCall): may is boolean {
  return may !== 'indeterminate';
}

/**
 * Whether the caller may call each operation, as a listing asks: refused as unavailable, never answered shorter, where
 * the decision of any of them carried an error, and refused as busy where the batch was not answered in time.
 */
export function mayCallEach(asked: readonly CallAsked[]): Effect.Effect<readonly boolean[], Unavailable> {
  return Effect.flatMap(
    CallPermission.use((may) => may(asked)),
    (answers): Effect.Effect<readonly boolean[], Unavailable> => {
      const decided = answers.filter((may) => isDecided(may));
      return decided.length === answers.length
        ? Effect.succeed(decided)
        : refusedUndecidedListing(answers.length, answers.length - decided.length);
    },
  );
}

/** Whether the caller may call one operation, as a question asked to offer or explain: no where it is not decided. */
export function mayCall(asked: CallAsked): Effect.Effect<boolean, Unavailable> {
  return Effect.map(
    CallPermission.use((may) => may([asked])),
    ([may]) => may === true,
  );
}
