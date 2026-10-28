import type { CallResult } from '@on.auto/operations';
import { callKeyText, type StartCall } from '@on.auto/workflow-engine';
import { Effect } from 'effect';
import { expect, it } from 'vitest';

import type { CallAttempt } from '../calls/call-starts.ts';
import { callsDueAgainOf } from '../calls/calls-due-again.ts';
import { hostExecutor, type CallAnswer } from '../calls/host-executor.ts';
import type { DueItem } from '../due-work/due-work.ts';
import { alpha, recorded } from '../reaction-testing/playbook-writes.ts';
import { openedOn, type SettingsOf } from '../testing/host-files.ts';

const runKey = 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = { runId: runKey, attributes: { lineage: { start: 'start-1', correlation: runKey } } };

const child = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const origin = { version: 3 };

const startedAt = 1000;

const quickMs = 30_000;

const slowMs = 90_000;

const resumesAfterMsOf: Readonly<Record<string, number>> = { '/do/0/a': quickMs, '/do/1/b': slowMs };

function waitingFor({ key }: StartCall): CallAnswer {
  const resumesAfterMs = resumesAfterMsOf[key.reference];
  return resumesAfterMs === undefined ? { status: 'waiting', child } : { status: 'waiting', child, resumesAfterMs };
}

function callAt(reference: string): StartCall {
  return {
    kind: 'start_call',
    key: { runId: runKey, reference, run: 1 },
    function: 'run_definition',
    arguments: { type: 'reasoning', name: 'classify' },
    longestMs: 120_000,
  };
}

const [quick, slow, notResuming] = [callAt('/do/0/a'), callAt('/do/1/b'), callAt('/do/2/c')];

async function dispatching(settings: SettingsOf, againAnswers: (call: StartCall) => CallAnswer) {
  const database = await openedOn(await settings());
  const attempts: (CallAttempt & { readonly reference: string })[] = [];
  const answered: CallResult[] = [];
  const executor = hostExecutor({
    database,
    now: () => startedAt,
    perform: (call, _run, _origin, attempt) =>
      Effect.sync(() => {
        attempts.push({ reference: call.key.reference, ...attempt });
        return attempt.attemptDied ? againAnswers(call) : waitingFor(call);
      }),
    deliver: (_key, result) =>
      Effect.sync(() => {
        answered.push(result);
      }),
    trouble: Effect.logWarning,
    mostAtOnce: 1,
    mostOpen: 1000,
    childOf: () => child,
    childAnswerOf: () => Effect.undefined,
    cancelChild: () => Effect.succeed('requested'),
  });
  const work = callsDueAgainOf(database, executor);
  const dueAt = (now: number, callsOut = true) => Effect.runPromise(work.due(now, 16, callsOut));
  return {
    executor,
    factOfTheChild: () => recorded(database.store, `${alpha}runs/${child}`, { type: 'run_started', data: {} }),
    attempts: () => attempts,
    answered: () => answered,
    dueAt: async (now: number) => keysOf(await dueAt(now)),
    dueAtAmongTheRest: async (now: number) => keysOf(await dueAt(now, false)),
    performedAt: async (now: number) => {
      const items = await dueAt(now);
      await Effect.runPromise(Effect.forEach(items, (item) => item.perform(now)));
      return keysOf(items);
    },
    nextAfter: (moment: number, callsOut?: boolean) => Effect.runPromise(work.nextDueAt(moment, callsOut)),
    started: (...calls: readonly StartCall[]) =>
      Effect.runPromise(
        Effect.andThen(
          Effect.forEach(calls, (call) => executor.executor.start(call, run, origin)),
          executor.idle(),
        ),
      ),
  };
}

const stillWaiting = (call: StartCall): CallAnswer => waitingFor(call);

function keysOf(items: readonly DueItem[]): readonly string[] {
  return items.map(({ key }) => key);
}

function againAttemptsOf(attempts: readonly (CallAttempt & { readonly reference: string })[]): readonly string[] {
  return attempts.filter(({ attemptDied }) => attemptDied).map(({ reference }) => reference);
}

export function dispatchSuite(settings: SettingsOf): void {
  it('dispatches each waiting call again, told the attempt before died, once it has waited the interval its own run resumes after since it was last dispatched, and each interval after, among the work that calls out', async () => {
    const calls = await dispatching(settings, stillWaiting);
    await calls.started(quick, slow, notResuming);

    const before = await calls.dueAt(startedAt + quickMs - 1);
    const firstNext = await calls.nextAfter(startedAt);
    const firstNextOfEachLane = [await calls.nextAfter(startedAt, true), await calls.nextAfter(startedAt, false)];
    const quickAgain = await calls.performedAt(startedAt + quickMs);
    const secondNext = await calls.nextAfter(startedAt + quickMs);
    const bothAgain = await calls.performedAt(startedAt + slowMs);

    expect([before, quickAgain, bothAgain]).toEqual([
      [],
      [callKeyText(quick.key)],
      [callKeyText(quick.key), callKeyText(slow.key)],
    ]);
    expect([firstNext, secondNext]).toEqual([startedAt + quickMs, startedAt + quickMs * 2]);
    expect(firstNextOfEachLane).toEqual([startedAt + quickMs, null]);
    expect([await calls.dueAtAmongTheRest(startedAt + slowMs * 3), againAttemptsOf(calls.attempts())]).toEqual([
      [],
      ['/do/0/a', '/do/0/a', '/do/1/b'],
    ]);
  });

  it('never dispatches again a waiting call whose run does not resume, which names no interval', async () => {
    const calls = await dispatching(settings, stillWaiting);
    await calls.started(notResuming);

    expect([await calls.dueAt(startedAt + slowMs * 100), await calls.nextAfter(0)]).toEqual([[], null]);
  });

  it('answers a call that its dispatch again answers, and leaves alone one its deadline cancelled, so neither is due again', async () => {
    const calls = await dispatching(settings, () => ({ status: 'succeeded', output: 'classified' }));
    await calls.started(quick, slow);
    await Effect.runPromise(
      calls.executor.executor.cancel({ kind: 'cancel_call', key: slow.key, reason: 'deadline' }, run, origin),
    );

    const again = await calls.performedAt(startedAt + slowMs);

    expect([again, await calls.dueAt(startedAt + slowMs * 3), await calls.nextAfter(0)]).toEqual([
      [callKeyText(quick.key)],
      [],
      null,
    ]);
    expect(calls.answered()).toEqual([{ status: 'succeeded', output: 'classified' }]);
  });
  aLiveRunWaitedFor(settings);
}

function aLiveRunWaitedFor(settings: SettingsOf): void {
  it('waits, rather than dispatching again, while the run the call waits for shows a fact within its interval, and is due again once the run has been quiet that long', async () => {
    const calls = await dispatching(settings, stillWaiting);
    await calls.started(quick);
    await calls.factOfTheChild();

    const handedOut = await calls.performedAt(startedAt + quickMs);
    const next = await calls.nextAfter(startedAt + quickMs);

    expect([handedOut, calls.attempts()]).toEqual([
      [callKeyText(quick.key)],
      [{ reference: '/do/0/a', attemptDied: false }],
    ]);
    expect(next).toBeGreaterThan(startedAt + quickMs);
    expect(next).toBeLessThanOrEqual(startedAt + quickMs * 2);
  });
}
