import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { definitionsByType } from '../projector/projector-schedule.ts';
import { reconciledRows } from '../projector/reconciled-rows.ts';
import type { KeptView, ViewRow } from '../views/view-rows.ts';
import { viewsPortOn } from '../views/views-port.ts';
import { alpha, alphaKey, viewsFolderOver, type Playbook } from './view-documents.ts';

export interface ViewReading {
  readonly viewOf: (name: string, playbook?: Playbook) => Promise<KeptView | undefined>;
}

export function viewReadingOf(database: HostDatabase): ViewReading {
  const views = viewsPortOn(database);
  const viewOf: ViewReading['viewOf'] = (name, playbook = alpha) => Effect.runPromise(views.viewOf(playbook, name));
  return {
    viewOf,
  };
}

export function viewsReconciled(
  pool: ProgramPool,
  database: HostDatabase,
  rebuildsAtOnce: number,
): () => Promise<readonly ViewRow[]> {
  const kept = { database, definitions: definitionsByType() };
  const folder = viewsFolderOver(pool, rebuildsAtOnce);
  return () => Effect.runPromise(reconciledRows(folder, kept, alphaKey));
}
