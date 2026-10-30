import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { runLoopOf } from '../engine/run-loop.ts';
import type { RunDecider } from '../machine/run-decider.ts';
import type { RunInput } from '../machine/run-input.ts';
import { memoryRunStore } from '../memory/run-store.ts';
import { countingDecider } from '../testing/counting-decider.ts';
import { deeplyFrozen, frozenRuns } from '../testing/frozen-runs.ts';
import { at, runId, runningState, started } from '../testing/runs.ts';
import { runCacheOf } from './run-cache.ts';

const cancelled: RunInput = {
  kind: 'cancel_requested',
  runId,
  at: at + 1,
  cancel: { by: 'tester', kind: 'requested', reason: 'The test cancelled the run' },
};

const writing: RunDecider = {
  ...countingDecider,
  decide: (input, state) => {
    Object.assign(state, { inputs: state.inputs + 1 });
    return countingDecider.decide(input, state);
  },
};

describe('a run the cache keeps', () => {
  it('is let go of when its append ends without saying whether it wrote, and loaded from the store again', () => {
    const store = memoryRunStore();
    const cache = runCacheOf();
    const loop = runLoopOf(store, countingDecider, cache);
    Effect.runSync(loop(runId, started));
    store.failNextAppend('unknown_outcome');

    const lost = Effect.runSyncExit(loop(runId, cancelled));
    const kept = cache.get(runId);
    const next = Effect.runSync(loop(runId, { ...cancelled, at: at + 2 }));

    expect(Exit.isFailure(lost)).toBe(true);
    expect(kept).toBeUndefined();
    expect([next.loaded.version, next.events.length]).toEqual([2, 0]);
    expect(store.loads(runId)).toBe(2);
  });

  it('is let go of when its append meets a conflict, so the retry loads the run from the store', () => {
    const store = memoryRunStore();
    const cache = runCacheOf();
    const loop = runLoopOf(store, countingDecider, cache);
    Effect.runSync(loop(runId, started));
    store.failNextAppend('conflict');

    const decided = Effect.runSync(loop(runId, cancelled));

    expect([decided.version, cache.get(runId)?.version]).toEqual([2, 2]);
    expect(store.loads(runId)).toBe(2);
  });

  it('is frozen to its leaves under the memory driver, so a machine that wrote to a state in place would fail', () => {
    const unfrozen = Effect.runSyncExit(runLoopOf(memoryRunStore(), writing, runCacheOf())(runId, started));
    const frozen = Effect.runSyncExit(runLoopOf(memoryRunStore(), writing, frozenRuns(runCacheOf()))(runId, started));
    const state = deeplyFrozen(structuredClone(runningState));

    expect([Exit.isSuccess(unfrozen), Exit.isFailure(frozen)]).toEqual([true, true]);
    expect([
      Object.isFrozen(state),
      Object.isFrozen(state.machine.root?.body),
      Object.isFrozen(state.timers.armed['1']),
      Object.isFrozen(state.inbox.receivedIds),
      deeplyFrozen(null),
    ]).toEqual([true, true, true, true, null]);
  });
});
