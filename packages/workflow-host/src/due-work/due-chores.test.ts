import type { WorkflowEngine } from '@on.auto/workflow-engine';
import { Effect, Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { hostWakeUp, type NextWake } from '../loop/host-wake-up.ts';
import { until } from '../testing/until.ts';
import { steppedClock, type SteppedClock } from '../views-testing/stepped-sweeps.ts';
import { choreWork, type Chore } from './due-chores.ts';

const noTimers = {
  due: () => Effect.succeed([]),
  nextDueAt: () => Effect.succeed(null),
  fired: () => Effect.void,
  postponed: () => Effect.void,
};

const idleEngine: WorkflowEngine = {
  submit: () => Effect.die(new Error('A chore submits nothing')),
  wake: () => Effect.die(new Error('A chore wakes no run')),
  sweep: () => Effect.succeed({ runs: 0, timersArmedAgain: 0 }),
};

function wakeUpWith(chore: Chore, clock: SteppedClock): (now: number) => Promise<NextWake> {
  const work = hostWakeUp(
    {
      clock,
      timers: noTimers,
      dueWork: [choreWork(chore)],
      engine: idleEngine,
      fire: () => Effect.void,
      resume: () => Effect.succeed(0),
      trouble: () => Effect.void,
      sweepEveryMs: 1000,
    },
    { raised: Function.constVoid, renewed: Function.constVoid },
  );
  onTestFinished(() => Effect.runPromise(work.stop()));
  return (now) => Effect.runPromise(work.wakeUp({ now, sweep: false }));
}

describe('a chore the wake-up of the host performs', () => {
  it('is performed at the first wake-up, wakes nothing while it is under way, then waits for the time it answered', async () => {
    const performedAt: number[] = [];
    const held = Promise.withResolvers<void>();
    const clock = steppedClock(5000);
    const chore: Chore = {
      name: 'orphans',
      perform: (now) =>
        Effect.andThen(
          Effect.promise(() => held.promise),
          Effect.sync(() => {
            performedAt.push(now);
            return now + 1000;
          }),
        ),
    };
    const wakeUp = wakeUpWith(chore, clock);

    const underWay = await wakeUp(5000);
    held.resolve();
    await until(
      () => performedAt.length,
      (performed) => performed > 0,
    );
    clock.step(500);
    const between = await wakeUp(5500);
    clock.step(500);
    await wakeUp(6000);
    await until(
      () => performedAt.length,
      (performed) => performed > 1,
    );

    expect([underWay, between]).toEqual([{ nextDueAt: null }, { nextDueAt: 6000 }]);
    expect(performedAt).toEqual([5000, 6000]);
  });

  it('answers the time it is next due among the work that calls out, and none among the rest', async () => {
    const work = choreWork({ name: 'orphans', perform: (now) => Effect.succeed(now + 1000) });
    await Effect.runPromise(
      Effect.flatMap(work.due(5000, 1, true), (items) => Effect.forEach(items, (item) => item.perform(5000))),
    );

    const next = await Effect.runPromise(
      Effect.all([work.nextDueAt(5000), work.nextDueAt(5000, true), work.nextDueAt(5000, false)]),
    );

    expect(next).toEqual([6000, 6000, null]);
  });
});
