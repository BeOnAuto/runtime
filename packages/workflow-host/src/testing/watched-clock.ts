import { Effect } from 'effect';

import type { HostClock } from '../loop/host-clock.ts';
import { signals, type Signals } from './signals.ts';

export interface WatchedClock extends HostClock {
  readonly asked: () => readonly number[];
  readonly sleeping: () => number;
  /** Answers once a read of the clock holds, read again each time a sleep is asked for or ends. */
  readonly when: Signals['when'];
}

interface Reading {
  readonly reads: () => number;
}

interface Sleeps {
  readonly asked: number;
  readonly sleeping: number;
}

export function watchedClock(clock: HostClock): WatchedClock {
  const asked: number[] = [];
  const counts = { sleeping: 0 };
  const seen = signals();
  return {
    now: clock.now,
    sleep: (milliseconds) =>
      Effect.suspend(() => {
        asked.push(milliseconds);
        counts.sleeping += 1;
        seen.changed();
        return clock.sleep(milliseconds);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            counts.sleeping -= 1;
            seen.changed();
          }),
        ),
      ),
    asked: () => [...asked],
    sleeping: () => counts.sleeping,
    when: seen.when,
  };
}

async function untilAsleepOnceAsked(clock: WatchedClock, sleeps: number): Promise<void> {
  await clock.when(
    (): Sleeps => ({ asked: clock.asked().length, sleeping: clock.sleeping() }),
    ({ asked, sleeping }) => asked >= sleeps && sleeping > 0,
  );
}

export async function readsWhile(reading: Reading, clock: WatchedClock, work: () => Promise<unknown>): Promise<number> {
  await untilAsleepOnceAsked(clock, 0);
  const before = reading.reads();
  const asked = clock.asked().length;
  await work();
  await untilAsleepOnceAsked(clock, asked + 1);
  return reading.reads() - before;
}
