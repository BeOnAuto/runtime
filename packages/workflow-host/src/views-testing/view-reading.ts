import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';
import { expect } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { definitionsByType } from '../projector/projector-schedule.ts';
import { reconciledRows } from '../projector/reconciled-rows.ts';
import { until } from '../testing/until.ts';
import type { KeptView, ViewRow } from '../views/view-rows.ts';
import { viewsPortOn } from '../views/views-port.ts';
import { alpha, alphaKey, viewsFolderOver, type Playbook } from './view-documents.ts';

export interface ViewReading {
  readonly viewOf: (name: string, playbook?: Playbook) => Promise<KeptView | undefined>;
  readonly until: (name: string, holds: (view: KeptView) => boolean, playbook?: Playbook) => Promise<KeptView>;
  readonly gone: (name: string) => Promise<boolean>;
}

export function viewReadingOf(database: HostDatabase): ViewReading {
  const views = viewsPortOn(database);
  const viewOf: ViewReading['viewOf'] = (name, playbook = alpha) => Effect.runPromise(views.viewOf(playbook, name));
  return {
    viewOf,
    until: (name, holds, playbook = alpha) =>
      until(async () => {
        const view = await viewOf(name, playbook);
        if (view === undefined || !holds(view)) {
          throw new Error(`The view of ${name} does not hold yet: ${JSON.stringify(view)}`);
        }
        return view;
      }),
    gone: (name) =>
      until(async () => {
        expect(await viewOf(name)).toBeUndefined();
        return true;
      }),
  };
}

export function viewsReconciled(
  pool: ProgramPool,
  database: HostDatabase,
  rebuildsAtOnce: number,
): () => Promise<readonly ViewRow[]> {
  const kept = { database, definitions: definitionsByType().of };
  const folder = viewsFolderOver(pool, rebuildsAtOnce);
  return () => Effect.runPromise(reconciledRows(folder, kept, alphaKey));
}
