import type { WorkflowEngine } from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import type { Trouble } from '../calls/host-executor.ts';
import { duePerformer, type DuePerformer, type DueWork } from '../due-work/due-work.ts';
import type { DueTimer, TimerTable } from '../timers/sql-timers.ts';
import type { HostContext } from './forked-fibers.ts';
import type { HostClock } from './host-clock.ts';

export interface WakeUpParts {
  readonly clock: HostClock;
  readonly timers: Omit<TimerTable, 'timers'>;
  readonly dueWork: readonly DueWork[];
  readonly engine: WorkflowEngine;
  readonly fire: (timer: DueTimer, at: number) => Effect.Effect<void, unknown>;
  readonly resume: () => Effect.Effect<number>;
  readonly trouble: Trouble;
  readonly sweepEveryMs: number;
  readonly context?: HostContext;
}

export interface Woken {
  readonly now: number;
  readonly sweep: boolean;
}

export interface NextWake {
  readonly nextDueAt: number | null;
}

export interface WakeSignal {
  readonly raised: () => void;
  readonly renewed: () => void;
}

export interface HostWakeUp {
  readonly wakeUp: (woken: Woken) => Effect.Effect<NextWake>;
  readonly stop: () => Effect.Effect<void>;
}

const timersInOneWakeUp = 256;

const firesAtOnce = 16;

const overdueBeforeSwept = 60_000;

function firedDue({ timers, fire, trouble, sweepEveryMs }: WakeUpParts, now: number): Effect.Effect<void> {
  return Effect.flatMap(timers.due(now, timersInOneWakeUp), (due) =>
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

function sweptBy({ engine, resume, trouble }: WakeUpParts, now: number): Effect.Effect<void> {
  return engine.sweep(now - overdueBeforeSwept).pipe(
    Effect.andThen(resume()),
    Effect.catchCause((cause) => trouble('A sweep of the runs failed; the next sweep tries again', cause)),
  );
}

function roundOf(parts: WakeUpParts, due: DuePerformer, { now, sweep }: Woken): Effect.Effect<void> {
  return due.performed(now).pipe(
    Effect.andThen(firedDue(parts, now)),
    Effect.andThen(sweep ? sweptBy(parts, now) : Effect.void),
    Effect.catchCause((cause) =>
      parts.trouble('The timers of the runs could not be read; the loop tries again', cause),
    ),
  );
}

function nextTimerOf({ timers, trouble }: WakeUpParts): Effect.Effect<number | null> {
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

function nextWakeOf(parts: WakeUpParts, due: DuePerformer, now: number): Effect.Effect<NextWake> {
  return Effect.zipWith(nextTimerOf(parts), due.wakeAt(now), (timer, row) => {
    const nextDueAt = Math.min(timer ?? Number.POSITIVE_INFINITY, row);
    return { nextDueAt: Number.isFinite(nextDueAt) ? nextDueAt : null };
  });
}

export function hostWakeUp(parts: WakeUpParts, signal: WakeSignal): HostWakeUp {
  const { clock, trouble, context } = parts;
  const due = duePerformer(parts.dueWork, {
    trouble,
    now: clock.now,
    sleep: clock.sleep,
    wake: signal.raised,
    context,
  });
  const renewed = Effect.sync(() => {
    signal.renewed();
  });
  return {
    wakeUp: (woken) =>
      Effect.uninterruptible(roundOf(parts, due, woken)).pipe(
        Effect.andThen(renewed),
        Effect.andThen(() => nextWakeOf(parts, due, woken.now)),
      ),
    stop: due.stop,
  };
}
