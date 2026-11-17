import { movedClock, type MovedClock } from '@on.auto/workflow-host/testing';
import { Effect } from 'effect';

import { until } from '../waiting/until.ts';

export interface WokenClock extends MovedClock {
  readonly quietAt: (at: number, work: () => number) => Promise<number>;
}

const sleepsOfQuiet = 20;

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
