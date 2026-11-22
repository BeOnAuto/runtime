import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import { openWorkflowHost, type HostOptions, type WorkflowHost } from '../host/workflow-host.ts';
import { testMachine } from '../testing/host-documents.ts';
import { aLedgerInMemory, connectedOn, openedOn, type LedgerOn } from '../testing/host-files.ts';
import {
  recordingReports,
  recordingSettlements,
  type RecordingReports,
  restingOn,
  signals,
} from '../testing/recording-reports.ts';
import { recordedWaiting } from '../waiting-testing/recorded-waiting.ts';
import { testDefinitionsPlaced } from './playbook-writes.ts';
import {
  reactingStartsAt,
  steppedBy,
  steppedMovedClock,
  type SteppedMovedClock,
  type SteppedSweeps,
} from './reacting-clock.ts';
import { recordedReactions, type FailingStart, type RecordedReactions } from './recorded-reactions.ts';

const startsEveryTime: FailingStart = () => null;

type HostDatabase = Awaited<ReturnType<typeof openedOn>>;

export interface ReactingHost {
  readonly host: WorkflowHost;
  readonly database: HostDatabase;
  readonly reactions: RecordedReactions;
  readonly notes: RecordingReports['notes'];
  readonly when: RecordingReports['when'];
  /** The clock the host sleeps on, which moves only when the test moves it. */
  readonly clock: SteppedMovedClock;
  /** Waits for what the host keeps, stepping the clock a sweep at a time while the host is at rest. */
  readonly sweeps: SteppedSweeps;
  readonly settings: LedgerOn;
}

export interface ReactingOptions {
  readonly settings?: LedgerOn;
  /** The clock the host sleeps on: one of its own, a second after the activation, unless the test gives one. */
  readonly clock?: SteppedMovedClock;
  readonly sweepEveryMs?: number;
  readonly failure?: FailingStart;
  readonly start?: RecordedReactions['options']['start'];
  readonly emit?: RecordedReactions['options']['emit'];
  readonly appended?: RecordedReactions['options']['appended'];
  readonly consumers?: HostOptions['consumers'];
  readonly context?: HostOptions['context'];
}

function givenOptionsOf({ consumers }: ReactingOptions): Partial<Pick<HostOptions, 'consumers'>> {
  return consumers === undefined ? {} : { consumers };
}

/** The sweep a reacting host takes, unless a test names another. */
const sweepOfAReactingHostMs = 20;

/** A reacting host on a stepped clock: none of its loops sleeps on a real timer. */
export async function reactingHost(options: ReactingOptions = {}): Promise<ReactingHost> {
  const clock = options.clock ?? steppedMovedClock(reactingStartsAt);
  const sweepEveryMs = options.sweepEveryMs ?? sweepOfAReactingHostMs;
  const settings = options.settings ?? (await aLedgerInMemory());
  const seen = signals();
  const reports = recordingReports(seen);
  const reactions = recordedReactions({ failure: options.failure ?? startsEveryTime });
  const host = await openWorkflowHost({
    database: await connectedOn(settings),
    machine: testMachine,
    perform: () => Effect.succeed({ status: 'succeeded', output: null }),
    settle: recordingSettlements(() => false).settle,
    reports: reports.reports,
    sweepEveryMs,
    mostCallsAtOnce: 4,
    reactions: {
      ...reactions.options,
      start: options.start ?? reactions.options.start,
      emit: options.emit ?? reactions.options.emit,
      ...(options.appended === undefined ? {} : { appended: options.appended }),
    },
    waiting: recordedWaiting().options,
    ...givenOptionsOf(options),
    context: clock.watching(options.context),
    clock: restingOn(seen, clock),
  });
  onTestFinished(() => host.stop());
  const database = await openedOn(settings);
  await testDefinitionsPlaced(database.store);
  return {
    host,
    database,
    reactions,
    notes: reports.notes,
    when: reports.when,
    clock,
    sweeps: steppedBy(clock, sweepEveryMs),
    settings,
  };
}
