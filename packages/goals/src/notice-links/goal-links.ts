import type { StudioLinkTo } from '@on.auto/operations';
import { Function } from 'effect';

interface GoalPlace {
  readonly playbook: string;
  readonly goal: string;
  readonly per?: string;
}

export type GoalLinkOf = (place: GoalPlace) => string | undefined;

export const noGoalLinks: GoalLinkOf = Function.constUndefined;

export function goalLinksOver(linkTo: StudioLinkTo | null): GoalLinkOf {
  if (linkTo === null) {
    return noGoalLinks;
  }
  return ({ playbook, goal, per }) => linkTo({ kind: 'goal', playbook, goal, ...(per === undefined ? {} : { per }) });
}
