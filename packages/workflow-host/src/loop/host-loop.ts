import { Effect, Fiber } from 'effect';

import { forkedIn } from './forked-fibers.ts';
import type { HostWakeUp, NextWake, WakeSignal, WakeUpParts } from './host-wake-up.ts';

type LoopParts = Pick<WakeUpParts, 'clock' | 'sweepEveryMs' | 'context'>;

export interface HostLoop {
  readonly armed: (dueAt: number) => void;
  readonly stop: () => Promise<void>;
}

export function startLoop(parts: LoopParts, wakeUpWith: (signal: WakeSignal) => HostWakeUp): HostLoop {
  const { clock, sweepEveryMs } = parts;
  const plan = {
    wakeAt: Number.NEGATIVE_INFINITY,
    armedSince: Number.POSITIVE_INFINITY,
    lastSweptAt: Number.NEGATIVE_INFINITY,
    signal: Promise.withResolvers<void>(),
  };
  const work = wakeUpWith({
    raised: () => {
      plan.signal.resolve();
    },
    renewed: () => {
      plan.armedSince = Number.POSITIVE_INFINITY;
      plan.signal = Promise.withResolvers<void>();
    },
  });
  const woken = Effect.suspend(() => {
    const now = clock.now();
    const sweep = now >= plan.lastSweptAt + sweepEveryMs;
    if (sweep) {
      plan.lastSweptAt = now;
    }
    return work.wakeUp({ now, sweep });
  });
  const slept = ({ nextDueAt }: NextWake) =>
    Effect.suspend(() => {
      const { promise } = plan.signal;
      plan.wakeAt = Math.min(nextDueAt ?? Number.POSITIVE_INFINITY, plan.lastSweptAt + sweepEveryMs, plan.armedSince);
      return Effect.raceFirst(
        clock.sleep(Math.max(0, plan.wakeAt - clock.now())),
        Effect.promise(() => promise),
      );
    });
  const fiber = forkedIn(parts.context, Effect.forever(Effect.flatMap(woken, slept)));
  return {
    armed: (dueAt) => {
      plan.armedSince = Math.min(plan.armedSince, dueAt);
      if (dueAt < plan.wakeAt) {
        plan.signal.resolve();
      }
    },
    stop: () => Effect.runPromise(Fiber.interrupt(fiber).pipe(Effect.andThen(work.stop()))),
  };
}
