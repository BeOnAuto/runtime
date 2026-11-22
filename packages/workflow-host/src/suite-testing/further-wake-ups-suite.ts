import { Effect } from 'effect';
import { expect, it } from 'vitest';

import type { HostWakeUp } from '../loop/host-wake-up.ts';
import type { ProcessDatabasesOf } from '../testing/host-processes.ts';
import { fewSweeps, steppedBy } from '../testing/stepped-clock.ts';
import { steppedHostOn } from './stepped-hosts.ts';

const sweepEveryMs = 400;

interface WakeUpsHeard {
  readonly wakeUpWith: () => HostWakeUp;
  readonly told: () => readonly string[];
}

function wakeUpsHeard(): WakeUpsHeard {
  const told: string[] = [];
  return {
    wakeUpWith: () => {
      told.push('made');
      return {
        wakeUp: () =>
          Effect.sync(() => {
            told.push('woken');
            return { nextDueAt: null };
          }),
        stop: () =>
          Effect.sync(() => {
            told.push('stopped');
          }),
      };
    },
    told: () => [...new Set(told)],
  };
}

export function furtherWakeUpsSuite(databases: ProcessDatabasesOf): void {
  it('wakes the further wake-ups of the host that holds the claim alone, stops them as it stops, and makes them anew in the host that takes over', async () => {
    const database = await databases();
    const [ofTheFirst, ofTheSecond] = [wakeUpsHeard(), wakeUpsHeard()];
    const { hosted: first, clock: firstClock } = await steppedHostOn(database, {
      sweepEveryMs,
      holder: 'first',
      wakeUps: [ofTheFirst.wakeUpWith],
    });
    await steppedBy(firstClock, sweepEveryMs).until(
      () => ofTheFirst.told(),
      (told) => told.includes('woken'),
      fewSweeps,
    );
    const { clock: secondClock } = await steppedHostOn(database, {
      sweepEveryMs,
      holder: 'second',
      wakeUps: [ofTheSecond.wakeUpWith],
    });
    const whileTheFirstHeld = ofTheSecond.told();

    await first.host.stop();
    await steppedBy(secondClock, sweepEveryMs).until(
      () => ofTheSecond.told(),
      (told) => told.includes('woken'),
      fewSweeps,
    );

    expect([ofTheFirst.told(), whileTheFirstHeld, ofTheSecond.told()]).toEqual([
      ['made', 'woken', 'stopped'],
      [],
      ['made', 'woken'],
    ]);
  });
}
