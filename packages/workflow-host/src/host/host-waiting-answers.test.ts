import type { CallResult } from '@on.auto/operations';
import { Effect, Function, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { waitingCallsOf } from '../calls/call-rows.ts';
import {
  closeHostParts,
  hostWakeUp,
  openHostParts,
  openWorkflowStore,
  rowsOf,
  runKeyOf,
  statement,
  type CallAnswer,
} from '../index.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, connectedOn } from '../testing/host-files.ts';
import { recordedOptionsOf } from '../testing/host-runs.ts';
import { until } from '../testing/until.ts';
import { steppedClock } from '../views-testing/stepped-sweeps.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const runKey = runKeyOf(runAt(runId));

const playbook = { org: 'acme', playbook: 'alpha' };

const calledBy = { runId, reference: '/do/0/ask', run: 1 };

const asking = workflow('do:\n  - ask: { call: notify, with: { to: ada } }');

const CallState = Schema.Struct({ state: Schema.String, delivered: Schema.Number });

const answeredByTheShell: CallResult = { status: 'succeeded', output: 'answered by the shell' };

const answeredAgain: CallResult = { status: 'succeeded', output: 'answered again' };

const refusedForCredits: CallResult = {
  status: 'rejected',
  reason: 'conflict',
  detail: 'This org has used today’s 15 Free plan credits',
  kind: 'credits_exhausted',
  because: 'free_daily_limit',
  admission: 'refused',
};

const waitingForARun = (): Effect.Effect<CallAnswer> => Effect.succeed({ status: 'waiting', child: 'never-started' });

async function partsAnswering(answer: () => Effect.Effect<CallAnswer>) {
  const clock = steppedClock(Date.now());
  const store = await openWorkflowStore(await connectedOn({ store: 'sqlite', file: aSQLiteFile() }), []);
  const recorded = recordedOptionsOf({ answer });
  const parts = openHostParts(store, { ...recorded.options, clock }, Function.constVoid);
  recorded.know(runId);
  await Effect.runPromise(parts.submitted({ ...startOf(asking), kind: 'started', runId: runKey, at: clock.now() }));
  const callStates = () =>
    Effect.runPromise(rowsOf(CallState, store.database.read(statement`SELECT state, delivered FROM workflow_calls`)));
  const waiting = () =>
    until(
      () => Effect.runPromise(waitingCallsOf(store.database, runKey)),
      (calls) => calls.length > 0,
    );
  return { clock, parts, recorded, callStates, waiting };
}

describe('a call that waits for a run the shell learns the answer of, though that run never ended', () => {
  it('takes the answer through the parts once, as its run takes it, and takes no answer after that', async () => {
    const { parts, recorded, callStates, waiting } = await partsAnswering(waitingForARun);
    await waiting();

    const took = await Effect.runPromise(parts.waitingCallAnswered(playbook, calledBy, answeredByTheShell));
    const settled = await until(
      () => Promise.resolve(recorded.settlements().get(runId)),
      (settlement) => settlement !== undefined,
    );
    const tookAgain = await Effect.runPromise(parts.waitingCallAnswered(playbook, calledBy, answeredAgain));
    const calls = await callStates();
    await closeHostParts(parts);

    expect([took, tookAgain]).toEqual([true, false]);
    expect(settled).toEqual({ status: 'succeeded', output: 'answered by the shell' });
    expect(recorded.settlements().get(runId)).toEqual(settled);
    expect(calls).toEqual([{ state: 'answered', delivered: 1 }]);
    expect([recorded.calls().length, recorded.troubles()]).toEqual([1, []]);
  });

  it('takes no answer while it is still running, its wait not yet recorded, and appends nothing', async () => {
    const { parts, recorded, callStates } = await partsAnswering(() => Effect.never);
    await until(callStates, (calls) => calls.length > 0);

    const took = await Effect.runPromise(parts.waitingCallAnswered(playbook, calledBy, answeredByTheShell));
    const calls = await callStates();
    await closeHostParts(parts);

    expect(took).toBe(false);
    expect(calls).toEqual([{ state: 'running', delivered: 0 }]);
    expect(recorded.settlements().get(runId)).toBeUndefined();
  });
});

describe('a call that waits for a run, answered by the shell as an admission refused', () => {
  it('waits at its step and is called again at its retry, under a run of its own', async () => {
    const { clock, parts, recorded, waiting } = await partsAnswering(waitingForARun);
    await waiting();
    const wakeUp = hostWakeUp(parts, { raised: Function.constVoid, renewed: Function.constVoid });

    const took = await Effect.runPromise(parts.waitingCallAnswered(playbook, calledBy, refusedForCredits));
    const beforeItsRetry = recorded.calls().length;
    clock.step(60_000);
    await Effect.runPromise(wakeUp.wakeUp({ now: clock.now(), sweep: false }));
    const called = await until(
      () => Promise.resolve(recorded.calls()),
      (calls) => calls.length > 1,
    );
    await Effect.runPromise(wakeUp.stop());
    await closeHostParts(parts);

    expect([took, beforeItsRetry]).toEqual([true, 1]);
    expect(called.map(({ key }) => key.run)).toEqual([1, 2]);
    expect(recorded.settlements().get(runId)).toBeUndefined();
  });
});
