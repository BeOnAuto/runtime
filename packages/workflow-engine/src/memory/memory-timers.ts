import { Effect } from 'effect';

import { DispatchFailed } from '../dispatch/dispatch-watermark.ts';
import type { ArmTimer, RunOutput } from '../dispatch/run-output.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { ArmReceipt, TimerCancelReceipt, Timers } from '../timers/timers.ts';
import type { VirtualClock } from './virtual-clock.ts';

export type Submit = (input: RunInput) => void;

export interface Dispatched {
  readonly at: number;
  readonly output: RunOutput;
}

type FaultKind = RunOutput['kind'] | 'note_due';

export interface Faults {
  readonly failNext: (kind: FaultKind) => void;
  readonly fails: (kind: FaultKind) => boolean;
  readonly attempt: <A>(output: RunOutput, work: () => A) => Effect.Effect<A, DispatchFailed>;
  readonly dispatched: () => readonly Dispatched[];
}

export interface MemoryTimers extends Timers {
  readonly forget: () => void;
}

export function faultsOf(clock: VirtualClock): Faults {
  const failing = new Set<FaultKind>();
  const dispatched: Dispatched[] = [];
  return {
    failNext: (kind) => {
      failing.add(kind);
    },
    fails: (kind) => failing.delete(kind),
    attempt: (output, work) =>
      Effect.suspend(() => {
        if (failing.delete(output.kind)) {
          return Effect.fail(new DispatchFailed({ output: output.kind, detail: 'The port was told to fail once' }));
        }
        dispatched.push({ at: clock.now(), output });
        return Effect.succeed(work());
      }),
    dispatched: () => dispatched,
  };
}

type TimerOfRun = Pick<ArmTimer, 'runId' | 'timerId'>;

interface Firing {
  readonly fire: (timer: ArmTimer) => void;
  readonly hasFired: (timer: TimerOfRun) => boolean;
  readonly isArmed: (timer: TimerOfRun) => boolean;
  readonly disarm: (timer: TimerOfRun) => boolean;
  readonly forget: () => void;
}

function timerKeyOf({ runId, timerId }: TimerOfRun): string {
  return JSON.stringify([runId, timerId]);
}

function firingOf(clock: VirtualClock, submit: Submit): Firing {
  const fired = new Set<string>();
  const armed = new Set<string>();
  return {
    fire: ({ runId, timerId, dueAt }) => {
      const key = timerKeyOf({ runId, timerId });
      armed.add(key);
      clock.schedule(dueAt, key, () => {
        armed.delete(key);
        fired.add(key);
        submit({ kind: 'timer_fired', runId, at: clock.now(), timerId });
      });
    },
    hasFired: (timer) => fired.has(timerKeyOf(timer)),
    isArmed: (timer) => armed.has(timerKeyOf(timer)),
    disarm: (timer) => armed.delete(timerKeyOf(timer)) && clock.unschedule(timerKeyOf(timer)),
    forget: () => {
      for (const key of armed) {
        clock.unschedule(key);
      }
      armed.clear();
    },
  };
}

export function memoryTimers(clock: VirtualClock, submit: Submit, faults: Faults): MemoryTimers {
  const firing = firingOf(clock, submit);
  const tombstones = new Set<string>();
  const arm = (timer: ArmTimer): ArmReceipt => {
    if (tombstones.has(timerKeyOf(timer))) {
      return 'refused_after_cancel';
    }
    if (firing.isArmed(timer) || firing.hasFired(timer)) {
      return 'already_armed';
    }
    firing.fire(timer);
    return 'armed';
  };
  const cancel = (timer: TimerOfRun): TimerCancelReceipt => {
    if (firing.hasFired(timer)) {
      return 'already_fired';
    }
    tombstones.add(timerKeyOf(timer));
    return firing.disarm(timer) ? 'cancelled' : 'tombstoned';
  };
  return {
    arm: (timer) => faults.attempt(timer, () => arm(timer)),
    cancel: (timer) => faults.attempt(timer, () => cancel(timer)),
    sweep: (_run, timers) =>
      Effect.sync(() => {
        const lost = timers.filter((timer) => !firing.isArmed(timer) && !firing.hasFired(timer));
        for (const timer of lost) {
          firing.fire(timer);
        }
        return lost.length;
      }),
    forget: firing.forget,
  };
}
