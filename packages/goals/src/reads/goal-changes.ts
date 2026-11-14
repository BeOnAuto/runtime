import { changeKindOf, changingOne, type ChangeNaming } from '@on.auto/operations';

import { assessmentsKind, goalRefusalsKind } from '../goal-facts/goal-facts.ts';
import { assessmentRows } from '../goal-tables/assessment-rows.ts';
import { refusalRows } from '../goal-tables/refusal-rows.ts';

const goalChanged = changeKindOf('goal', 'The goals of the playbook, or how one of them is judged', {});

function goalChangeOf(streamKind: string, types: readonly string[]): ChangeNaming {
  return { streamKind, changes: changingOne(goalChanged, types, () => [goalChanged.of({})]) };
}

export const goalChanges: readonly ChangeNaming[] = [
  goalChangeOf('goals', ['playbook_goals_saved', 'playbook_goals_agreed']),
  goalChangeOf(assessmentsKind, assessmentRows.types),
  goalChangeOf(goalRefusalsKind, refusalRows.types),
];

export function goalChangeNamings(goals: boolean): readonly ChangeNaming[] {
  return goals ? goalChanges : [];
}
