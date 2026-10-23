import { setTimeout } from 'node:timers/promises';

import type { Run, SettleRun } from '@on.auto/definitions';
import { Effect, type Schema } from 'effect';

import type { RunStart } from '../src/host/run-requests.ts';
import type { WorkflowHost } from '../src/host/workflow-host.ts';
import { workflowHostOnALedger, type DatabaseSettings } from '../src/ledger-testing/ledger-connections.ts';
import type { HostClock } from '../src/loop/host-clock.ts';
import { recordedReactions } from '../src/reaction-testing/recorded-reactions.ts';
import { startOf as testStartOf, testMachine } from '../src/testing/host-documents.ts';
import { recordedWaiting } from '../src/waiting-testing/recorded-waiting.ts';

export interface MeasuredHost {
  readonly host: WorkflowHost;
  readonly settled: () => number;
  readonly untilSettled: (count: number) => Promise<void>;
}

const run: Run = {
  run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  type: 'workflow',
  name: 'measured',
  definition_version: 1,
  status: 'succeeded',
  started_at: '2026-10-05T09:00:00.000Z',
  started_by: 'acme-admin',
};

export const header = { dsl: '1.0.3', namespace: 'acme', name: 'measured', version: '1.0.0' };

export function startOf(document: Schema.JsonObject, input: Schema.Json = {}): RunStart {
  return { ...testStartOf(document), input, attributes: {} };
}

export function runAt(index: number): { readonly org: string; readonly playbook: string; readonly runId: string } {
  return { org: 'acme', playbook: 'alpha', runId: `0199a3c4-7d2e-7c1a-9b3f-${String(index).padStart(12, '0')}` };
}

export async function measuredHost(database: DatabaseSettings, clock?: HostClock): Promise<MeasuredHost> {
  const counts = { settled: 0 };
  const settle: SettleRun = () =>
    Effect.sync(() => {
      counts.settled += 1;
      return run;
    });
  const host = await workflowHostOnALedger(database, {
    machine: testMachine,
    perform: () => Effect.succeed({ status: 'succeeded', output: null }),
    settle,
    reports: {
      unsettled: () => Effect.void,
      trouble: Effect.logWarning,
      note: () => Effect.void,
    },
    sweepEveryMs: 1000,
    mostCallsAtOnce: 32,
    reactions: recordedReactions().options,
    waiting: recordedWaiting().options,
    ...(clock === undefined ? {} : { clock }),
  });
  const untilSettled = async (count: number): Promise<void> => {
    if (counts.settled < count) {
      await setTimeout(5);
      await untilSettled(count);
    }
  };
  return { host, settled: () => counts.settled, untilSettled };
}
