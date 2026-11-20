import { playbookCallerOf, type Decider } from '@on.auto/operations';
import type { Delivery } from '@on.auto/workflow-host';
import { Effect, Result } from 'effect';

import { assessmentAfter, unopened, type AssessmentState } from '../assessments/assessment-state.ts';
import { factsStopping, type Stopping } from '../assessments/stopping.ts';
import { AssessmentEventSchema, assessmentStreamOf, type RecordedAssessmentEvent } from '../goal-facts/goal-facts.ts';
import { deliveryDoing, goalContextOf, type Acting, type DeliveryParts } from './assessor-deliveries.ts';
import type { StoppedPlanned } from './planned-runs.ts';

function stopping(acting: Acting): Decider<AssessmentState, Stopping, RecordedAssessmentEvent> {
  return {
    initialState: unopened,
    evolve: (state, fact) => assessmentAfter(state, fact),
    decide: (stopped, state) => Result.succeed(factsStopping(state, stopped)),
    context: () => goalContextOf(acting),
    eventSchema: AssessmentEventSchema,
  };
}

export function stoppedDeliveryOf(parts: DeliveryParts, { key, stopped }: StoppedPlanned): Delivery {
  const { definition, assessment } = stopped;
  const work: Effect.Effect<unknown, unknown> = Effect.suspend(() =>
    parts.ledger.execute(
      assessmentStreamOf({ org: parts.playbook.org, definition }, assessment),
      stopping({ by: playbookCallerOf(parts.playbook).id, at: parts.now(), definition }),
      stopped,
    ),
  );
  return deliveryDoing(key, parts.workflow, work);
}
