import { Effect, Semaphore } from 'effect';

import { foldedPage } from '../pages/page-folding.ts';
import { hasChanged, hasTriedAgain, liveFrom, unchangedOf, type ViewChange } from '../pages/view-changes.ts';
import type { Folder } from '../projector/folder.ts';
import { runnableDetailsOf } from './view-details.ts';
import { playbooksWithViewsIn, plannedViews, rowsOfPlaybook } from './view-reconciling.ts';
import type { ViewRow } from './view-rows.ts';
import { phaseSet, viewDropped, viewsTable } from './view-statements.ts';
import { viewWritten } from './view-writing.ts';
import { shareOfThePool, type ViewsFolding } from './views-folding.ts';

export function viewsFolder(folding: ViewsFolding): Folder<ViewRow, ViewChange> {
  const share = Semaphore.makeUnsafe(shareOfThePool(folding.pool));
  return {
    definitionType: folding.definitionType,
    tables: [viewsTable],
    rebuildsAtOnce: folding.rebuildsAtOnce,
    keptOf: runnableDetailsOf,
    keyOf: ({ name }) => name,
    typesOf: ({ details }) => details.filters.map(({ type }) => type),
    playbooksWithRows: playbooksWithViewsIn,
    rowsOf: rowsOfPlaybook,
    reconcile: plannedViews,
    dropped: ({ playbookKey, name }) => [viewDropped(playbookKey, name)],
    phased: phaseSet,
    fold: (rows, page, database) =>
      Effect.map(foldedPage(rows, page, { settings: folding, share, database }), (result) => ({
        ...result,
        resting: result.changes.filter((change) => hasTriedAgain(change)).map(({ row }) => row.name),
      })),
    write: viewWritten,
    unchanged: unchangedOf,
    joinedLive: liveFrom,
    hasChanged,
  };
}
