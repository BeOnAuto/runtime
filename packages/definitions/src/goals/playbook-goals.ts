import type { PlaybookContext, PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { contributesIn, type Contributes } from '../contributions/contributes-details.ts';
import { loadEachHeldOn } from '../operations/registry-access.ts';
import { stagedRegistry } from '../read-model-staging/staged-registries.ts';
import type { RegisteredDefinition } from '../registry/definition-registry.ts';
import { goalFoldOf, goalStream, standingYesOf, type GoalState } from './goal-decider.ts';
import { goalType } from './goal-names.ts';
import { goalsSourceOf, type Goal, type Goals } from './goals-document.ts';
import { workflowsArmed } from './workflows-armed.ts';

export interface AgreedGoal {
  readonly version: number;
  readonly at: string;
  readonly by: string;
}

export interface HeldGoal {
  readonly definition: string;
  readonly version: number;
  readonly goal: Goal;
  readonly agreed?: AgreedGoal;
}

export interface PlaybookGoals {
  readonly source?: string;
  readonly goals: Goals;
  readonly held: readonly HeldGoal[];
}

function isHeld(state: GoalState | undefined): state is GoalState {
  return state !== undefined && !state.removed;
}

function inTheirOrder(one: GoalState, other: GoalState): number {
  return one.position === other.position
    ? one.definition.localeCompare(other.definition)
    : one.position - other.position;
}

export const goalStatesIn: Effect.Effect<readonly GoalState[], never, PlaybookReader> = Effect.map(
  loadEachHeldOn(goalType, goalStream, goalFoldOf),
  (states) => states.filter((state) => isHeld(state)),
);

function heldGoalOf(state: GoalState): HeldGoal {
  const { definition, version, goal } = state;
  const yes = standingYesOf(state);
  return yes === undefined
    ? { definition, version, goal }
    : { definition, version, goal, agreed: { version: yes.version, at: yes.at, by: yes.by } };
}

export function playbookGoalsOf(states: readonly GoalState[]): PlaybookGoals {
  const held = states.toSorted(inTheirOrder).map((state) => heldGoalOf(state));
  const goals = held.map(({ goal }) => goal);
  return goals.length === 0 ? { goals, held } : { source: goalsSourceOf(goals), goals, held };
}

export const playbookGoalsIn: Effect.Effect<PlaybookGoals, never, PlaybookReader> = Effect.map(
  goalStatesIn,
  playbookGoalsOf,
);

export function heldGoalNamed({ held }: Pick<PlaybookGoals, 'held'>, id: string): HeldGoal | undefined {
  return held.find(({ goal }) => goal.id === id);
}

export function heldGoalOfIdentity({ held }: Pick<PlaybookGoals, 'held'>, definition?: string): HeldGoal | undefined {
  return held.find((goal) => goal.definition === definition);
}

export function goalVersionIn(goals: Pick<PlaybookGoals, 'held'>, id: string): number {
  return heldGoalNamed(goals, id)?.version ?? 0;
}

interface StandingWorkflow {
  readonly name: string;
  readonly version: number;
  readonly paused: boolean;
  readonly contributes: Contributes;
}

export interface GoalStanding extends PlaybookGoals {
  readonly workflows: readonly StandingWorkflow[];
  readonly notifiers: ReadonlySet<string>;
  readonly armedAt?: number;
}

function notRetired(definitions: Iterable<RegisteredDefinition>): readonly RegisteredDefinition[] {
  return [...definitions].filter(({ status }) => status !== 'retired');
}

function standingWorkflowOf({ name, version, status, details }: RegisteredDefinition): StandingWorkflow {
  return { name, version, paused: status === 'paused', contributes: contributesIn(details) ?? [] };
}

function isNotification({ output_schema: answer, details }: RegisteredDefinition): boolean {
  return answer === undefined && details?.['call'] === undefined;
}

export const goalStandingIn: Effect.Effect<GoalStanding, never, PlaybookReader | PlaybookContext> = Effect.gen(
  function* () {
    const goals = yield* playbookGoalsIn;
    const { workflows: registered, ...armed } = yield* workflowsArmed;
    const workflows = notRetired(registered).map((stored) => standingWorkflowOf(stored));
    const interactions = notRetired((yield* stagedRegistry('interaction')).values());
    const notifiers = new Set(interactions.filter((stored) => isNotification(stored)).map(({ name }) => name));
    return { ...goals, workflows, notifiers, ...armed };
  },
);
