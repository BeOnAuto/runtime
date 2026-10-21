import type { Cancelled, Failed, Rejected } from '@on.auto/operations';

import type { OptionalProblemMembers, Problem } from './problem-document.ts';
import { internalErrorProblem, problemOf } from './problem.ts';

export type Unsuccessful = Rejected | Failed | Cancelled;

export const serverStopping = problemOf('unavailable', 'The server is stopping');

export const clientClosed = problemOf('client_closed_request', 'The client closed the request before it was answered');

function optionalMembersOf({ issues, kind, because }: Rejected): OptionalProblemMembers {
  return {
    ...(issues === undefined ? {} : { errors: issues }),
    ...(kind === undefined ? {} : { kind }),
    ...(because === undefined ? {} : { because }),
  };
}

export function problemOfOutcome(outcome: Unsuccessful, clientClosedRequest: boolean): Problem {
  if (outcome.status === 'rejected') {
    return problemOf(outcome.reason, outcome.detail, optionalMembersOf(outcome));
  }
  if (outcome.status === 'failed') {
    return internalErrorProblem(outcome.incident);
  }
  return clientClosedRequest ? clientClosed : serverStopping;
}
