import { playbookGoalsIn, type GoalsDocument } from '@on.auto/definitions/goals';
import { PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { assessmentsName } from '../goal-tables/assessment-rows.ts';

export function goalsAssessedLeftOutOf(
  document: GoalsDocument,
): Effect.Effect<ReadonlySet<string>, never, PlaybookReader> {
  return Effect.gen(function* () {
    const kept = new Set(document.goals.map(({ id }) => id));
    const leftOut = (yield* playbookGoalsIn).goals.map(({ id }) => id).filter((id) => !kept.has(id));
    const reader = yield* PlaybookReader;
    const assessed = yield* Effect.forEach(leftOut, (id) =>
      Effect.map(reader.countProjectedRows(assessmentsName, [{ column: 'goal', equals: id }]), (count) =>
        count > 0 ? [id] : [],
      ),
    );
    return new Set(assessed.flat());
  });
}
