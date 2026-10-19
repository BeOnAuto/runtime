import { setTimeout } from 'node:timers/promises';

import { programPool } from '@on.auto/workflow-engine/dsl';
import { Effect, Function } from 'effect';

import type { HostDatabase } from '../src/database/host-database.ts';
import type { DatabaseSettings } from '../src/database/host-databases.ts';
import { openWorkflowStore } from '../src/host/workflow-store.ts';
import { systemClock } from '../src/loop/host-clock.ts';
import { startProjector } from '../src/projector/projector.ts';
import { reviewsFold } from '../src/views-testing/campaign-reviews.ts';
import { measuredViewOf, measuredViews, recallContentOf } from './measured-views.ts';

export interface Rebuild {
  readonly events: number;
  readonly pages: number;
  readonly writes: number;
  readonly milliseconds: number;
  readonly viewBytes: number;
}

const playbook = 'playbook/acme/alpha/';

const runsInAStream = 100;

const details = {
  language: 'typescript',
  fold: reviewsFold,
  foldLine: 15,
  filters: [{ type: 'run_succeeded', subject: 'reasoning/review-brief' }],
  initial: {},
};

function succeeded(index: number) {
  const output = { campaign: `campaign-${index % 100}`, verdict: index % 3 === 0 ? 'reject' : 'approve' };
  return { type: 'run_succeeded', data: { output, record: {} } };
}

function ranAt(stream: number) {
  return {
    by: 'acme-admin',
    at: new Date(Date.UTC(2026, 9, 6) + stream * runsInAStream * 1000).toISOString(),
    definitionType: 'reasoning',
    definitionName: 'review-brief',
    definitionVersion: 1,
  };
}

async function recorded(database: HostDatabase, events: number): Promise<void> {
  const streams = Array.from({ length: events / runsInAStream }, (_, stream) => stream);
  await streams.reduce<Promise<void>>(
    (before, stream) =>
      before.then(() =>
        database.store.append(
          `${playbook}runs/0199a3c4-7d2e-7c1a-9b3f-${String(stream).padStart(12, '0')}`,
          Array.from({ length: runsInAStream }, (_, run) => succeeded(stream * runsInAStream + run)),
          { expectedVersion: 0, context: ranAt(stream) },
        ),
      ),
    Promise.resolve(),
  );
  const context = {
    by: 'acme-admin',
    at: '2026-10-06T09:00:00.000Z',
    definitionType: 'recall',
    definitionName: 'reviews',
    definitionVersion: 1,
  };
  await database.store.append(
    `${playbook}definitions/recall`,
    [
      {
        type: 'definition_created',
        data: { content: recallContentOf('reviews', details) },
      },
    ],
    { expectedVersion: 0, context },
  );
}

interface Counted {
  readonly database: HostDatabase;
  readonly pages: () => number;
  readonly writes: () => number;
}

function counted(database: HostDatabase): Counted {
  const counts = { pages: 0, writes: 0 };
  return {
    database: {
      ...database,
      write: (statement) => {
        counts.writes += statement.strings[0]?.startsWith('UPDATE recall_views SET view') === true ? 1 : 0;
        return database.write(statement);
      },
      store: {
        ...database.store,
        readRecorded: (playbookKey, selection, page) => {
          counts.pages += 1;
          return database.store.readRecorded(playbookKey, selection, page);
        },
      },
    },
    pages: () => counts.pages,
    writes: () => counts.writes,
  };
}

export async function rebuildOn(settings: DatabaseSettings, events: number): Promise<Rebuild> {
  const pool = programPool({ workers: 4, heapMegabytes: 256 });
  const measured = measuredViews(pool);
  const store = await openWorkflowStore(settings, Function.constVoid, measured.folders);
  await recorded(store.database, events);
  const counting = counted(store.database);
  const started = performance.now();
  const projector = startProjector({
    database: counting.database,
    settings: measured,
    reports: {
      unsettled: () => Effect.void,
      trouble: () => Effect.void,
      lostConnection: Function.constVoid,
      note: () => Effect.void,
    },
    clock: systemClock,
    sweepEveryMs: 1000,
  });
  const kept = await liveAfter(store, events);
  const milliseconds = performance.now() - started;
  await projector.stop();
  await pool.close();
  await store.database.close();
  return {
    events,
    pages: counting.pages(),
    writes: counting.writes(),
    milliseconds,
    viewBytes: JSON.stringify(kept).length,
  };
}

async function liveAfter(store: Awaited<ReturnType<typeof openWorkflowStore>>, events: number): Promise<unknown> {
  const kept = await measuredViewOf(store.database, 'reviews');
  if (kept?.phase === 'live' && kept.folded === events) {
    return kept.view;
  }
  await setTimeout(50);
  return liveAfter(store, events);
}
