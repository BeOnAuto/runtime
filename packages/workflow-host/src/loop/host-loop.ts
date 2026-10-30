import { Effect, Fiber } from 'effect';

import { forkedIn } from './forked-fibers.ts';
import type { HostClock } from './host-clock.ts';
import type { HostWakeUp, NextWake, WakeSignal, WakeUpParts } from './host-wake-up.ts';

export interface LoopParts extends Pick<WakeUpParts, 'clock' | 'sweepEveryMs' | 'context'> {
  readonly pace?: HostClock;
}

export interface HostLoop {
  readonly armed: (dueAt: number) => void;
  readonly stop: () => Promise<void>;
}

type WakeUpWith = (signal: WakeSignal) => HostWakeUp;

interface RunningLoop {
  readonly armed: HostLoop['armed'];
  readonly work: HostWakeUp;
  readonly ended: () => Effect.Effect<void>;
}

function runningLoop(parts: LoopParts, wakeUpWith: WakeUpWith): RunningLoop {
  const { clock, sweepEveryMs, pace = clock } = parts;
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
    const paced = pace.now();
    const sweep = paced >= plan.lastSweptAt + sweepEveryMs;
    if (sweep) {
      plan.lastSweptAt = paced;
    }
    return work.wakeUp({ now: clock.now(), sweep });
  });
  const slept = ({ nextDueAt }: NextWake) =>
    Effect.suspend(() => {
      const { promise } = plan.signal;
      const now = clock.now();
      const nextSweepAt = now + plan.lastSweptAt + sweepEveryMs - pace.now();
      plan.wakeAt = Math.min(nextDueAt ?? Number.POSITIVE_INFINITY, nextSweepAt, plan.armedSince);
      return Effect.raceFirst(
        pace.sleep(Math.max(0, plan.wakeAt - now)),
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
    work,
    ended: () => Effect.asVoid(Fiber.interrupt(fiber)),
  };
}

export function startLoop(parts: LoopParts, wakeUpWith: WakeUpWith): HostLoop {
  const { armed, work, ended } = runningLoop(parts, wakeUpWith);
  return { armed, stop: () => Effect.runPromise(Effect.andThen(ended(), work.stop())) };
}

export function startListeningLoop(parts: LoopParts, wakeUpWith: WakeUpWith): Pick<HostLoop, 'stop'> {
  const { work, ended } = runningLoop(parts, wakeUpWith);
  return { stop: () => Effect.runPromise(Effect.andThen(work.stop(), ended())) };
}
