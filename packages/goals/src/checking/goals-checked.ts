import { goalsDocumentOf, type GoalIssue, type GoalsDocument } from '@on.auto/definitions/goals';
import type { GoalsNaming } from '@on.auto/playbooks';
import type { Result } from 'effect';

import { timingIssuesOf } from './goal-timings.ts';

export function goalsCheckedOf(
  source: string,
  naming: GoalsNaming,
  at: number,
): Result.Result<GoalsDocument, readonly GoalIssue[]> {
  return goalsDocumentOf(source, { naming, further: [timingIssuesOf(at)] });
}
