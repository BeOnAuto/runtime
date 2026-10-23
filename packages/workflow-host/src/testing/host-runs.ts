import type { Lineage, Settlement } from '@on.auto/operations';
import type { StartCall } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import { openWorkflowHost, type HostOptions, type WorkflowHost } from '../host/workflow-host.ts';
import { recordedReactions } from '../reaction-testing/recorded-reactions.ts';
import { recordedWaiting } from '../waiting-testing/recorded-waiting.ts';
import { testMachine } from './host-documents.ts';
import { recordingReports, recordingSettlements, type RecordingReports } from './recording-reports.ts';

interface HostRecords {
  readonly calls: () => readonly StartCall[];
  readonly settlements: () => ReadonlyMap<string, Settlement>;
  readonly settledWith: () => ReadonlyMap<string, Lineage | undefined>;
  readonly settleAttempts: () => number;
  readonly troubles: () => readonly string[];
  readonly notes: RecordingReports['notes'];
  readonly know: (runId: string) => void;
}

export interface HostedRuns extends HostRecords {
  readonly host: WorkflowHost;
}

export interface RecordedOptions extends HostRecords {
  readonly options: Omit<HostOptions, 'database'>;
}

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
}

const answeredWithNull = (): ReturnType<HostOptions['perform']> =>
  Effect.succeed({ status: 'succeeded', output: null });

const ledgerUp = (): boolean => false;

export function recordedOptionsOf(options: HostedOptions = {}): RecordedOptions {
  const performed: StartCall[] = [];
  const recorded = recordingReports();
  const settling = recordingSettlements(options.ledgerDown ?? ledgerUp);
  return {
    options: {
      machine: testMachine,
      perform: (call) =>
        Effect.suspend(() => {
          performed.push(call);
          return (options.answer ?? answeredWithNull)(call);
        }),
      settle: settling.settle,
      reports: recorded.reports,
      sweepEveryMs: options.sweepEveryMs ?? 50,
      mostCallsAtOnce: 4,
      reactions: recordedReactions().options,
      waiting: options.waiting ?? recordedWaiting().options,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.holder === undefined ? {} : { holder: options.holder }),
      ...(options.projector === undefined ? {} : { projector: options.projector }),
      ...(options.dueWork === undefined ? {} : { dueWork: options.dueWork }),
      ...(options.context === undefined ? {} : { context: options.context }),
    },
    calls: () => performed,
    settlements: settling.settlements,
    settledWith: settling.lineages,
    settleAttempts: settling.attempts,
    troubles: recorded.troubles,
    notes: recorded.notes,
    know: settling.know,
  };
}

export async function hostedOn(settings: HostOptions['database'], options: HostedOptions = {}): Promise<HostedRuns> {
  const { options: hostOptions, ...records } = recordedOptionsOf(options);
  const host = await openWorkflowHost({ database: settings, ...hostOptions });
  onTestFinished(() => host.stop());
  return { host, ...records };
}
