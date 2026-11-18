import type { Decider } from '@on.auto/operations';
import { Result } from 'effect';

import { assessmentAfter, unopened, type AssessmentState } from '../assessments/assessment-state.ts';
import { factsRestoredByAsking, type AskedAgain } from '../assessments/dismissing.ts';
import { AssessmentEventSchema, type RecordedAssessmentEvent } from '../goal-facts/goal-facts.ts';

export function restoringAsked(by: string, at: number): Decider<AssessmentState, AskedAgain, RecordedAssessmentEvent> {
  return {
    initialState: unopened,
    evolve: (state, fact) => assessmentAfter(state, fact),
    decide: (asked, state) => Result.succeed(factsRestoredByAsking(state, asked)),
    context: () => ({ at: new Date(at).toISOString(), by }),
    eventSchema: AssessmentEventSchema,
  };
}
