import { goalFactTypes } from '@on.auto/definitions/goals';
import { changeKindOf, changingOne, type ChangeNaming, type ChangesNamed } from '@on.auto/operations';

import { goalRefusalsKind } from '../goal-facts/goal-facts.ts';
import { refusalRows } from '../goal-tables/refusal-rows.ts';

const goalChanged = changeKindOf('goal', 'The goals of the playbook, or how one of them is judged', {});

export function goalChangesOf(types: readonly string[]): ChangesNamed {
  return changingOne(goalChanged, types, () => [goalChanged.of({})]);
}

function goalChangeOf(streamKind: string, types: readonly string[]): ChangeNaming {
  return { streamKind, changes: goalChangesOf(types) };
}

export const goalChanges: readonly ChangeNaming[] = [
  goalChangeOf('goals', goalFactTypes),
  goalChangeOf(goalRefusalsKind, refusalRows.types),
];

export function goalChangeNamings(goals: boolean): readonly ChangeNaming[] {
  return goals ? goalChanges : [];
}
