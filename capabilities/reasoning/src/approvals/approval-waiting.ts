import type { RunContext } from '@on.auto/definitions';
import { isAPerson, personOfTheOrg } from '@on.auto/operations';
import { Effect } from 'effect';

import type { ApprovalPorts } from '../capability/run-services.ts';
import { approvalBounds } from './approval-bounds.ts';
import { approvalsSpent, noContentToGoOnFrom, nobodyToAsk, noWayToPassItOn } from './approval-words.ts';
import type { Waiting } from './pending-approvals.ts';

const nobodyAsked: Waiting = { asks: false, because: nobodyToAsk };

function waitsNot(because: string): Effect.Effect<Waiting> {
  return Effect.succeed({ asks: false, because });
}

function namedPersonOf({ caller, actsFor }: RunContext): string | undefined {
  return isAPerson(caller.id) ? caller.id : actsFor;
}

function personAsked(run: RunContext): Effect.Effect<Waiting> {
  const named = namedPersonOf(run);
  if (named === undefined) {
    return Effect.succeed(nobodyAsked);
  }
  return Effect.map(personOfTheOrg(run.org, named), (person): Waiting =>
    person === undefined ? nobodyAsked : { asks: true, person },
  );
}

export function waitingOf(ports: ApprovalPorts, run: RunContext, keepsContent: boolean): Effect.Effect<Waiting> {
  if (ports.sign === undefined) {
    return waitsNot(noWayToPassItOn);
  }
  if (!keepsContent) {
    return waitsNot(noContentToGoOnFrom);
  }
  if ((run.journal.attempt.requests ?? 0) >= approvalBounds.requestsInRun) {
    return waitsNot(approvalsSpent);
  }
  return personAsked(run);
}
