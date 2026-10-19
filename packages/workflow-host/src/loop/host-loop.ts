import type { WorkflowEngine } from '@on.auto/workflow-engine';
import { Effect, Fiber } from 'effect';

import type { Trouble } from '../calls/host-executor.ts';
import { duePerformer, type DuePerformer, type DueWork } from '../due-work/due-work.ts';
import type { DueTimer, TimerTable } from '../timers/sql-timers.ts';
import { forkedIn, type HostContext } from './forked-fibers.ts';
import type { HostClock } from './host-clock.ts';

export interface LoopParts {
  readonly clock: HostClock;
  readonly timers: TimerTable;
  readonly dueWork: readonly DueWork[];
  readonly engine: WorkflowEngine;
  readonly fire: (timer: DueTimer, at: number) => Effect.Effect<void, unknown>;
  readonly resume: () => Effect.Effect<number>;
  readonly trouble: Trouble;
  readonly sweepEveryMs: number;
  readonly context?: HostContext;
}

export interface HostLoop {
  readonly armed: (dueAt: number) => void;
  readonly stop: () => Promise<void>;
}

const timersInOneTick = 256;

const firesAtOnce = 16;

const overdueBeforeSwept = 60_000;

function firedDue({ timers, fire, trouble, sweepEveryMs }: LoopParts, now: number): Effect.Effect<void> {
  return Effect.flatMap(timers.due(now, timersInOneTick), (due) =>
    Effect.forEach(
      due,
      (timer) =>
        fire(timer, now).pipe(
          Effect.andThen(timers.fired(timer)),
          Effect.catchCause((cause) =>
            Effect.andThen(
              timers.postponed(timer, now + sweepEveryMs),
              trouble('A timer of a run could not fire; it fires again at the next sweep', cause),
            ),
          ),
        ),
      { concurrency: firesAtOnce, discard: true },
    ),
  );
}

function sweptBy({ engine, resume, trouble }: LoopParts, now: number): Effect.Effect<void> {
  return engine.sweep(now - overdueBeforeSwept).pipe(
    Effect.andThen(resume()),
    Effect.catchCause((cause) => trouble('A sweep of the runs failed; the next sweep tries again', cause)),
  );
}

function nextDueOf({ timers, trouble }: LoopParts): Effect.Effect<number | null> {
  return timers
    .nextDueAt()
    .pipe(
      Effect.catchCause((cause) =>
        Effect.as(
          trouble('The next due time of the timers could not be read; the loop waits for the next sweep', cause),
          null,
        ),
      ),
    );
}

function dueOf({ dueWork, trouble, clock, context }: LoopParts, wake: () => void): DuePerformer {
  return duePerformer(dueWork, { trouble, now: clock.now, sleep: clock.sleep, wake, context });
}

export function startLoop(parts: LoopParts): HostLoop {
  const { clock, sweepEveryMs } = parts;
  const plan = {
    wakeAt: Number.NEGATIVE_INFINITY,
    armedSince: Number.POSITIVE_INFINITY,
    lastSweptAt: Number.NEGATIVE_INFINITY,
    tickedAt: Number.NEGATIVE_INFINITY,
    signal: Promise.withResolvers<void>(),
  };
  const due = dueOf(parts, () => {
    plan.signal.resolve();
  });
  const tick = Effect.suspend(() => {
    const now = clock.now();
    plan.tickedAt = now;
    const sweepDue = now >= plan.lastSweptAt + sweepEveryMs;
    if (sweepDue) {
      plan.lastSweptAt = now;
    }
    return due
      .performed(now)
      .pipe(Effect.andThen(firedDue(parts, now)), Effect.andThen(sweepDue ? sweptBy(parts, now) : Effect.void));
  }).pipe(
    Effect.catchCause((cause) =>
      parts.trouble('The timers of the runs could not be read; the loop tries again', cause),
    ),
  );
  const wait = Effect.gen(function* () {
    plan.armedSince = Number.POSITIVE_INFINITY;
    plan.signal = Promise.withResolvers<void>();
    const { promise } = plan.signal;
    const nextDue = (yield* nextDueOf(parts)) ?? Number.POSITIVE_INFINITY;
    const dueWorkAt = yield* due.wakeAt(plan.tickedAt);
    plan.wakeAt = Math.min(nextDue, dueWorkAt, plan.lastSweptAt + sweepEveryMs, plan.armedSince);
    yield* Effect.raceFirst(
      clock.sleep(Math.max(0, plan.wakeAt - clock.now())),
      Effect.promise(() => promise),
    );
  });
  const fiber = forkedIn(parts.context, Effect.forever(Effect.andThen(Effect.uninterruptible(tick), wait)));
  return {
    armed: (dueAt) => {
      plan.armedSince = Math.min(plan.armedSince, dueAt);
      if (dueAt < plan.wakeAt) {
        plan.signal.resolve();
      }
    },
    stop: () => Effect.runPromise(Fiber.interrupt(fiber).pipe(Effect.andThen(due.stop()))),
  };
}
