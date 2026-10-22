import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import {
  handedWorkersOf,
  programPool,
  unitMemoryBytes,
  workerStackBytes,
  type ProgramPool,
} from '@on.auto/workflow-engine/dsl';
import { Effect, type Schema } from 'effect';

import type { HostDatabase } from '../src/database/host-database.ts';
import { someFolder } from '../src/projector/folder.ts';
import type { ProjectorSettings } from '../src/projector/projector-settings.ts';
import type { KeptView } from '../src/views/view-rows.ts';
import { viewsFolder } from '../src/views/views-folder.ts';
import { viewsPortOn } from '../src/views/views-port.ts';

const handed = await handedWorkersOf(shippedFilesOnDisk);

export function measuringPool(): ProgramPool {
  return programPool({ handed, workers: 4, heapMegabytes: 256 });
}

export function recallContentOf(name: string, details: Schema.JsonObject): Schema.JsonObject {
  return { source: name, details };
}

export function measuredViewOf(database: HostDatabase, name: string): Promise<KeptView | undefined> {
  return Effect.runPromise(viewsPortOn(database).viewOf({ org: 'acme', playbook: 'alpha' }, name));
}

export function measuredViews(pool: ProgramPool): ProjectorSettings {
  const folding = {
    budget: 500,
    memoryBytes: unitMemoryBytes,
    stackBytes: workerStackBytes,
    foldDeadlineMs: 10_000,
    pageBudgetMs: 2000,
    mostViewBytes: 524_288,
  };
  return {
    folders: [
      someFolder(viewsFolder({ definitionType: 'recall', pool, folding, overtimesBeforeStall: 20, rebuildsAtOnce: 4 })),
    ],
    playbooksAtOnce: 4,
    pagesPerWake: 10,
  };
}
