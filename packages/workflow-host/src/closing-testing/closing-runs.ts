import type { CallResult } from '@on.auto/operations';
import type { Started, StartCall } from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import { startOf, workflow } from '../testing/host-documents.ts';
import { connectedOn, type SettingsOf } from '../testing/host-files.ts';
import { recordedOptionsOf, type RecordedOptions } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';
import { steppedClock, type SteppedClock } from '../views-testing/stepped-sweeps.ts';
import { recordedWaiting } from '../waiting-testing/recorded-waiting.ts';
import { closingHostOver, runKey, runId, type ClosingHost, type End } from './closing-host.ts';

export type Answer = (call: StartCall) => CallResult;

const sent: Answer = () => ({ status: 'succeeded', output: 'sent' });

export const failedToRemind: Answer = (call) =>
  call.key.reference.endsWith('remind') ? { status: 'failed', detail: 'The reminder broke down' } : sent(call);

const twoCalls = startOf(
  workflow(`
do:
  - notify: { call: notify, with: { to: ada } }
  - remind: { call: notify, with: { to: grace } }
`),
);

export interface Closing extends ClosingHost {
  readonly recorded: RecordedOptions;
  readonly ended: () => Promise<End>;
  readonly wokenAt: (at: number, sweep?: boolean) => Promise<number | null>;
  readonly cancels: () => number;
  readonly ledgerDown: (down: boolean) => void;
}

function endedBy(host: ClosingHost, clock: SteppedClock, recorded: RecordedOptions): () => Promise<End> {
  return async () => {
    const started: Started = { ...twoCalls, kind: 'started', runId: runKey, at: clock.now() };
    await Effect.runPromise(host.parts().submitted(started));
    await until(
      () => Promise.resolve(recorded.settleAttempts()),
      (attempts) => attempts > 0,
    );
    await Effect.runPromise(host.parts().executor.idle());
    return host.endOf();
  };
}

export async function closingOn(settings: SettingsOf, answer: Answer = sent, closesEndedRuns = true): Promise<Closing> {
  const clock = steppedClock(Date.now());
  const waiting = recordedWaiting();
  const ledger = { down: false };
  const recorded = recordedOptionsOf({
    answer: (call) => Effect.succeed(answer(call)),
    waiting: waiting.options,
    ledgerDown: () => ledger.down,
    sweepEveryMs: 1000,
  });
  recorded.know(runId);
  const host = await closingHostOver(
    await connectedOn(await settings()),
    { ...recorded.options, closesEndedRuns },
    clock,
  );
  return {
    ...host,
    recorded,
    ended: endedBy(host, clock, recorded),
    wokenAt: (at, sweep) => {
      clock.step(at - clock.now());
      return host.wakeUp(at, sweep);
    },
    cancels: () => waiting.cancels().length,
    ledgerDown: (down) => {
      ledger.down = down;
    },
  };
}
