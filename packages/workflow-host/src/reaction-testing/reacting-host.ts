import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { openWorkflowHost, type HostOptions, type WorkflowHost } from '../host/workflow-host.ts';
import type { DatabaseSettings } from '../ledger-testing/ledger-connections.ts';
import { testMachine } from '../testing/host-documents.ts';
import { aSQLiteFile, connectedOn, openedOn } from '../testing/host-files.ts';
import { recordingReports, recordingSettlements, type RecordingReports } from '../testing/recording-reports.ts';
import { recordedWaiting } from '../waiting-testing/recorded-waiting.ts';
import { recordedReactions, type FailingStart, type RecordedReactions } from './recorded-reactions.ts';

const startsEveryTime: FailingStart = () => null;

export interface ReactingHost {
  readonly host: WorkflowHost;
  readonly database: HostDatabase;
  readonly reactions: RecordedReactions;
  readonly notes: RecordingReports['notes'];
  readonly settings: DatabaseSettings;
}

export interface ReactingOptions {
  readonly settings?: DatabaseSettings;
  readonly clock?: NonNullable<HostOptions['clock']>;
  readonly sweepEveryMs?: number;
  readonly failure?: FailingStart;
  readonly start?: RecordedReactions['options']['start'];
  readonly appended?: RecordedReactions['options']['appended'];
  readonly consumers?: HostOptions['consumers'];
}

export async function reactingHost(options: ReactingOptions = {}): Promise<ReactingHost> {
  const settings = options.settings ?? { store: 'sqlite', file: aSQLiteFile() };
  const reports = recordingReports();
  const reactions = recordedReactions({ failure: options.failure ?? startsEveryTime });
  const host = await openWorkflowHost({
    database: await connectedOn(settings),
    machine: testMachine,
    perform: () => Effect.succeed({ status: 'succeeded', output: null }),
    settle: recordingSettlements(() => false).settle,
    reports: reports.reports,
    sweepEveryMs: options.sweepEveryMs ?? 20,
    mostCallsAtOnce: 4,
    reactions: {
      ...reactions.options,
      start: options.start ?? reactions.options.start,
      ...(options.appended === undefined ? {} : { appended: options.appended }),
    },
    waiting: recordedWaiting().options,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.consumers === undefined ? {} : { consumers: options.consumers }),
  });
  onTestFinished(() => host.stop());
  const database = await openedOn(settings);
  return { host, database, reactions, notes: reports.notes, settings };
}
