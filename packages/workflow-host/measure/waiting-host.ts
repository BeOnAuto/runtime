import { setTimeout } from 'node:timers/promises';

import type { SettleRun } from '@on.auto/definitions';
import { streamSignalOf } from '@on.auto/ledger';
import { Effect } from 'effect';

import { waitingCallsOf } from '../src/calls/call-rows.ts';
import type { WorkflowHost } from '../src/host/workflow-host.ts';
import { workflowHostOnALedger, type DatabaseSettings } from '../src/ledger-testing/ledger-connections.ts';
import { recordedReactions } from '../src/reaction-testing/recorded-reactions.ts';
import { testMachine } from '../src/testing/host-documents.ts';
import { recordedWaiting } from '../src/waiting-testing/recorded-waiting.ts';

type Reads = Parameters<typeof waitingCallsOf>[0];

export interface WaitingHost {
  readonly host: WorkflowHost;
  readonly settledAt: ReadonlyMap<string, number>;
  readonly untilSettled: (count: number) => Promise<void>;
  readonly untilWaiting: (runKeys: readonly string[]) => Promise<void>;
}

export function childOf(runKey: string): string {
  return runKey.slice(runKey.lastIndexOf('/') + 1).replace('-9b3f-', '-8b3f-');
}

async function until(done: () => Promise<boolean>, everyMs: number): Promise<void> {
  if (!(await done())) {
    await setTimeout(everyMs);
    await until(done, everyMs);
  }
}

function settlingAt(settledAt: Map<string, number>): SettleRun {
  return (address) =>
    Effect.sync(() => {
      settledAt.set(address.id, Date.now());
      return {
        run_id: address.id,
        type: 'workflow',
        name: 'measured',
        definition_version: 1,
        status: 'succeeded',
        started_at: '2026-10-07T09:00:00.000Z',
        started_by: { id: 'acme-admin', name: 'acme-admin' },
      };
    });
}

export async function waitingHost(settings: DatabaseSettings, reads: Reads, signalled: boolean): Promise<WaitingHost> {
  const settledAt = new Map<string, number>();
  const reactions = recordedReactions().options;
  const host = await workflowHostOnALedger(settings, {
    machine: testMachine,
    perform: (call) => Effect.succeed({ status: 'waiting', child: childOf(call.key.runId) }),
    settle: settlingAt(settledAt),
    reports: {
      unsettled: () => Effect.void,
      trouble: Effect.logWarning,
      note: () => Effect.void,
    },
    sweepEveryMs: 1000,
    mostCallsAtOnce: 32,
    reactions: signalled ? reactions : { ...reactions, appended: streamSignalOf() },
    waiting: recordedWaiting().options,
  });
  const allWaiting = async (runKeys: readonly string[]) => {
    const waiting = await Promise.all(runKeys.map((runKey) => Effect.runPromise(waitingCallsOf(reads, runKey))));
    return waiting.every((calls) => calls.length === 1);
  };
  return {
    host,
    settledAt,
    untilSettled: (count) => until(() => Promise.resolve(settledAt.size >= count), 5),
    untilWaiting: (runKeys) => until(() => allWaiting(runKeys), 50),
  };
}
