import { statement } from '@on.auto/ledger';
import type { ArmTimer, WorkflowEngine } from '@on.auto/workflow-engine';
import { Deferred, Effect, Exit, Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { until } from '../testing/until.ts';
import { type WatchedClock, watchedSystemClock } from '../testing/watched-clock.ts';
import { type DueTimer, sqlTimers, type TimerTable } from '../timers/sql-timers.ts';
import { failedRoundsOn } from './failed-rounds.ts';
import { type HostLoop, startLoop } from './host-loop.ts';
import {
  type FailedRounds,
  hostWakeUp,
  type NextWake,
  oneWakeAtATime,
  type WakeUpParts,
  type Woken,
} from './host-wake-up.ts';

const runKey = 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const run = { runId: runKey, attributes: {} };

interface Looping {
  readonly loop: HostLoop;
  readonly clock: WatchedClock;
  readonly arm: (timerId: string, inMs: number) => Promise<number>;
  readonly fired: () => readonly string[];
  readonly troubles: () => readonly string[];
  readonly sweeps: () => number;
}

interface LoopingOptions {
  readonly sweepEveryMs: number;
  readonly fire?: (timer: DueTimer) => Effect.Effect<void, unknown>;
  readonly sweep?: () => Effect.Effect<void>;
  readonly readsFailing?: number;
}

function failingReadsOf(timers: TimerTable, readsFailing: number): TimerTable {
  const dueFailing = failingFirst(readsFailing);
  const nextDueFailing = failingFirst(readsFailing);
  return {
    ...timers,
    due: (now, limit) => dueFailing(timers.due(now, limit)),
    nextDueAt: () => nextDueFailing(timers.nextDueAt()),
  };
}

function failingFirst(times: number) {
  const failures = { left: times };
  return <A>(read: Effect.Effect<A>): Effect.Effect<A> =>
    Effect.suspend(() => {
      failures.left -= 1;
      return failures.left < 0 ? read : Effect.die(new Error('The database is down'));
    });
}

const firedAtOnce = (): Effect.Effect<void> => Effect.void;

const sweptAtOnce = (): Effect.Effect<void> => Effect.void;

const noEngine: WorkflowEngine = {
  submit: () => Effect.die(new Error('The loop submits through the host')),
  wake: () => Effect.die(new Error('The loop wakes runs through a sweep')),
  sweep: () => Effect.succeed({ runs: 0, timersArmedAgain: 0 }),
};

async function looping(options: LoopingOptions): Promise<Looping> {
  const { sweepEveryMs, fire = firedAtOnce, sweep = sweptAtOnce, readsFailing = 0 } = options;
  const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
  const fired: string[] = [];
  const troubles: string[] = [];
  const counts = { sweeps: 0 };
  const clock = watchedSystemClock();
  const alarm: { armed: (dueAt: number) => void } = { armed: Function.constVoid };
  const timers = sqlTimers(database, (dueAt) => {
    alarm.armed(dueAt);
  });
  const parts: WakeUpParts = {
    clock,
    dueWork: [],
    timers: failingReadsOf(timers, readsFailing),
    engine: {
      ...noEngine,
      sweep: () =>
        Effect.suspend(() => {
          counts.sweeps += 1;
          return sweep();
        }).pipe(Effect.as({ runs: 0, timersArmedAgain: 0 })),
    },
    fire: (timer) =>
      Effect.andThen(
        fire(timer),
        Effect.sync(() => fired.push(timer.timerId)),
      ),
    resume: () => Effect.succeed(0),
    trouble: (what) => Effect.sync(() => troubles.push(what)),
    sweepEveryMs,
  };
  const loop = startLoop(parts, (signal) => hostWakeUp(parts, signal));
  alarm.armed = loop.armed;
  onTestFinished(() => loop.stop());
  return {
    loop,
    clock,
    arm: async (timerId, inMs) => {
      const dueAt = Date.now() + inMs;
      const timer: ArmTimer = { kind: 'arm_timer', runId: runKey, timerId, dueAt, purpose: 'wait' };
      await Effect.runPromise(timers.timers.arm(timer, run, { version: 1 }));
      return dueAt;
    },
    fired: () => fired,
    troubles: () => troubles,
    sweeps: () => counts.sweeps,
  };
}

function failingOnce(): (timer: DueTimer) => Effect.Effect<void, Error> {
  const failures = { left: 1 };
  return () =>
    Effect.suspend(() => {
      failures.left -= 1;
      return failures.left < 0 ? Effect.void : Effect.fail(new Error('The run is busy'));
    });
}

function writesFailing(database: HostDatabase): HostDatabase {
  return { ...database, write: () => Effect.fail(new DatabaseFailed({ detail: 'The test failed this write' })) };
}

function waitsOf(rounds: FailedRounds, failures: number): Promise<readonly number[]> {
  return Effect.runPromise(Effect.forEach(Array.from({ length: failures }), () => rounds.failed()));
}

interface Counted {
  readonly wakeUp: (woken: Woken) => Promise<NextWake>;
  readonly rounds: () => readonly Woken[];
  readonly release: () => Promise<void>;
}

function countedWakeUp(failing: boolean): Counted {
  const rounds: Woken[] = [];
  const holding = { gate: Deferred.makeUnsafe<void>() };
  const wakeUp = oneWakeAtATime((woken) =>
    Effect.suspend(() => {
      rounds.push(woken);
      const round = Deferred.await(holding.gate).pipe(Effect.as({ nextDueAt: woken.now + 1000 }));
      return failing ? Effect.andThen(round, Effect.die(new Error('The round broke'))) : round;
    }),
  );
  return {
    wakeUp: (woken) => Effect.runPromise(wakeUp(woken)),
    rounds: () => rounds,
    release: async () => {
      await Effect.runPromise(Deferred.done(holding.gate, Exit.void));
      holding.gate = Deferred.makeUnsafe<void>();
    },
  };
}

const anError: unknown = expect.any(Error);

describe('the loop of the host, firing timers', () => {
  it('fires a timer when it is due, woken from a long wait by the timer being armed', async () => {
    const loop = await looping({ sweepEveryMs: 3_600_000 });
    await until(loop.clock.asked, (asked) => asked.some((milliseconds) => milliseconds > 60_000));

    const dueAt = await loop.arm('1', 30);
    const fired = await until(loop.fired, (timers) => timers.length > 0);

    expect([fired, Date.now() >= dueAt, loop.sweeps()]).toEqual([['1'], true, 1]);
  });

  it('puts off a timer that could not fire until the next sweep, and reports it', async () => {
    const loop = await looping({ sweepEveryMs: 40, fire: failingOnce() });

    await loop.arm('1', 0);
    const fired = await until(loop.fired, (timers) => timers.length > 0);

    expect([fired, loop.troubles()]).toEqual([
      ['1'],
      ['A timer of a run could not fire; it fires again at the next sweep'],
    ]);
  });
});

describe('the loop of the host, sweeping and stopping', () => {
  it('reports a sweep that failed, and sweeps again at the next interval', async () => {
    const loop = await looping({ sweepEveryMs: 20, sweep: () => Effect.die(new Error('The ledger is down')) });

    await until(loop.sweeps, (sweeps) => sweeps >= 2);

    expect(new Set(loop.troubles())).toEqual(new Set(['A sweep of the runs failed; the next sweep tries again']));
  });

  it('reports a read of its timers that failed, and fires them once the reads come back', async () => {
    const loop = await looping({ sweepEveryMs: 20, readsFailing: 1 });

    await loop.arm('1', 0);
    const fired = await until(loop.fired, (timers) => timers.length > 0);

    expect([fired, new Set(loop.troubles())]).toEqual([
      ['1'],
      new Set([
        'The timers of the runs could not be read; the loop tries again',
        'The next due time of the timers could not be read; the loop waits for the next sweep',
      ]),
    ]);
  });

  it('finishes the timer it is firing when it is stopped', async () => {
    const firing = Deferred.makeUnsafe<void>();
    const finishing = Deferred.makeUnsafe<void>();
    const loop = await looping({
      sweepEveryMs: 3_600_000,
      fire: () => Effect.andThen(Deferred.done(firing, Exit.void), Deferred.await(finishing)),
    });
    await loop.arm('1', 0);
    await Effect.runPromise(Deferred.await(firing));

    const stopped = loop.loop.stop();
    const firedBeforeFinishing = [...loop.fired()];
    await Effect.runPromise(Deferred.done(finishing, Exit.void));
    await stopped;

    expect([firedBeforeFinishing, loop.fired()]).toEqual([[], ['1']]);
  });
});

describe('the rounds of a wake-up that failed in a row', () => {
  it('put the next round off a minute after the first, twice as long after each in a row, at most an hour', async () => {
    const rounds = failedRoundsOn(await openedOn({ store: 'sqlite', file: aSQLiteFile() }), 'follower');

    expect(await waitsOf(rounds, 9)).toEqual([
      60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000, 3_600_000,
    ]);
  });

  it('are counted in the database, so a wake-up composed again over it goes on counting, and a round that succeeds starts the count again', async () => {
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    const first = failedRoundsOn(database, 'follower');
    const second = failedRoundsOn(database, 'follower');
    const third = failedRoundsOn(database, 'follower');

    const waits = [...(await waitsOf(first, 2)), ...(await waitsOf(second, 1))];
    await Effect.runPromise(second.succeeded());
    await Effect.runPromise(second.succeeded());
    waits.push(...(await waitsOf(second, 1)));
    await Effect.runPromise(third.succeeded());
    const kept = await Effect.runPromise(database.read(statement`SELECT name, rounds FROM workflow_failed_rounds`));

    expect(waits).toEqual([60_000, 120_000, 240_000, 60_000]);
    expect(kept).toEqual([]);
  });

  it('are counted in memory while the database cannot be written, and a round that succeeds then fails as the write does', async () => {
    const rounds = failedRoundsOn(writesFailing(await openedOn({ store: 'sqlite', file: aSQLiteFile() })), 'follower');

    const waits = await waitsOf(rounds, 2);
    const succeeded = await Effect.runPromiseExit(rounds.succeeded());

    expect(waits).toEqual([60_000, 120_000]);
    expect(Exit.isFailure(succeeded)).toBe(true);
  });
});

describe('a wake-up woken while it runs', () => {
  it('runs one round: the wake that comes while one runs waits for it and answers what it answers, and a later wake runs a round of its own', async () => {
    const counted = countedWakeUp(false);

    const together = Promise.all([counted.wakeUp({ now: 1, sweep: true }), counted.wakeUp({ now: 2, sweep: false })]);
    await counted.release();
    const answers = await together;
    const later = counted.wakeUp({ now: 3, sweep: false });
    await counted.release();

    expect([answers, await later, counted.rounds()]).toEqual([
      [{ nextDueAt: 1001 }, { nextDueAt: 1001 }],
      { nextDueAt: 1003 },
      [
        { now: 1, sweep: true },
        { now: 3, sweep: false },
      ],
    ]);
  });

  it('fails both wakes with the round that failed, and runs the next wake anew', async () => {
    const counted = countedWakeUp(true);

    const together = Promise.allSettled([
      counted.wakeUp({ now: 1, sweep: true }),
      counted.wakeUp({ now: 2, sweep: true }),
    ]);
    await counted.release();
    const settled = await together;
    const later = counted.wakeUp({ now: 3, sweep: true }).catch((error: unknown) => error);
    await counted.release();

    expect(settled.map((outcome: Readonly<PromiseSettledResult<NextWake>>) => outcome.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect([await later, counted.rounds().length]).toEqual([anError, 2]);
  });
});
