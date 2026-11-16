import { playbookCallerOf } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { at, attemptsWorkGiven, run } from '../testing/attempt-leases/gone-holder-parts.ts';

const handedOverAtItsStop = `attempt/acme/alpha/${run.runId}/process-that-stopped/1`;

const lapsingLater = 'attempt/acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70/another-process/1';

describe('the runs of gone holders a process takes up, once it begins to stop', () => {
  it('are none, even one handed out just before, so a lease its stop hands over is left whole for the next server', async () => {
    const { dueAt, nextDueAfter, stopping, nextAsked, leases } = await attemptsWorkGiven(
      { startedBy: playbookCallerOf(run).id },
      [
        [handedOverAtItsStop, '', 0],
        [lapsingLater, 'another-process', at + 1000],
      ],
    );
    const handedOutBefore = await dueAt(at);
    const nextBefore = await nextDueAfter(at);

    stopping.began();
    await Effect.runPromise(Effect.forEach(handedOutBefore, (item) => item.perform(at), { discard: true }));

    expect([handedOutBefore.map(({ key }) => key), nextBefore]).toEqual([[handedOverAtItsStop], at + 1000]);
    expect([await dueAt(at), await nextDueAfter(at)]).toEqual([[], null]);
    expect(nextAsked()).toEqual([]);
    expect(await leases()).toEqual([
      { name: lapsingLater, holder: 'another-process' },
      { name: handedOverAtItsStop, holder: '' },
    ]);
  });
});
