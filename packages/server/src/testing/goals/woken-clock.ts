import { steppedServerClock, type SteppedServerClock } from '../waiting/stepped-server-clock.ts';

export interface WokenClock extends SteppedServerClock {
  /** Moves the time to the moment, and answers how much more work was done once the server is wholly at rest. */
  readonly quietAt: (at: number, work: () => number) => Promise<number>;
}

export function wokenClock(start: number): WokenClock {
  const clock = steppedServerClock(start);
  return {
    ...clock,
    quietAt: async (at, work) => {
      const before = work();
      clock.moveTo(at);
      await clock.atRest();
      return work() - before;
    },
  };
}
