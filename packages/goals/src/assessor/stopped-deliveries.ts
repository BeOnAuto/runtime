import { playbookCallerOf, streamPrefixOfPlaybook, type Decider } from '@on.auto/operations';
import type { Delivery } from '@on.auto/workflow-host';
import { Effect, Result } from 'effect';

import { assessmentAfter, unopened, type AssessmentState } from '../assessments/assessment-state.ts';
import { factsStopping, type Stopping } from '../assessments/stopping.ts';
import { AssessmentEventSchema, assessmentsKind, type RecordedAssessmentEvent } from '../goal-facts/goal-facts.ts';
import { deliveryDoing, type DeliveryParts } from './assessor-deliveries.ts';
import type { StoppedPlanned } from './planned-runs.ts';

function stopping(by: string, at: number): Decider<AssessmentState, Stopping, RecordedAssessmentEvent> {
  return {
    initialState: unopened,
    evolve: (state, fact) => assessmentAfter(state, fact),
    decide: (stopped, state) => Result.succeed(factsStopping(state, stopped)),
    context: () => ({ at: new Date(at).toISOString(), by }),
    eventSchema: AssessmentEventSchema,
  };
}

export function stoppedDeliveryOf(parts: DeliveryParts, { key, stopped }: StoppedPlanned): Delivery {
  const work: Effect.Effect<unknown, unknown> = Effect.suspend(() =>
    parts.ledger.execute(
      `${streamPrefixOfPlaybook(parts.playbook)}${assessmentsKind}/${stopped.assessment}`,
      stopping(playbookCallerOf(parts.playbook).id, parts.now()),
      stopped,
    ),
  );
  return deliveryDoing(key, parts.workflow, work);
}
