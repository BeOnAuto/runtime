import { subjectPagesOf, type SubjectPages } from '@on.auto/definitions/page';
import { appendSignal, type AppendSignal, type ConnectionPorts } from '@on.auto/ledger';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import {
  openWorkflowStore,
  pageViewsFolder,
  projectorBounds,
  someFolder,
  pageFolding,
  viewsAsOfOn,
  viewsPortOn,
  type ProjectorSettings,
  type SomeFolder,
  type WorkflowStore,
} from '@on.auto/workflow-host';

import type { Settings } from '../settings/settings.ts';

interface ServedProjections {
  readonly pages: SubjectPages;
  readonly store: WorkflowStore;
  readonly projector: ProjectorSettings;
}

interface ProjectedOn extends Pick<Settings, 'projection'> {
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
    served: async ({ projection, database }, pool, besides) => {
      const pages = pageViewsFolder({ pool, rebuildsAtOnce: projection.pageRebuildsAtOnce });
      const folders = [someFolder(pages), ...besides];
      const store = await openWorkflowStore(database, folders);
      return {
        pages: subjectPagesOf({
          pool,
          views: {
            ...viewsPortOn(store.database),
            ...viewsAsOfOn(store.database, { pool, folding: pageFolding }),
          },
        }),
        store,
        projector: {
          folders,
          playbooksAtOnce: projection.playbooksAtOnce,
          pagesPerWake: projectorBounds.pagesPerWake,
          appends,
        },
      };
    },
  };
}
