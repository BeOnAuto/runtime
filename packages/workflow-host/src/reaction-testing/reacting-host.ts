import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { openWorkflowHost, type HostOptions, type WorkflowHost } from '../host/workflow-host.ts';
import { testMachine } from '../testing/host-documents.ts';
import { aSQLiteFile, connectedOn, openedOn, type DatabaseSettings } from '../testing/host-files.ts';
import {
  recordingReports,
  recordingSettlements,
  type RecordingReports,
  restingOn,
  signals,
} from '../testing/recording-reports.ts';
import { recordedWaiting } from '../waiting-testing/recorded-waiting.ts';
import { testDefinitionsPlaced } from './playbook-writes.ts';
import { recordedReactions, type FailingStart, type RecordedReactions } from './recorded-reactions.ts';

const startsEveryTime: FailingStart = () => null;

export interface ReactingHost {
  readonly host: WorkflowHost;
  readonly database: HostDatabase;
  readonly reactions: RecordedReactions;
  readonly notes: RecordingReports['notes'];
  readonly when: RecordingReports['when'];
  /** Answers once a read that answers later holds, read again after each report and each time the host rests. */
  readonly whenRead: ReturnType<typeof signals>['whenRead'];
  readonly settings: DatabaseSettings;
}

export interface ReactingOptions {
  readonly settings?: DatabaseSettings;
  readonly clock?: NonNullable<HostOptions['clock']>;
  readonly sweepEveryMs?: number;
  readonly failure?: FailingStart;
  readonly start?: RecordedReactions['options']['start'];
  readonly emit?: RecordedReactions['options']['emit'];
  readonly appended?: RecordedReactions['options']['appended'];
  readonly consumers?: HostOptions['consumers'];
  readonly context?: HostOptions['context'];
}

function givenOptionsOf({
  clock,
  consumers,
  context,
}: ReactingOptions): Partial<Pick<HostOptions, 'clock' | 'consumers' | 'context'>> {
  return {
    ...(clock === undefined ? {} : { clock }),
    ...(consumers === undefined ? {} : { consumers }),
    ...(context === undefined ? {} : { context }),
  };
}

export async function reactingHost(options: ReactingOptions = {}): Promise<ReactingHost> {
  const settings = options.settings ?? { store: 'sqlite', file: aSQLiteFile() };
  const seen = signals();
  const reports = recordingReports(seen);
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
      emit: options.emit ?? reactions.options.emit,
      ...(options.appended === undefined ? {} : { appended: options.appended }),
    },
    waiting: recordedWaiting().options,
    ...givenOptionsOf(options),
    clock: restingOn(seen, options.clock),
  });
  onTestFinished(() => host.stop());
  const database = await openedOn(settings);
  await testDefinitionsPlaced(database.store);
  return { host, database, reactions, notes: reports.notes, when: reports.when, whenRead: seen.whenRead, settings };
}
