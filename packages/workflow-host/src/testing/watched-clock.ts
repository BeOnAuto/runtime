import { Effect } from 'effect';

import { systemClock, type HostClock } from '../loop/host-clock.ts';
import { until } from './until.ts';

export interface WatchedClock extends HostClock {
  readonly asked: () => readonly number[];
  readonly sleeping: () => number;
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
  return {
    now: clock.now,
    sleep: (milliseconds) =>
      Effect.suspend(() => {
        asked.push(milliseconds);
        counts.sleeping += 1;
        return clock.sleep(milliseconds);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            counts.sleeping -= 1;
          }),
        ),
      ),
    asked: () => [...asked],
    sleeping: () => counts.sleeping,
  };
}

export function watchedSystemClock(): WatchedClock {
  return watchedClock(systemClock);
}

async function untilAsleepOnceAsked(clock: WatchedClock, sleeps: number): Promise<void> {
  await until(
    (): Sleeps => ({ asked: clock.asked().length, sleeping: clock.sleeping() }),
    ({ asked, sleeping }) => asked >= sleeps && sleeping > 0,
  );
}

export function untilAWholeWakeHasPassed(clock: WatchedClock): Promise<void> {
  return untilAsleepOnceAsked(clock, clock.asked().length + 2);
}

export async function readsWhile(reading: Reading, clock: WatchedClock, work: () => Promise<unknown>): Promise<number> {
  await untilAsleepOnceAsked(clock, 0);
  const before = reading.reads();
  const asked = clock.asked().length;
  await work();
  await untilAsleepOnceAsked(clock, asked + 1);
  return reading.reads() - before;
}
