import {
  playbookCallerOf,
  type Decider,
  type Ledger,
  type PlaybookAddress,
  type PlaybookRegistry,
} from '@on.auto/operations';
import { Effect, Result } from 'effect';

import type { AssessmentOpened } from '../assessments/assessment-facts.ts';
import { assessmentAfter, unopened, type AssessmentState } from '../assessments/assessment-state.ts';
import { factsAtMoment, type Judging } from '../assessments/judging.ts';
import { openedFact } from '../assessments/opening.ts';
import {
  AssessmentEventSchema,
  assessmentStreamOf,
  type GoalAddress,
  type RecordedAssessmentEvent,
} from '../goal-facts/goal-facts.ts';
import type { Instant } from '../goal-rules/goal-rule.ts';

export interface ClockPorts {
  readonly ledger: Ledger['Service'];
  readonly registry: PlaybookRegistry['Service'];
}

export interface Acting {
  readonly address: PlaybookAddress;
  readonly now: Instant;
}

function deciderOf<Command>(
  { address, now }: Acting,
  { definition }: GoalAddress,
  decided: (command: Command, state: AssessmentState) => ReturnType<typeof factsAtMoment>,
): Decider<AssessmentState, Command, RecordedAssessmentEvent> {
  return {
    initialState: unopened,
    evolve: (state, fact) => assessmentAfter(state, fact),
    decide: (command, state) => Result.succeed(decided(command, state)),
    context: () => ({ at: new Date(now).toISOString(), by: playbookCallerOf(address).id, definitionId: definition }),
    eventSchema: AssessmentEventSchema,
  };
}

export interface Judged {
  readonly goal: GoalAddress;
  readonly assessment: string;
}

export function judgedAt(ports: ClockPorts, acting: Acting, { goal, assessment }: Judged, judging: Judging) {
  return Effect.map(
    ports.ledger.execute(
      assessmentStreamOf(goal, assessment),
      deciderOf<Judging>(acting, goal, (command, state) => factsAtMoment(state, command)),
      judging,
    ),
    ({ state }) => state,
  );
}

export function openedAt(ports: ClockPorts, acting: Acting, { goal, assessment }: Judged, opened: AssessmentOpened) {
  return ports.ledger.execute(
    assessmentStreamOf(goal, assessment),
    deciderOf<AssessmentOpened>(acting, goal, (command, state) =>
      state.pinned === undefined ? [openedFact(command)] : [],
    ),
    opened,
  );
}

export function playbookRetiredIn(ports: ClockPorts, address: PlaybookAddress): Effect.Effect<boolean> {
  return Effect.map(ports.registry.status(address), (status) => status !== 'active');
}
