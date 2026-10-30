import type { Capability } from '@on.auto/definitions';
import { appendSignal, type AppendSignal, type ConnectionPorts } from '@on.auto/ledger';
import { makeRecallFunctionAdapter, recallBounds, recallDefinitionType, recallFolding } from '@on.auto/recall';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import {
  openWorkflowStore,
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
      const views = viewsFolder({
        definitionType: recallDefinitionType,
        pool,
        folding: recallFolding,
        overtimesBeforeStall: recallBounds.overtimesBeforeStall,
        rebuildsAtOnce: recall.rebuildsAtOnce,
      });
      const folders = [someFolder(views), ...besides];
      const store = await openWorkflowStore(database, folders);
      return {
        recall: makeRecallFunctionAdapter({
          pool,
          views: viewsPortOn(store.database),
          mostFunctions: recall.mostFunctions,
        }),
        store,
        projector: {
          folders,
          playbooksAtOnce: recall.playbooksAtOnce,
          pagesPerWake: recallBounds.pagesPerWake,
          appends,
        },
      };
    },
  };
}
