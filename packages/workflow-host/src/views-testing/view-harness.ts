import { appendSignal, type AppendSignal } from '@on.auto/ledger';
import { onTestFinished } from 'vitest';

import type { DatabaseSettings } from '../database/host-databases.ts';
import { openWorkflowStore, type WorkflowStore } from '../host/workflow-store.ts';
import { recordingReports, type RecordingReports } from '../testing/recording-reports.ts';
import { harnessProjectors, type HarnessProjectors } from './harness-projectors.ts';
import { playbookAppends, type PlaybookAppends } from './playbook-appends.ts';
import { testFoldPoolOf } from './test-fold-workers.ts';
import { settingsOver, type ViewSettingsOf, type ViewsProjecting } from './view-documents.ts';
import { viewReadingOf, type ViewReading } from './view-reading.ts';

export interface ViewHarness extends PlaybookAppends, ViewReading, HarnessProjectors {
  readonly store: WorkflowStore;
  readonly reports: RecordingReports;
  readonly pool: ReturnType<typeof testFoldPoolOf>;
  readonly appends: AppendSignal;
  readonly settingsOf: ViewSettingsOf;
}

export async function viewHarness(
  settings: DatabaseSettings,
  poolSettings: Parameters<typeof testFoldPoolOf>[0] = {},
  besides: ViewsProjecting['besides'] = [],
): Promise<ViewHarness> {
  const reports = recordingReports();
  const pool = testFoldPoolOf(poolSettings);
  const appends = appendSignal();
  const settingsOf = settingsOver(pool, appends);
  const store = await openWorkflowStore(settings, reports.reports.lostConnection, settingsOf({ besides }).folders);
  const projectors = harnessProjectors({ database: store.database, reports: reports.reports, settingsOf });
  onTestFinished(async () => {
    await projectors.stopProjectors();
    await pool.close();
    await store.database.close();
  });
  return {
    ...playbookAppends(store.database.store, appends),
    ...viewReadingOf(store.database),
    ...projectors,
    store,
    reports,
    pool,
    appends,
    settingsOf,
  };
}
