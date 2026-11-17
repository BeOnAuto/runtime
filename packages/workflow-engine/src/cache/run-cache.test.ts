import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { runLoopOf } from '../engine/run-loop.ts';
import { coldEngineOn, keptAnswer, largeAnswer, pauseEnded, waitingOnItsPause } from '../kept-testing/kept-drivers.ts';
import type { HeldContent } from '../machine/held-contents.ts';
import { heldBytesOf } from '../machine/held-values.ts';
import type { RunDecider } from '../machine/run-decider.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { RunState } from '../machine/run-state.ts';
import { memoryPayloads } from '../memory/memory-payloads.ts';
import { memoryReporter } from '../memory/memory-records.ts';
import { memoryRunStore } from '../memory/run-store.ts';
import { loadedRunOf } from '../run-log/run-fold.ts';
import { stateFormat } from '../run-log/state-format.ts';
import { countingDecider } from '../testing/counting-decider.ts';
import { deeplyFrozen, frozenRuns } from '../testing/frozen-runs.ts';
import { drivenRunId } from '../testing/run-history.ts';
import { at, runId, runningState, started } from '../testing/runs.ts';
import { type CachedRun, heapBytesPerJsonByte, keptBytesOf, runCacheOf } from './run-cache.ts';

function loadedRun(version: number, state: RunState = runningState): CachedRun {
  const sinceSnapshot = { bytes: 0, snapshotBytes: 0 };
  return { state, version, sinceSnapshot, format: stateFormat, contents: new Map() };
}

const oneRunAsJson = runningState.heldBytes + runningState.inbox.waitingBytes;

const oneRun = heapBytesPerJsonByte * oneRunAsJson;

const outputOfAKibibyteAndMore = { text: 'x'.repeat(1024) };

const ended: RunState = {
  ...runningState,
  status: 'ended',
  machine: { ...runningState.machine, root: null },
  outcome: { kind: 'completed', output: outputOfAKibibyteAndMore },
};

const completedRun: RunState = { ...ended, heldBytes: heldBytesOf(ended) };

const outcomeAsJson = JSON.stringify(completedRun.outcome).length;

const completedRunAsJson = completedRun.heldBytes + completedRun.inbox.waitingBytes + outcomeAsJson;

const cancelled = {
  kind: 'cancel_requested',
  runId,
  at: at + 1,
  cancel: { by: 'tester', kind: 'requested', reason: 'The test cancelled the run' },
} as const;

const writing: RunDecider = {
  ...countingDecider,
  decision: (input, state, atHand) => {
    Object.assign(state, { inputs: state.inputs + 1 });
    return countingDecider.decision(input, state, atHand);
  },
};

const answerText = JSON.stringify(largeAnswer);

const cancelledReloadedRuns: RunInput = {
  kind: 'cancel_requested',
  runId,
  at: at + 1,
  cancel: { by: 'tester', kind: 'requested', reason: 'The test cancelled the run' },
};

describe('what the cache of loaded runs counts of a run', () => {
  it('counts the data a run holds at the heap it takes, twice its bytes as JSON, so a run under its bytes as JSON may not fit', () => {
    const cache = runCacheOf({ mostRuns: 10, mostBytes: oneRunAsJson + oneRunAsJson / 2 });
    cache.put('a', loadedRun(1));

    expect([heapBytesPerJsonByte, cache.get('a')]).toEqual([2, undefined]);
  });

  it('counts the outcome a run that ended keeps, which its held values leave out, so ended runs fill it too', () => {
    const cache = runCacheOf({ mostRuns: 10, mostBytes: heapBytesPerJsonByte * completedRunAsJson });
    cache.put('a', loadedRun(1, completedRun));
    cache.put('b', loadedRun(2, completedRun));

    expect(completedRun.heldBytes).toBeLessThan(outcomeAsJson);
    expect([cache.get('a'), cache.get('b')?.version]).toEqual([undefined, 2]);
  });
});

