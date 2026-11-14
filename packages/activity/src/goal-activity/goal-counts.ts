import { OrgReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { countsFor, unseenIn, type CountedActivity } from '../operations/activity-counts.ts';
import { readsAtOnce } from '../operations/activity-tables.ts';
import type { Viewer } from '../operations/activity-viewer.ts';
import { goalOverduesName } from '../projections/goal-rows.ts';
import type { ActivityCountsWithGoals } from './goal-schemas.ts';
import { goalVerdictTable } from './goal-tables.ts';

function goalsIn(viewer: Viewer, playbook: string) {
  return Effect.gen(function* () {
    const unseen = yield* unseenIn(viewer, goalVerdictTable, playbook);
    const overdue = yield* (yield* OrgReader).countPlaybookRows(playbook, goalOverduesName, [
      { column: 'open', equals: true },
    ]);
    return unseen + overdue;
  });
}

export function countsWithGoalsFor(counted: CountedActivity) {
  return Effect.gen(function* () {
    const counts = yield* countsFor(counted);
    const ofPlaybooks = yield* Effect.forEach(counted.readable, (playbook) => goalsIn(counted.viewer, playbook), {
      concurrency: readsAtOnce,
    });
    const withGoals: ActivityCountsWithGoals = {
      ...counts,
      goals: ofPlaybooks.reduce((sum, count) => sum + count, 0),
    };
    return withGoals;
  });
}
