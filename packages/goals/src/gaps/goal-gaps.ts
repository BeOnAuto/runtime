import type { Contributes, Goal, Goals } from '@on.auto/definitions/goals';
import { noGoalGap, type GoalGap, type GoalsAnswer } from '@on.auto/playbooks';

import {
  goalOrphanedGap,
  measureNeverFinalGap,
  measurePausedGap,
  measureUnreportedGap,
  milestoneOrphanedGap,
  milestoneUnmarkedGap,
  noMilestonesGap,
  noticeFunctionMissingGap,
  windowNeverStartsGap,
  workflowWithoutContributionGap,
} from './gap-words.ts';

export interface StandingWorkflow {
  readonly name: string;
  readonly version: number;
  readonly paused: boolean;
  readonly contributes: Contributes;
}

export interface GoalsStanding {
  readonly version: number;
  readonly source?: string;
  readonly goals: Goals;
  readonly workflows: readonly StandingWorkflow[];
  readonly notifiers: ReadonlySet<string>;
}

interface Contributed {
  readonly workflow: string;
  readonly entry: Contributes[number];
}

function contributedBy(workflows: readonly StandingWorkflow[]): readonly Contributed[] {
  return workflows.flatMap(({ name, contributes }) => contributes.map((entry) => ({ workflow: name, entry })));
}

function toGoal(contributed: readonly Contributed[], goal: string): readonly Contributed[] {
  return contributed.filter(({ entry }) => entry.goal === goal);
}

function measuring(contributed: readonly Contributed[]): readonly Contributed[] {
  return contributed.filter(({ entry }) => entry.measures !== undefined);
}

function distinct(names: readonly (string | undefined)[]): readonly string[] {
  return [...new Set(names.filter((name) => name !== undefined))];
}

function milestonesOf({ milestones = [] }: Goal) {
  return milestones;
}

function afterOf({ window }: Goal): string | undefined {
  return window !== undefined && 'after' in window ? window.after : undefined;
}

function noMilestonesGaps(goal: Goal): readonly GoalGap[] {
  return goal.per !== undefined && milestonesOf(goal).length === 0 ? [noMilestonesGap(goal, goal.per)] : [];
}

function measureGaps(goal: Goal, active: readonly Contributed[], paused: readonly Contributed[]): readonly GoalGap[] {
  const reporting = measuring(active);
  if (reporting.length > 0) {
    const final = reporting.some(({ entry }) => entry.final !== undefined);
    return goal.window === undefined || final ? [] : [measureNeverFinalGap(goal)];
  }
  const resting = measuring(paused);
  return resting.length > 0
    ? [measurePausedGap(goal, distinct(resting.map(({ workflow }) => workflow)))]
    : [measureUnreportedGap(goal)];
}

function markGaps(goal: Goal, active: readonly Contributed[]): readonly GoalGap[] {
  const marked = new Set(active.map(({ entry }) => entry.marks));
  const after = afterOf(goal);
  const unmarked = milestonesOf(goal).filter(({ id }) => !marked.has(id));
  return unmarked.map((milestone) =>
    milestone.id === after ? windowNeverStartsGap(goal, after, milestone.label) : milestoneUnmarkedGap(goal, milestone),
  );
}

function orphanedMarkGaps(goal: Goal, active: readonly Contributed[]): readonly GoalGap[] {
  const named = new Set(milestonesOf(goal).map(({ id }) => id));
  return active.flatMap(({ workflow, entry: { marks } }) =>
    marks === undefined || named.has(marks) ? [] : [milestoneOrphanedGap(goal.id, workflow, marks)],
  );
}

function noticeGaps(goal: Goal, notifiers: ReadonlySet<string>): readonly GoalGap[] {
  const through = goal.notify?.through;
  return distinct([through, goal.notify?.summary?.through ?? through])
    .filter((name) => !notifiers.has(name))
    .map((name) => noticeFunctionMissingGap(goal, name));
}

function retiredGoalGaps(goal: Goal, active: readonly Contributed[]): readonly GoalGap[] {
  return distinct(active.map(({ workflow }) => workflow)).map((workflow) => goalOrphanedGap(goal.id, workflow, true));
}

function keptGoalGaps(
  goal: Goal,
  active: readonly Contributed[],
  paused: readonly Contributed[],
  notifiers: ReadonlySet<string>,
): readonly GoalGap[] {
  return [
    ...noMilestonesGaps(goal),
    ...measureGaps(goal, active, paused),
    ...markGaps(goal, active),
    ...orphanedMarkGaps(goal, active),
    ...noticeGaps(goal, notifiers),
  ];
}

function unknownGoalGaps(goals: Goals, active: readonly Contributed[]): readonly GoalGap[] {
  const known = new Set(goals.map(({ id }) => id));
  const orphans = active.filter(({ entry }) => !known.has(entry.goal));
  const byPair = new Map(
    orphans.map(({ entry, workflow }) => [`${entry.goal} ${workflow}`, goalOrphanedGap(entry.goal, workflow, false)]),
  );
  return [...byPair.values()];
}

export function goalsGapsOf({ goals, workflows, notifiers }: GoalsStanding): readonly GoalGap[] {
  const running = workflows.filter(({ paused }) => !paused);
  const active = contributedBy(running);
  const paused = contributedBy(workflows.filter(({ paused: resting }) => resting));
  const ofGoal = (goal: Goal) => {
    const own = toGoal(active, goal.id);
    return goal.retired === true
      ? retiredGoalGaps(goal, own)
      : keptGoalGaps(goal, own, toGoal(paused, goal.id), notifiers);
  };
  return [
    ...running
      .filter(({ contributes }) => contributes.length === 0)
      .map(({ name }) => workflowWithoutContributionGap(name)),
    ...goals.flatMap((goal) => ofGoal(goal)),
    ...unknownGoalGaps(goals, active),
  ];
}

export function goalsAnsweredOf(standing: GoalsStanding): GoalsAnswer {
  const { source, version } = standing;
  return source === undefined ? { gaps: [noGoalGap] } : { source, version, gaps: goalsGapsOf(standing) };
}
