import type { Lineage, Settlement } from '@on.auto/operations';
import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import { openWorkflowHost, type HostOptions, type WorkflowHost } from '../host/workflow-host.ts';
import { storeSettingsOf, type HostedDatabase } from '../ledger-testing/hosted-databases.ts';
import { recordedReactions } from '../reaction-testing/recorded-reactions.ts';
import { recordedWaiting } from '../waiting-testing/recorded-waiting.ts';
import { testMachine } from './host-documents.ts';
import {
  recordingReports,
  recordingSettlements,
  type RecordingReports,
  restingOn,
  signals,
  type Signals,
} from './recording-reports.ts';
import { steppedBy, steppedClock, type SteppedClock, type SteppedSweeps } from './stepped-clock.ts';

type StartCall = Parameters<HostOptions['perform']>[0];

interface HostRecords {
  readonly calls: () => readonly StartCall[];
  readonly settlements: () => ReadonlyMap<string, Settlement>;
  readonly settledWith: () => ReadonlyMap<string, Lineage | undefined>;
  readonly settleAttempts: () => number;
  readonly troubles: () => readonly string[];
  readonly notes: RecordingReports['notes'];
  readonly know: (runId: string) => void;
  /** Answers once a read of what the host called, settled or reported holds, read again after each record. */
  readonly when: Signals['when'];
}

export interface HostedRuns extends HostRecords {
  readonly host: WorkflowHost;
  /** The clock the host sleeps on, which moves only when the test steps it. */
  readonly clock: SteppedClock;
  /** Waits for what the host keeps, stepping the clock a sweep at a time while the host is at rest. */
  readonly sweeps: SteppedSweeps;
}

export interface RecordedOptions extends HostRecords {
  readonly options: Omit<HostOptions, 'database'>;
}

/** The moment the clock of a host opened by `hostedOn` starts at, unless the test gives a clock of its own. */
export const hostedStartsAt = Date.parse('2026-10-05T09:00:00.000Z');

export interface HostedOptions {
  readonly answer?: (call: StartCall) => ReturnType<HostOptions['perform']>;
  readonly waiting?: HostOptions['waiting'];
  readonly clock?: NonNullable<HostOptions['clock']>;
  readonly sweepEveryMs?: number;
  readonly ledgerDown?: () => boolean;
  readonly holder?: string;
  readonly projector?: HostOptions['projector'];
  readonly dueWork?: HostOptions['dueWork'];
  readonly context?: HostOptions['context'];
  readonly reactions?: HostOptions['reactions'];
  readonly cacheBounds?: HostOptions['cacheBounds'];
  readonly wakeUps?: HostOptions['wakeUps'];
}

const answeredWithNull = (): ReturnType<HostOptions['perform']> =>
  Effect.succeed({ status: 'succeeded', output: null });

const ledgerUp = (): boolean => false;

type PassedThrough = Pick<
  HostOptions,
  'clock' | 'holder' | 'projector' | 'dueWork' | 'context' | 'cacheBounds' | 'wakeUps'
>;

function passedThrough(options: HostedOptions): PassedThrough {
  const { clock, holder, projector, dueWork, context, cacheBounds, wakeUps } = options;
  return {
    ...(clock === undefined ? {} : { clock }),
    ...(holder === undefined ? {} : { holder }),
    ...(projector === undefined ? {} : { projector }),
    ...(dueWork === undefined ? {} : { dueWork }),
    ...(context === undefined ? {} : { context }),
    ...(cacheBounds === undefined ? {} : { cacheBounds }),
    ...(wakeUps === undefined ? {} : { wakeUps }),
  };
}

export function recordedOptionsOf(options: HostedOptions = {}): RecordedOptions {
  const performed: StartCall[] = [];
  const seen = signals();
  const recorded = recordingReports(seen);
  const settling = recordingSettlements(options.ledgerDown ?? ledgerUp, seen);
  return {
    options: {
      machine: testMachine,
      perform: (call) =>
        Effect.suspend(() => {
          performed.push(call);
          seen.changed();
          return (options.answer ?? answeredWithNull)(call);
        }),
      settle: settling.settle,
      reports: recorded.reports,
      sweepEveryMs: options.sweepEveryMs ?? 50,
      mostCallsAtOnce: 4,
      reactions: options.reactions ?? recordedReactions().options,
      waiting: options.waiting ?? recordedWaiting().options,
      ...passedThrough(options),
      clock: restingOn(seen, options.clock),
    },
    calls: () => performed,
    settlements: settling.settlements,
    settledWith: settling.lineages,
    settleAttempts: settling.attempts,
    troubles: recorded.troubles,
    notes: recorded.notes,
    know: settling.know,
    when: seen.when,
  };
}

/**
 * A host on a clock that is not stepped, such as a skipping clock that moves the time on as each loop sleeps, for a test
 * about what a long stretch of time does that no test steps through sweep by sweep.
 */
export async function hostedOnItsClock(
  database: HostedDatabase,
  options: HostedOptions & Required<Pick<HostedOptions, 'clock'>>,
): Promise<HostRecords & { readonly host: WorkflowHost }> {
  const { options: hostOptions, ...records } = recordedOptionsOf(options);
  const host = await openWorkflowHost({ database: await storeSettingsOf(database), ...hostOptions });
  onTestFinished(() => host.stop());
  return { host, ...records };
}

export interface SteppedHostedOptions extends Omit<HostedOptions, 'clock'> {
  /** The clock the host sleeps on: one of its own, starting at `hostedStartsAt`, unless the test gives one. */
  readonly clock?: SteppedClock;
}

/** A host on a stepped clock: none of its loops sleeps on a real timer, and time moves only when the test steps it. */
export async function hostedOn(database: HostedDatabase, options: SteppedHostedOptions = {}): Promise<HostedRuns> {
  const clock = options.clock ?? steppedClock(hostedStartsAt);
  const { options: hostOptions, ...records } = recordedOptionsOf({
    ...options,
    clock,
    context: clock.watching(options.context),
  });
  const host = await openWorkflowHost({ database: await storeSettingsOf(database), ...hostOptions });
  onTestFinished(() => host.stop());
  return { host, clock, sweeps: steppedBy(clock, hostOptions.sweepEveryMs), ...records };
}
