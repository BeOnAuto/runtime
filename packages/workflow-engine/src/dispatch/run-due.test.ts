import { describe, expect, it } from 'vitest';

import { changesTimers, isTroubling, nextDueAtOf, runDueOf } from '../index.ts';
import { at, runId, runningState } from '../testing/runs.ts';
import { exampleStream, streamOf } from '../testing/streams.ts';

describe('the next time a run is due', () => {
  it('is the earliest of its armed timers, or none when nothing is armed', () => {
    expect(nextDueAtOf(runningState)).toBe(at + 60_000);
    expect(nextDueAtOf({ ...runningState, timers: { next: 3, armed: {} } })).toBeNull();
  });

  it('is noted in the record by version', () => {
    expect(runDueOf(runningState, 7)).toEqual({ runId, version: 7, nextDueAt: at + 60_000 });
  });

  it('changes only with an event that arms, cancels or fires a timer', () => {
    const cancelling = streamOf([
      {
        receipt: { kind: 'cancel_requested', key: runId, at },
        patch: [],
        outputs: [{ kind: 'cancel_timer', runId, timerId: '1' }],
      },
    ]);

    expect([...exampleStream, ...cancelling].map((event) => changesTimers(event))).toEqual([false, true, true, true]);
  });
});

describe('a settle receipt', () => {
  it('is troubling when the record was settled otherwise or names no run, and is then reported', () => {
    expect(
      (['recorded', 'already_recorded', 'settled_otherwise', 'unknown_run'] as const).map((receipt) =>
        isTroubling(receipt),
      ),
    ).toEqual([false, false, true, true]);
  });
});
