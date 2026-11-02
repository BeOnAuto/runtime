import type { Capability, DefinitionKind } from '@on.auto/definitions';
import { makePageAdapter } from '@on.auto/definitions/page';
import { appendSignal, type AppendSignal, type ConnectionPorts } from '@on.auto/ledger';
import { makeRecallFunctionAdapter, recallBounds, recallDefinitionType, recallFolding } from '@on.auto/recall';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import {
  foldedBeforeItRuns,
  openWorkflowStore,
  pageViewsKept,
  someFolder,
  viewsFolder,
  viewsPortOn,
  type ProjectorSettings,
  type SomeFolder,
  type WorkflowStore,
} from '@on.auto/workflow-host';

import type { Settings } from '../settings/settings.ts';

interface ServedProjections {
  readonly recall: Capability;
  readonly page: DefinitionKind;
  readonly store: WorkflowStore;
  readonly projector: ProjectorSettings;
}

interface ProjectedOn extends Pick<Settings, 'recall'> {
  readonly database: ConnectionPorts;
}

export interface ProjectionWiring {
  readonly appends: AppendSignal;
  readonly served: (on: ProjectedOn, pool: ProgramPool, besides: readonly SomeFolder[]) => Promise<ServedProjections>;
}

export function projectionWiring(): ProjectionWiring {
  const appends = appendSignal();
  return {
    appends,
    served: async ({ recall, database }, pool, besides) => {
      const folder = viewsFolder({
        definitionType: recallDefinitionType,
        pool,
        folding: recallFolding,
        overtimesBeforeStall: recallBounds.overtimesBeforeStall,
        rebuildsAtOnce: recall.rebuildsAtOnce,
      });
      const viewFolders = [someFolder(folder)];
      const folders = [...viewFolders, ...besides];
      const store = await openWorkflowStore(database, folders);
      const views = viewsPortOn(store.database);
      return {
        recall: foldedBeforeItRuns({
          capability: makeRecallFunctionAdapter({ pool, views, mostFunctions: recall.mostFunctions }),
          folders: viewFolders,
          database: store.database,
        }),
        page: makePageAdapter({ pool, views }),
        store,
        projector: {
          folders,
          playbooksAtOnce: recall.playbooksAtOnce,
          pagesPerWake: recallBounds.pagesPerWake,
          appends,
          keptAlong: { [recallDefinitionType]: [pageViewsKept] },
        },
      };
    },
  };
}
