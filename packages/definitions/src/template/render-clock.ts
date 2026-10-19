import { Duration, Effect, type Clock } from 'effect';
import { assert } from 'liquidjs';

export type RenderClock = () => number;

export const platformClock: RenderClock = () => performance.now();

export const renderTimeExceeded = 'template render limit exceeded';

export interface RenderDeadline {
  readonly check: () => void;
}

export function renderClockOf(clock: Readonly<Pick<Clock.Clock, 'monotonicTimeNanosUnsafe'>>): RenderClock {
  return () => Duration.toMillis(Duration.nanos(clock.monotonicTimeNanosUnsafe()));
}

export const renderClock: Effect.Effect<RenderClock> = Effect.clockWith((clock) =>
  Effect.succeed(renderClockOf(clock)),
);

export function renderDeadlineOn(clock: RenderClock, milliseconds: number): RenderDeadline {
  const until = clock() + milliseconds;
  return {
    check: () => {
      assert(clock() <= until, renderTimeExceeded);
    },
  };
}
