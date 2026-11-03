import { describe, expect, it } from 'vitest';

import { runIdOf } from '../run-testing/run-outcomes.ts';
import {
  cancelReason,
  cancelled,
  flying,
  pathsAsked,
  runIn,
  spent,
  waitingRowIn,
} from '../run-testing/waiting-runs.ts';
import { alpha, generationHarness, harnessStartsAt } from '../testing/index.ts';

describe('a run that waits for a video and is cancelled', () => {
  it('ends cancelled with the cost its request spent, closes its row, and asks the gateway nothing more', async () => {
    const playbook = await flying();

    await cancelled(playbook);
    const polled = await playbook.pollAt(harnessStartsAt + 5000);

    const run = await runIn(playbook);
    expect(run).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'cancelled', kind: 'requested', detail: cancelReason },
    });
    expect(run.record).toEqual(spent);
    expect((await waitingRowIn(playbook)).open).toBe(false);
    expect([polled, pathsAsked(playbook)]).toEqual([0, ['/v1/videos']]);
  });
});

describe('a cancelled run of a generation function that waits for nothing', () => {
  it('ends as it was asked to, with no record', () => {
    const { capability } = generationHarness();

    expect(
      capability.cancel({
        run: { ...alpha, id: runIdOf(1) },
        record: {},
        kind: 'requested',
        reason: cancelReason,
        answer: null,
        work: [],
      }),
    ).toEqual({ status: 'rejected', reason: 'cancelled', kind: 'requested', detail: cancelReason });
  });
});
