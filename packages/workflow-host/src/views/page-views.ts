import { checkedWorker } from '@on.auto/definitions';
import { unitMemoryBytes, workerStackBytes, type ProgramPool } from '@on.auto/workflow-engine/dsl';

import type { ViewChange } from '../pages/view-changes.ts';
import type { Folder } from '../projector/folder.ts';
import { projectorBounds } from '../projector/projector-settings.ts';
import { pageKeeping } from './page-keeping.ts';
import type { ViewRow } from './view-rows.ts';
import { viewsFolder } from './views-folder.ts';
import type { FoldingSettings } from './views-folding.ts';

export const pageViewsBounds = { rebuildsAtOnce: 4 } as const;

export const pageFolding: FoldingSettings = {
  budget: 500,
  memoryBytes: unitMemoryBytes,
  stackBytes: workerStackBytes,
  foldDeadlineMs: 10_000,
  pageBudgetMs: 2000,
  mostViewBytes: 524_288,
  worker: checkedWorker,
};

interface PageViewsFolding {
  readonly pool: ProgramPool;
  readonly rebuildsAtOnce: number;
  readonly folding?: FoldingSettings;
}

export function pageViewsFolder({
  pool,
  rebuildsAtOnce,
  folding = pageFolding,
}: PageViewsFolding): Folder<ViewRow, ViewChange> {
  const folder = viewsFolder({
    definitionType: 'page',
    pool,
    folding,
    overtimesBeforeStall: projectorBounds.triesBeforeStall,
    rebuildsAtOnce,
  });
  return { ...folder, ...pageKeeping, name: 'pages' };
}
