import type { ArmTimer, WorkflowEngine } from '@on.auto/workflow-engine';
import { Effect, Function } from 'effect';
import { onTestFinished } from 'vitest';

import { systemClock, type HostClock } from '../loop/host-clock.ts';
import { startLoop } from '../loop/host-loop.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { sqlTimers } from '../timers/sql-timers.ts';
import type { FakeDueWork } from './fake-due-work.ts';

const runKey = 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const engine: WorkflowEngine = {
  submit: Function.constant(Effect.die(new Error('The loop submits through the host'))),
  wake: Function.constant(Effect.die(new Error('The loop wakes runs through a sweep'))),
  sweep: () => Effect.succeed({ runs: 0, timersArmedAgain: 0 }),
};

export interface DueLooping {
  readonly stop: () => Promise<void>;
  readonly order: () => readonly string[];
  readonly firedAt: () => readonly number[];
  readonly troubles: () => readonly string[];
  readonly armTimer: (dueAt: number, timerId?: string) => Promise<void>;
}

export async function dueLooping(
  rows: FakeDueWork,
  clock: HostClock = systemClock,
  sweepEveryMs = 3_600_000,
): Promise<DueLooping> {
  const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
  const order: string[] = [];
  const firedAt: number[] = [];
  const troubles: string[] = [];
  const alarm: { armed: (dueAt: number) => void } = { armed: Function.constVoid };
  const timers = sqlTimers(database, (dueAt) => {
    alarm.armed(dueAt);
  });
  const trouble = (what: string) =>
    Effect.sync(() => {
      troubles.push(what);
    });
  const loop = startLoop({
    clock,
    timers,
    dueWork: [rows.work('host')],
    engine,
    fire: ({ timerId }) =>
      Effect.sync(() => {
        order.push(`timer ${timerId} after ${rows.performed().length} rows`);
        firedAt.push(clock.now());
      }),
    resume: () => Effect.succeed(0),
    trouble,
    sweepEveryMs,
  });
  alarm.armed = loop.armed;
  onTestFinished(() => loop.stop());
  return {
    stop: loop.stop,
    order: () => order,
    firedAt: () => firedAt,
    troubles: () => troubles,
    armTimer: async (dueAt, timerId = '1') => {
      const timer: ArmTimer = { kind: 'arm_timer', runId: runKey, timerId, dueAt, purpose: 'wait' };
      await Effect.runPromise(timers.timers.arm(timer, { runId: runKey, attributes: {} }, { version: 1 }));
    },
  };
}

export function keysOf(count: number, prefix: string): readonly string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}
