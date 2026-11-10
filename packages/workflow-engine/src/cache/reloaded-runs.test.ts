import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runLoopOf } from '../engine/run-loop.ts';
import type { RunInput } from '../machine/run-input.ts';
import { memoryReporter } from '../memory/memory-records.ts';
import { memoryRunStore } from '../memory/run-store.ts';
import { countingDecider } from '../testing/counting-decider.ts';
import { at, runId, started } from '../testing/runs.ts';
import { keptBytesOf, runCacheOf } from './run-cache.ts';

const cancelled: RunInput = {
  kind: 'cancel_requested',
  runId,
  at: at + 1,
  cancel: { by: 'tester', kind: 'requested', reason: 'The test cancelled the run' },
};

describe('a run loaded from its store again', () => {
  it('is reported with the events read and the bytes the cache counts it as, and a run with nothing stored is not', () => {
    const reporter = memoryReporter();
    const keepingNone = runCacheOf({ mostRuns: 0, mostBytes: 0 });
    const loop = runLoopOf(memoryRunStore(), countingDecider, keepingNone, {
      reserve: Effect.void,
      report: (reloaded) => reporter.reloaded(reloaded),
    });

    Effect.runSync(loop(runId, started));
    const atStart = [...reporter.reloads()];
    const decided = Effect.runSync(loop(runId, cancelled));

    expect([atStart, reporter.reloads()]).toEqual([
      [],
      [{ runId, snapshot: false, events: 1, keptBytes: keptBytesOf(decided.loaded) }],
    ]);
  });

  it('is not reported while the cache keeps the run', () => {
    const reporter = memoryReporter();
    const loop = runLoopOf(memoryRunStore(), countingDecider, runCacheOf(), {
      reserve: Effect.void,
      report: (reloaded) => reporter.reloaded(reloaded),
    });

    Effect.runSync(loop(runId, started));
    Effect.runSync(loop(runId, cancelled));

    expect(reporter.reloads()).toEqual([]);
  });
});
