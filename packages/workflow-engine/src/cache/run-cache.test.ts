import { describe, expect, it } from 'vitest';

import { heldBytesOf } from '../machine/held-values.ts';
import type { RunState } from '../machine/run-state.ts';
import type { LoadedRun } from '../run-log/run-fold.ts';
import { runningState } from '../testing/runs.ts';
import { heapBytesPerJsonByte, runCacheOf } from './run-cache.ts';

function loadedRun(version: number, state: RunState = runningState): LoadedRun {
  return { state, version, sinceSnapshot: { bytes: 0, snapshotBytes: 0 } };
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