describe('the cache of loaded runs', () => {
  it('keeps at most its number of runs, letting go of the one used longest ago', () => {
    const cache = runCacheOf({ mostRuns: 2, mostBytes: 1_048_576 });
    cache.put('a', loadedRun(1));
    cache.put('b', loadedRun(2));
    cache.get('a');
    cache.put('c', loadedRun(3));

    expect([cache.get('a')?.version, cache.get('b'), cache.get('c')?.version]).toEqual([1, undefined, 3]);
  });

  it('keeps at most its bytes of the data its runs hold, letting go of the one used longest ago', () => {
    const cache = runCacheOf({ mostRuns: 10, mostBytes: oneRun + oneRun / 2 });
    cache.put('a', loadedRun(1));
    cache.put('b', loadedRun(2));

    expect([cache.get('a'), cache.get('b')?.version]).toEqual([undefined, 2]);
  });

  it('keeps no run that alone holds more than its bytes', () => {
    const cache = runCacheOf({ mostRuns: 10, mostBytes: oneRun - 1 });
    cache.put('a', loadedRun(1));

    expect(cache.get('a')).toBeUndefined();
  });

  it('keeps the latest of a run it is given again, counting its bytes once', () => {
    const cache = runCacheOf({ mostRuns: 10, mostBytes: oneRun + oneRun / 2 });
    cache.put('a', loadedRun(1));
    cache.put('a', loadedRun(2));

    expect(cache.get('a')?.version).toBe(2);
  });

  it('lets go of a run it is told to, and of nothing else', () => {
    const cache = runCacheOf();
    cache.put('a', loadedRun(1));
    cache.put('b', loadedRun(2));
    cache.drop('a');
    cache.drop('missing');

    expect([cache.get('a'), cache.get('b')?.version]).toEqual([undefined, 2]);
  });
});

describe('a run the cache keeps', () => {
  it('is let go of when its append ends without saying whether it wrote, and loaded from the store again', () => {
    const store = memoryRunStore();
    const cache = runCacheOf();
    const loop = runLoopOf({ runStore: store, payloads: memoryPayloads() }, countingDecider, cache);
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
    const loop = runLoopOf({ runStore: store, payloads: memoryPayloads() }, countingDecider, cache);
    Effect.runSync(loop(runId, started));
    store.failNextAppend('conflict');

    const decided = Effect.runSync(loop(runId, cancelled));

    expect([decided.version, cache.get(runId)?.version]).toEqual([2, 2]);
    expect(store.loads(runId)).toBe(2);
  });
});

describe('a run the memory driver keeps', () => {
  it('is frozen to its leaves under the memory driver, so a machine that wrote to a state in place would fail', () => {
    const unfrozen = Effect.runSyncExit(
      runLoopOf({ runStore: memoryRunStore(), payloads: memoryPayloads() }, writing, runCacheOf())(runId, started),
    );
    const frozen = Effect.runSyncExit(
      runLoopOf(
        { runStore: memoryRunStore(), payloads: memoryPayloads() },
        writing,
        frozenRuns(runCacheOf()),
      )(runId, started),
    );
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

describe('a run that keeps a value outside, loaded from its store again', () => {
  it('is reported at the digest and size it holds as loaded, before it reads the text in', () => {
    const driver = waitingOnItsPause();
    const cold = coldEngineOn(driver.ports);
    const stored = Effect.runSync(driver.ports.runStore.load(drivenRunId));
    const asLoaded = { ...loadedRunOf(stored), contents: new Map<string, HeldContent>() };
    const readIn = new Map<string, HeldContent>([[keptAnswer, { kind: 'read', text: answerText }]]);
    const before = driver.ports.reporter.reloads().length;

    Effect.runSync(cold.submit(pauseEnded(driver.state(drivenRunId))));

    expect(driver.ports.reporter.reloads().slice(before)).toEqual([
      { runId: drivenRunId, snapshot: false, events: stored.tail.length, keptBytes: keptBytesOf(asLoaded) },
    ]);
    expect(keptBytesOf({ ...asLoaded, contents: readIn }) - keptBytesOf(asLoaded)).toBe(answerText.length);
  });
});

describe('a run loaded from its store again', () => {
  it('is reported with the events read and the bytes the cache counts it as, and a run with nothing stored is not', () => {
    const reporter = memoryReporter();
    const keepingNone = runCacheOf({ mostRuns: 0, mostBytes: 0 });
    const stores = { runStore: memoryRunStore(), payloads: memoryPayloads() };
    const loop = runLoopOf(stores, countingDecider, keepingNone, {
      reserve: Effect.void,
      report: (reloaded) => reporter.reloaded(reloaded),
    });

    Effect.runSync(loop(runId, started));
    const atStart = [...reporter.reloads()];
    const decided = Effect.runSync(loop(runId, cancelledReloadedRuns));

    expect([atStart, reporter.reloads()]).toEqual([
      [],
      [{ runId, snapshot: false, events: 1, keptBytes: keptBytesOf(decided.loaded) }],
    ]);
  });

  it('is not reported while the cache keeps the run', () => {
    const reporter = memoryReporter();
    const stores = { runStore: memoryRunStore(), payloads: memoryPayloads() };
    const loop = runLoopOf(stores, countingDecider, runCacheOf(), {
      reserve: Effect.void,
      report: (reloaded) => reporter.reloaded(reloaded),
    });

    Effect.runSync(loop(runId, started));
    Effect.runSync(loop(runId, cancelledReloadedRuns));

    expect(reporter.reloads()).toEqual([]);
  });
});
