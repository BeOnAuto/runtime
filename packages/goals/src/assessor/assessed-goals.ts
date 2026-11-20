import { playbookGoalsIn, type GoalsDocument } from '@on.auto/definitions/goals';
import { PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { assessmentsName } from '../goal-tables/assessment-rows.ts';

export function goalsAssessedLeftOutOf(
  document: GoalsDocument,
): Effect.Effect<ReadonlySet<string>, never, PlaybookReader> {
  return Effect.gen(function* () {
    const kept = new Set(document.goals.map(({ id }) => id));
    const leftOut = (yield* playbookGoalsIn).held.filter(({ goal }) => !kept.has(goal.id));
    const reader = yield* PlaybookReader;
    const assessed = yield* Effect.forEach(leftOut, ({ definition, goal }) =>
      Effect.map(reader.ofDefinition(definition).countProjectedRows(assessmentsName, []), (count) =>
        count > 0 ? [goal.id] : [],
      ),
    );
    return new Set(assessed.flat());
  });
}
