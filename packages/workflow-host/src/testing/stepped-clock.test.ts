import { Clock, Context, Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import { tallyFolderOf } from '../folder-testing/tally-folder.ts';
import { workflowHostOnALedger } from '../ledger-testing/ledger-connections.ts';
import { forkedIn } from '../loop/forked-fibers.ts';
import { someFolder } from '../projector/folder.ts';
import { aLedgerInMemory, onSQLite } from './host-files.ts';
import { hostedOn, recordedOptionsOf } from './host-runs.ts';
import { steppedBy, steppedClock, type SteppedClock } from './stepped-clock.ts';

const start = Date.parse('2026-10-06T09:00:00.000Z');

describe('a stepped clock', () => {
  it('ends a sleep of nothing at once, with no step, as a clock that has already passed the time would', async () => {
    const clock = steppedClock(start);

    await Effect.runPromise(clock.sleep(0));

    expect([clock.asleep(), clock.now()]).toEqual([0, start]);
  });

  it('ends a sleep at the step that reaches its time, and not before', async () => {
    const clock = steppedClock(start);
    const sleep = Effect.runPromise(clock.sleep(1000));
    clock.step(999);
    const early = clock.asleep();
    clock.step(1);
    await sleep;

    expect([early, clock.asleep(), clock.now()]).toEqual([1, 0, start + 1000]);
  });

  it('says once as many sleep on it as a test waits for, and forgets a sleep that was interrupted', async () => {
    const clock = steppedClock(start);
    const asleep = clock.asleepAtLeast(2);
    const first = Effect.runFork(clock.sleep(1000));
    Effect.runFork(clock.sleep(2000));

    const counted = await asleep;
    await Effect.runPromise(Fiber.interrupt(first));

    expect([counted, clock.asleep()]).toEqual([2, 1]);
  });
});

interface TwoFibers {
  /** Lets the second fiber go on from its work, to sleep on the clock. */
  readonly worked: () => void;
  readonly stopped: () => Promise<void>;
}

/** Two fibers of a host on the clock: the first sleeps for ever, the second works until told, then sleeps for ever. */
function twoFibersOn(clock: SteppedClock, sleepMs: { readonly first: number; readonly second: number }): TwoFibers {
  const context = clock.watching();
  const working = Promise.withResolvers<void>();
  const first = forkedIn(context, Effect.forever(clock.sleep(sleepMs.first)), 'first');
  const second = forkedIn(
    context,
    Effect.andThen(
      Effect.promise(() => working.promise),
      Effect.forever(clock.sleep(sleepMs.second)),
    ),
    'second',
  );
  return {
    worked: () => {
      working.resolve();
    },
    stopped: () => Effect.runPromise(Effect.andThen(Fiber.interrupt(first), Fiber.interrupt(second))),
  };
}

const eachSleeping20 = { first: 20, second: 20 };

describe('the rest of a host on a stepped clock', () => {
  it('comes once every fiber the host forked that still lives sleeps on the clock, and not while one works', async () => {
    const clock = steppedClock(start);
    const fibers = twoFibersOn(clock, eachSleeping20);
    const rested = { now: false };
    const rest = clock.atRest().then(() => {
      rested.now = true;
      return rested.now;
    });
    await clock.asleepAtLeast(1);
    const whileOneWorks = rested.now;
    const awakeWhileOneWorks = clock.awake();
    fibers.worked();

    await rest;
    const awakeAtRest = clock.awake();
    await fibers.stopped();

    expect([whileOneWorks, clock.asleep(), clock.now()]).toEqual([false, 0, start]);
    expect([awakeWhileOneWorks, awakeAtRest]).toEqual([['second'], []]);
  });

  it('comes once a fiber the host forked has ended, as it no longer works', async () => {
    const clock = steppedClock(start);
    const context = clock.watching();
    const ending = Promise.withResolvers<void>();
    const sleeping = forkedIn(context, Effect.forever(clock.sleep(20)), 'sleeping');
    forkedIn(
      context,
      Effect.promise(() => ending.promise),
      'ending',
    );
    const rest = clock.atRest();
    await clock.asleepAtLeast(1);
    ending.resolve();

    await rest;
    await Effect.runPromise(Fiber.interrupt(sleeping));

    expect(clock.now()).toBe(start);
  });

  it('cannot be known of a host not given the watching context, and says so', async () => {
    const clock = steppedClock(start);

    await expect(clock.atRest()).rejects.toThrow(Error);
  });
});

/** The system's clock, but for a sleep, which is counted and ends its fiber: no loop of a host may sleep on it. */
function failingEachSleep(slept: () => void): Clock.Clock {
  const theSystems = Context.get(Context.empty(), Clock.Clock);
  return {
    currentTimeMillisUnsafe: () => theSystems.currentTimeMillisUnsafe(),
    currentTimeMillis: theSystems.currentTimeMillis,
    monotonicTimeNanosUnsafe: () => theSystems.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: theSystems.monotonicTimeNanos,
    currentTimeNanosUnsafe: () => theSystems.currentTimeNanosUnsafe(),
    currentTimeNanos: theSystems.currentTimeNanos,
    sleep: () =>
      Effect.andThen(Effect.sync(slept), Effect.die(new Error('A loop of the host slept off the clock it was given'))),
  };
}

describe('a host on a stepped clock, with a follower and a projector', () => {
  it('comes to rest with each of its loops asleep on the clock it was given, and none on any other', async () => {
    const clock = steppedClock(start);
    const offTheClock = { slept: 0 };
    await hostedOn(await aLedgerInMemory(), {
      clock,
      sweepEveryMs: 20,
      context: clock.watching(
        Context.make(
          Clock.Clock,
          failingEachSleep(() => {
            offTheClock.slept += 1;
          }),
        ),
      ),
      projector: { folders: [someFolder(tallyFolderOf(1))], playbooksAtOnce: 1, pagesPerWake: 1 },
    });

    await clock.atRest();

    expect([offTheClock.slept, clock.asleep()]).toEqual([0, 4]);
  });
});

describe('a host given no clock', () => {
  it("sleeps on Effect's clock, as it does in production", async () => {
    const onEffects = { slept: 0 };
    const slept = Promise.withResolvers<void>();
    const { clock: _given, ...options } = recordedOptionsOf().options;
    const host = await workflowHostOnALedger(await onSQLite(), {
      ...options,
      context: Context.make(
        Clock.Clock,
        failingEachSleep(() => {
          onEffects.slept += 1;
          slept.resolve();
        }),
      ),
    });

    await slept.promise;
    await host.stop();

    expect(onEffects.slept).toBeGreaterThan(0);
  });
});

describe('the sweeps a test steps a stepped clock by', () => {
  it('step only once the host is at rest, and answer at the first sweep at which the read holds', async () => {
    const clock = steppedClock(start);
    const fibers = twoFibersOn(clock, { first: 20, second: 1000 });
    const asleepAtEachRead: number[] = [];
    const answered = steppedBy(clock, 20).until(
      () => {
        asleepAtEachRead.push(clock.asleep());
        return clock.now();
      },
      (now) => now >= start + 40,
      { atMost: 5 },
    );
    await clock.asleepAtLeast(1);
    const whileOneWorks = clock.now();
    fibers.worked();

    const now = await answered;
    await fibers.stopped();

    expect([whileOneWorks, now, asleepAtEachRead]).toEqual([start, start + 40, [2, 2, 2]]);
  });

  it('step no further than the sweeps the test allows, and then fail saying how far they stepped', async () => {
    const clock = steppedClock(start);
    const sleeping = forkedIn(clock.watching(), Effect.forever(clock.sleep(20)), 'sleeping');

    const failed = await steppedBy(clock, 20)
      .until(
        () => clock.now(),
        () => false,
        { atMost: 3 },
      )
      .catch((error: unknown) => error);
    await Effect.runPromise(Fiber.interrupt(sleeping));

    expect([failed, clock.now()]).toEqual([expect.any(Error), start + 60]);
  });
});

describe('the rest a test waits for between its sweeps', () => {
  it('comes once the host is at rest, and steps nothing', async () => {
    const clock = steppedClock(start);
    const fibers = twoFibersOn(clock, eachSleeping20);
    const rested = steppedBy(clock, 20).rested();
    await clock.asleepAtLeast(1);
    fibers.worked();

    await rested;
    await fibers.stopped();

    expect([clock.asleep(), clock.now()]).toEqual([0, start]);
  });
});
