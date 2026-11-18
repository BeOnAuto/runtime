import { movedClock, type MovedClock } from '@on.auto/workflow-host/testing';
import { Effect } from 'effect';
import { vi } from 'vitest';

import { until } from '../waiting/until.ts';

export interface WokenClock extends MovedClock {
  readonly quietAt: (at: number, work: () => number) => Promise<number>;
}

const sleepsOfQuiet = 20;

const aDay = 86_400_000;

const anHour = 3_600_000;

const realNow = Date.now.bind(Date);

const wall = { holders: 0, readsAt: 0 };

function theNextHourIntoADay(from: number): number {
  return Math.ceil((from - anHour) / aDay) * aDay + anHour;
}

export function wallClockTaken(): number {
  if (wall.holders === 0) {
    const ahead = Math.max(wall.readsAt, theNextHourIntoADay(realNow())) - realNow();
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + ahead);
  }
  wall.holders += 1;
  return Date.now();
}

export function wallClockGivenBack(): void {
  wall.holders -= 1;
  if (wall.holders === 0) {
    wall.readsAt = Date.now();
    vi.spyOn(Date, 'now').mockRestore();
  }
}

export function wokenClock(start: number): WokenClock {
  const moved = movedClock(start);
  const slept = { count: 0 };
  const quiet = async (work: () => number): Promise<number> => {
    const seen = work();
    const past = slept.count + sleepsOfQuiet;
    await until(
      () => slept.count,
      (count) => count >= past,
    );
    return seen === work() ? seen : quiet(work);
  };
  return {
    ...moved,
    sleep: (milliseconds) =>
      Effect.andThen(
        Effect.sync(() => {
          slept.count += 1;
        }),
        moved.sleep(milliseconds),
      ),
    quietAt: async (at, work) => {
      const before = work();
      moved.moveTo(at);
      return (await quiet(work)) - before;
    },
  };
}
