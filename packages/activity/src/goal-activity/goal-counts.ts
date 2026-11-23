import { OrgReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { countsFor, countsIn, summedCount, unseenIn, type CountedActivity } from '../operations/activity-counts.ts';
import type { Viewer } from '../operations/activity-viewer.ts';
import type { RequestsSetAside } from '../operations/needs-you.ts';
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

export function countsWithGoalsIn(viewer: Viewer, playbook: string, setAside: RequestsSetAside) {
  return Effect.gen(function* () {
    const counts = yield* countsIn(viewer, playbook, setAside);
    return { ...counts, goals: yield* goalsIn(viewer, playbook) };
  });
}

export function countsWithGoalsFor(counted: CountedActivity) {
  return Effect.map(countsFor(counted), (counts) => {
    const withGoals: ActivityCountsWithGoals = { ...counts, goals: summedCount(counted.ofPlaybooks, 'goals') };
    return withGoals;
  });
}
