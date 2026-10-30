import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runId } from '../testing/runs.ts';
import { recordStoreProbes, watermarkProbes, type RecordStoreSubject } from '../testing/store-probes.ts';
import { memoryRecordStore, memoryWatermark } from './memory-records.ts';
import { faultsOf } from './memory-timers.ts';
import { memoryRunStore } from './run-store.ts';
import { virtualClock } from './virtual-clock.ts';

function recordStoreSubject(): RecordStoreSubject {
  const recordStore = memoryRecordStore(faultsOf(virtualClock()));
  return {
    recordStore,
    run: { runId, attributes: {} },
    know: (known) =>
      Effect.sync(() => {
        recordStore.known(known);
      }),
  };
}

describe('the memory record store meets the contract every record store meets', () => {
  it.each(recordStoreProbes)('$title', async (probe) => {
    expect(await Effect.runPromise(probe.run(recordStoreSubject()))).toEqual(probe.expected);
  });
});

describe('the memory watermark meets the contract every watermark meets', () => {
  it.each(watermarkProbes)('$title', async (probe) => {
    const runStore = memoryRunStore();
    const subject = { watermark: memoryWatermark(runStore), runStore, runId };

    expect(await Effect.runPromise(probe.run(subject))).toEqual(probe.expected);
  });
});
