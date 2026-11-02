import {
  checkedWorker,
  pageDefinitionType,
  pageDetailsIn,
  shapedViewsSchemaOf,
  type StrippedForms,
} from '@on.auto/definitions';
import { unitMemoryBytes, workerStackBytes, type ProgramPool } from '@on.auto/workflow-engine/dsl';

import type { ViewChange } from '../pages/view-changes.ts';
import type { Folder } from '../projector/folder.ts';
import { projectorBounds } from '../projector/projector-settings.ts';
import { runnableDetailsOf } from './view-details.ts';
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

function pageViewDetailsOf(details: unknown, stripped?: StrippedForms): unknown {
  const data = pageDetailsIn(details)?.data;
  if (data === undefined) {
    return details;
  }
  const { language, fold, foldLine, filters, views } = data;
  const viewDetails = { language, fold, foldLine, filters, initial: {}, schema: shapedViewsSchemaOf(views) };
  return runnableDetailsOf(viewDetails, stripped);
}

export function pageViewsFolder({
  pool,
  rebuildsAtOnce,
  folding = pageFolding,
}: PageViewsFolding): Folder<ViewRow, ViewChange> {
  const folder = viewsFolder({
    definitionType: pageDefinitionType,
    pool,
    folding,
    overtimesBeforeStall: projectorBounds.triesBeforeStall,
    rebuildsAtOnce,
  });
  return { ...folder, keptOf: pageViewDetailsOf };
}
