import type { FinishesLater, RunContext } from '@on.auto/definitions';
import type { RunTools } from '@on.auto/tool-servers';
import { Clock, Effect } from 'effect';

import type { ApprovalPorts } from '../capability/run-services.ts';
import type { ApprovalSteps } from '../steps/step-decision.ts';
import type { StepState } from '../steps/step-state.ts';
import type { Spent } from '../tools/tool-endings.ts';
import { approvalRequestOf } from './approval-requests.ts';
import { waitingOf } from './approval-waiting.ts';
import type { PendingApproval, Waiting } from './pending-approvals.ts';

const offersNoTools: Waiting = { asks: false, because: 'The run offers no tools' };

function signedBy(ports: ApprovalPorts, run: RunContext): ApprovalSteps['signed'] {
  return ({ asked, person, approvedAt }, { offer, input }) =>
    ports.sign === undefined
      ? Effect.undefined
      : ports.sign({
          org: run.org,
          playbook: run.playbook,
          run_id: run.id,
          person,
          approved_at: approvedAt,
          server: offer.reference.server,
          tool: offer.reference.tool,
          arguments: input,
          asked,
        });
}

export function approvalStepsOf(
  ports: ApprovalPorts,
  run: RunContext,
  tools: RunTools | undefined,
): Effect.Effect<ApprovalSteps> {
  const waiting = tools === undefined ? Effect.succeed(offersNoTools) : waitingOf(ports, run, tools.keepsContent);
  return Effect.map(waiting, (given) => ({ waiting: given, signed: signedBy(ports, run) }));
}

export interface Deferring {
  readonly run: RunContext;
  readonly state: StepState;
  readonly approval: PendingApproval;
  readonly spent: Spent;
}

export function deferredFor({ run, state, approval, spent }: Deferring): Effect.Effect<FinishesLater> {
  return Effect.map(Clock.currentTimeMillis, (at) => ({
    finishesLater: true,
    record: approvalRequestOf({
      person: approval.person,
      at,
      functionName: run.definition.name,
      approval,
      numbering: state.facts.numbering,
      spent: spent.record,
    }),
  }));
}
