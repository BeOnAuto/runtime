import { appendSignal, type AppendSignal } from '@on.auto/ledger';
import { onTestFinished } from 'vitest';

import { openWorkflowStore, type WorkflowStore } from '../host/workflow-store.ts';
import { connectedOn, type DatabaseSettings } from '../testing/host-files.ts';
import { recordingReports, type RecordingReports } from '../testing/recording-reports.ts';
import { harnessProjectors, type HarnessProjectors } from './harness-projectors.ts';
import { playbookAppends, type PlaybookAppends } from './playbook-appends.ts';
import { testFoldPoolOf, testFoldThreadPoolOf } from './test-fold-workers.ts';
import { settingsOver, type Playbook, type ViewSettingsOf, type ViewsProjecting } from './view-documents.ts';
import { viewReadingOf, type ViewReading } from './view-reading.ts';

type ProgramPool = ReturnType<typeof testFoldPoolOf>;

type KeptView = NonNullable<Awaited<ReturnType<ViewReading['viewOf']>>>;

export interface ViewHarness extends PlaybookAppends, ViewReading, HarnessProjectors {
  readonly store: WorkflowStore;
  readonly reports: RecordingReports;
  readonly pool: ProgramPool;
  readonly appends: AppendSignal;
  readonly settingsOf: ViewSettingsOf;
  readonly folded: (name: string, holds: (view: KeptView) => boolean, playbook?: Playbook) => Promise<KeptView>;
  readonly gone: (name: string) => Promise<boolean>;
}

/** A harness whose folds are served on the thread of the test, for every rule that is not the worker thread itself. */
export function viewHarness(
  settings: DatabaseSettings,
  poolSettings: Parameters<typeof testFoldPoolOf>[0] = {},
  besides: ViewsProjecting['besides'] = [],
): Promise<ViewHarness> {
  return viewHarnessOver(settings, testFoldThreadPoolOf(poolSettings), besides);
}

/**
 * The harness of `viewHarness`, its folds served on worker threads, for a rule about the worker itself: its memory,
 * its deadline, its crash, and the wiring of the pool to real threads.
 */
export function viewHarnessOnAWorker(
  settings: DatabaseSettings,
  poolSettings: Parameters<typeof testFoldPoolOf>[0] = {},
  besides: ViewsProjecting['besides'] = [],
): Promise<ViewHarness> {
  return viewHarnessOver(settings, testFoldPoolOf(poolSettings), besides);
}

async function viewHarnessOver(
  settings: DatabaseSettings,
  pool: ProgramPool,
  besides: ViewsProjecting['besides'],
): Promise<ViewHarness> {
  const reports = recordingReports();
  const appends = appendSignal();
  const settingsOf = settingsOver(pool, appends);
  const store = await openWorkflowStore(await connectedOn(settings), settingsOf({ besides }).folders);
  const projectors = harnessProjectors({ database: store.database, reports: reports.reports, settingsOf });
  onTestFinished(async () => {
    await projectors.stopProjectors();
    await pool.close();
  });
  const reading = viewReadingOf(store.database);
  return {
    ...playbookAppends(store.database.store, appends),
    ...reading,
    folded: (name, holds, playbook) =>
      projectors.whenFolded(
        () => reading.viewOf(name, playbook),
        (read): read is KeptView => read !== undefined && holds(read),
      ),
    gone: async (name) => {
      await projectors.whenFolded(
        () => reading.viewOf(name),
        (read) => read === undefined,
      );
      return true;
    },
    ...projectors,
    store,
    reports,
    pool,
    appends,
    settingsOf,
  };
}
