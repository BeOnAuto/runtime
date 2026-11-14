import type { Issue } from '@on.auto/operations';

import type { ContributionEntry, Goal, Goals } from '../goals/goals-document.ts';
import type { Contributes } from './contributes-details.ts';
import { contributesWantedWords, contributionWords } from './contribution-words.ts';

const contributesPlace = '/source/contributes';

function placeOf(index: number, key?: string): string {
  return key === undefined ? `${contributesPlace}/${String(index)}` : `${contributesPlace}/${String(index)}/${key}`;
}

function isRetired({ retired }: Goal): boolean {
  return retired === true;
}

function measureIssues({ measures, final, as_of: asOf }: ContributionEntry, index: number): readonly Issue[] {
  if (measures !== undefined) {
    return [];
  }
  return [
    ...(final === undefined
      ? []
      : [{ pointer: placeOf(index, 'final'), detail: contributionWords.finalWithoutMeasures }]),
    ...(asOf === undefined
      ? []
      : [{ pointer: placeOf(index, 'as_of'), detail: contributionWords.asOfWithoutMeasures }]),
  ];
}

function milestoneIssues(goal: Goal, { marks }: ContributionEntry, index: number): readonly Issue[] {
  const milestones = (goal.milestones ?? []).map(({ id }) => id);
  if (marks === undefined || milestones.includes(marks)) {
    return [];
  }
  return [{ pointer: placeOf(index, 'marks'), detail: contributionWords.unknownMilestone(goal.id, marks, milestones) }];
}

function perIssues(goal: Goal, entry: ContributionEntry, index: number): readonly Issue[] {
  if (goal.per !== undefined) {
    return entry.per_id === undefined
      ? [{ pointer: placeOf(index), detail: contributionWords.perIdWanted(goal.id, goal.per) }]
      : [];
  }
  return entry.each === undefined
    ? []
    : [{ pointer: placeOf(index, 'each'), detail: contributionWords.eachUnwanted(goal.id) }];
}

function windowIssues(goal: Goal, { final }: ContributionEntry, index: number): readonly Issue[] {
  return goal.window === undefined && final !== undefined
    ? [{ pointer: placeOf(index, 'final'), detail: contributionWords.finalWithoutWindow(goal.id) }]
    : [];
}

function goalIssues(goals: Goals, entry: ContributionEntry, index: number): readonly Issue[] {
  const goal = goals.find(({ id }) => id === entry.goal);
  if (goal === undefined) {
    const kept = goals.filter((held) => !isRetired(held)).map(({ id }) => id);
    return [{ pointer: placeOf(index, 'goal'), detail: contributionWords.unknownGoal(entry.goal, kept) }];
  }
  if (isRetired(goal)) {
    return [{ pointer: placeOf(index, 'goal'), detail: contributionWords.retiredGoal(goal.id) }];
  }
  return [
    ...perIssues(goal, entry, index),
    ...milestoneIssues(goal, entry, index),
    ...windowIssues(goal, entry, index),
  ];
}

export function contributionIssuesOf(goals: Goals, contributes: Contributes | undefined): readonly Issue[] {
  if (contributes === undefined || contributes.length === 0) {
    return [{ pointer: '/source', detail: contributesWantedWords }];
  }
  return contributes.flatMap((entry, index) => [...goalIssues(goals, entry, index), ...measureIssues(entry, index)]);
}
