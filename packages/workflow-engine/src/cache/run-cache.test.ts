import { describe, expect, it } from 'vitest';

import type { LoadedRun } from '../run-log/run-fold.ts';
import { runningState } from '../testing/runs.ts';
import { runCacheOf } from './run-cache.ts';

function loadedRun(version: number): LoadedRun {
  return { state: runningState, version, sinceSnapshot: { bytes: 0, snapshotBytes: 0 } };
}

const oneRun = runningState.heldBytes + runningState.inbox.waitingBytes;

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
