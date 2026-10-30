import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runId } from '../testing/runs.ts';
import { runStoreProbes } from '../testing/store-probes.ts';
import { memoryRunStore } from './run-store.ts';

describe('the memory run store meets the contract every run store meets', () => {
  it.each(runStoreProbes)('$title', async (probe) => {
    expect(await Effect.runPromise(probe.run({ runStore: memoryRunStore(), runId }))).toEqual(probe.expected);
  });
});

describe('the memory run store, for the tests that read it', () => {
  it('counts the loads and the snapshots saved of each run, and none of a run it never saw', async () => {
    const store = memoryRunStore();
    await Effect.runPromise(store.load(runId));

    expect([store.loads(runId), store.loads('unseen')]).toEqual([1, 0]);
    expect(store.snapshotsSaved('unseen')).toEqual([]);
  });
});
