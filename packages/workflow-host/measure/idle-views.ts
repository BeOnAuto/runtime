import { setTimeout } from 'node:timers/promises';

import { statement } from '@on.auto/ledger';
import { Effect } from 'effect';

import { openWorkflowStore, type WorkflowStore } from '../src/host/workflow-store.ts';
import { ledgerConnectedOn, type DatabaseSettings } from '../src/ledger-testing/ledger-connections.ts';
import { systemClock } from '../src/loop/host-clock.ts';
import { startProjector } from '../src/projector/projector.ts';
import { measuredViewOf, measuredViews, measuringPool, recallContentOf } from './measured-views.ts';

export interface IdleViews {
  readonly views: number;
  readonly viewBytes: number;
  readonly seconds: number;
  readonly busyMsASecond: number;
}

const playbook = 'playbook/acme/alpha/';

const details = {
  language: 'typescript',
  fold: 'export function fold(view: number): number {\n  return view + 1;\n}',
  foldLine: 7,
  filters: [{ type: 'com.acme.never' }],
  initial: 0,
};

async function saved(store: WorkflowStore, index: number): Promise<void> {
  const name = `view-${index}`;
  const context = {
    by: 'acme-admin',
    at: '2026-10-06T09:00:00.000Z',
    definitionType: 'recall',
    definitionName: name,
    definitionVersion: 1,
  };
  await store.database.store.append(
    `${playbook}definitions/recall`,
    [
      {
        type: 'definition_created',
        data: { content: recallContentOf(name, details), created_by: { id: 'acme-admin', name: 'acme-admin' } },
      },
    ],
    { expectedVersion: index, context },
  );
}

async function savedInTurn(store: WorkflowStore, views: number, index = 0): Promise<void> {
  if (index < views) {
    await saved(store, index);
    await savedInTurn(store, views, index + 1);
  }
}

async function allLive(store: WorkflowStore, views: number): Promise<void> {
  const kept = await Promise.all(
    Array.from({ length: views }, (_, index) => measuredViewOf(store.database, `view-${index}`)),
  );
  if (kept.every((view) => view?.phase === 'live')) {
    return;
  }
  await setTimeout(50);
  await allLive(store, views);
}

export async function idleViewsOn(settings: DatabaseSettings, views: number, seconds: number): Promise<IdleViews> {
  const pool = measuringPool();
  const measured = measuredViews(pool);
  const ledger = await ledgerConnectedOn(settings);
  const store = await openWorkflowStore(ledger.connection, measured.folders);
  await savedInTurn(store, views);
  const projector = startProjector({
    database: store.database,
    settings: measured,
    reports: {
      unsettled: () => Effect.void,
      trouble: () => Effect.void,
      note: () => Effect.void,
    },
    clock: systemClock,
    sweepEveryMs: 1000,
  });
  await allLive(store, views);
  const view = JSON.stringify(Array.from({ length: 5000 }, (_, index) => ({ at: index, verdict: 'x'.repeat(80) })));
  await Effect.runPromise(store.database.write(statement`UPDATE recall_views SET view = ${view}`));
  const before = performance.eventLoopUtilization();
  await setTimeout(seconds * 1000);
  const busy = performance.eventLoopUtilization(before);
  await projector.stop();
  await pool.close();
  await ledger.close();
  return { views, viewBytes: view.length, seconds, busyMsASecond: busy.utilization * 1000 };
}
