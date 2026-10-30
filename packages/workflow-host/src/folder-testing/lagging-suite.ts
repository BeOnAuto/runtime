import { describe, expect, it } from 'vitest';

import type { SettingsOf } from '../testing/host-files.ts';
import { readsWhile, watchedClock } from '../testing/watched-clock.ts';
import { overrunningWhenTold } from '../views-testing/pool-faults.ts';
import { steppedClock, untilTried } from '../views-testing/stepped-sweeps.ts';
import { counting, foldedAll, liveWith } from '../views-testing/view-documents.ts';
import type { TallyDetails, TallyRow } from './tally-folder.ts';
import { tallyHarness } from './tally-harness.ts';

const succeeded: TallyDetails = { counts: 'run_succeeded' };

const sweepMs = 10_000;

function liveCounting(counted: number): (row: TallyRow) => boolean {
  return (row) => row.phase === 'live' && row.counted === counted;
}

export function laggingSuite(settingsOf: SettingsOf): void {
  describe('a second folder and the views of recall functions at different checkpoints', () => {
    it('folds on alone while a views fold that overran rests, lets the views read alone from their own checkpoint at the next sweep, and shares one read with them again once both are caught up', async () => {
      const tallies = await tallyHarness(await settingsOf());
      const clock = steppedClock(Date.parse('2026-10-06T09:00:00.000Z'));
      const watched = watchedClock(clock);
      const overrunning = overrunningWhenTold(tallies.pool);
      await tallies.saved('runs', counting);
      await tallies.savedTally('succeeded', succeeded);
      await tallies.ran('reasoning/runs', 1);
      tallies.startWithTallies({ pool: overrunning.pool, clock: watched, sweepEveryMs: sweepMs });
      await tallies.until('runs', liveWith(1));
      await tallies.untilTally(succeeded, liveCounting(1));
      overrunning.overrunNext();
      await tallies.ran('reasoning/runs', 2);
      await untilTried(tallies, 'runs', 1);
      await tallies.untilTally(succeeded, liveCounting(2));

      const alone = await readsWhile(tallies, watched, async () => {
        await tallies.ran('reasoning/runs', 3);
        await tallies.untilTally(succeeded, liveCounting(3));
      });
      const resting = await tallies.viewOf('runs');
      const apart = await readsWhile(tallies, watched, async () => {
        clock.step(sweepMs);
        await tallies.until('runs', liveWith(3));
      });
      const together = await readsWhile(tallies, watched, async () => {
        await tallies.ran('reasoning/runs', 4);
        await tallies.until('runs', foldedAll(4));
        await tallies.untilTally(succeeded, liveCounting(4));
      });

      expect([resting?.phase, resting?.folded]).toEqual(['live', 1]);
      expect([alone, apart, together]).toEqual([1, 2, 1]);
    });
  });
}
