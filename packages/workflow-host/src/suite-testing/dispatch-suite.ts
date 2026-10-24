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

const againAfterMs = 30_000;

const startedAt = 1000;

const waiting: CallAnswer = { status: 'waiting', child };

function callAt(reference: string): StartCall {
  return {
    kind: 'start_call',
    key: { runId: runKey, reference, run: 1 },
    function: 'run_definition',
    arguments: { type: 'reasoning', name: 'classify' },
    longestMs: 120_000,
  };
}

const [first, second] = [callAt('/do/0/a'), callAt('/do/1/b')];

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
        return attempt.attemptDied ? againAnswers(call) : waiting;
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
  const works = callsDueAgainOf(database, executor, againAfterMs);
  const dueAt = async (now: number, callsOut = true) =>
    (await Effect.runPromise(Effect.forEach(works, (work) => work.due(now, 16, callsOut)))).flat();
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
    nextAfter: (moment: number) => Effect.runPromise(Effect.forEach(works, (work) => work.nextDueAt(moment))),
    started: (...calls: readonly StartCall[]) =>
      Effect.runPromise(
        Effect.andThen(
          Effect.forEach(calls, (call) => executor.executor.start(call, run, origin)),
          executor.idle(),
        ),
      ),
  };
}

const stillWaiting = (): CallAnswer => waiting;

function keysOf(items: readonly DueItem[]): readonly string[] {
  return items.map(({ key }) => key);
}

export function dispatchSuite(settings: SettingsOf): void {
  it('dispatches a waiting call again, told the attempt before died, once it has waited the interval since it was last dispatched, and each interval after, among the work that calls out', async () => {
    const calls = await dispatching(settings, stillWaiting);
    await calls.started(first);

    const before = await calls.dueAt(startedAt + againAfterMs - 1);
    const firstNext = await calls.nextAfter(startedAt);
    const again = await calls.performedAt(startedAt + againAfterMs);
    const secondNext = await calls.nextAfter(startedAt + againAfterMs);

    expect([before, again, await calls.dueAtAmongTheRest(startedAt + againAfterMs * 3)]).toEqual([
      [],
      [callKeyText(first.key)],
      [],
    ]);
    expect([firstNext, secondNext]).toEqual([[startedAt + againAfterMs], [startedAt + againAfterMs * 2]]);
    expect(calls.attempts()).toEqual([
      { reference: '/do/0/a', attemptDied: false },
      { reference: '/do/0/a', attemptDied: true },
    ]);
  });

  it('answers a call that its dispatch again answers, and leaves alone one its deadline cancelled, so neither is due again', async () => {
    const calls = await dispatching(settings, () => ({ status: 'succeeded', output: 'classified' }));
    await calls.started(first, second);
    await Effect.runPromise(
      calls.executor.executor.cancel({ kind: 'cancel_call', key: second.key, reason: 'deadline' }, run, origin),
    );

    const again = await calls.performedAt(startedAt + againAfterMs);

    expect([again, await calls.dueAt(startedAt + againAfterMs * 3), await calls.nextAfter(0)]).toEqual([
      [callKeyText(first.key)],
      [],
      [null],
    ]);
    expect(calls.answered()).toEqual([{ status: 'succeeded', output: 'classified' }]);
  });
  aLiveRunWaitedFor(settings);
}

function aLiveRunWaitedFor(settings: SettingsOf): void {
  it('waits, rather than dispatching again, while the run the call waits for shows a fact within the interval, and is due again once the run has been quiet that long', async () => {
    const calls = await dispatching(settings, stillWaiting);
    await calls.started(first);
    await calls.factOfTheChild();

    const handedOut = await calls.performedAt(startedAt + againAfterMs);
    const [next] = await calls.nextAfter(startedAt + againAfterMs);

    expect([handedOut, calls.attempts()]).toEqual([
      [callKeyText(first.key)],
      [{ reference: '/do/0/a', attemptDied: false }],
    ]);
    expect(next).toBeGreaterThan(startedAt + againAfterMs);
    expect(next).toBeLessThanOrEqual(startedAt + againAfterMs * 2);
  });
}
