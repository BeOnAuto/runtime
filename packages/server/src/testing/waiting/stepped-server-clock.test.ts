import { ForkWatch } from '@on.auto/workflow-host';
import { steppedBy } from '@on.auto/workflow-host/testing';
import { Context, Effect, Fiber } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';

import { effectClockOn, namingTheAwake, steppedServerClock, whenSwept } from './stepped-server-clock.ts';
import { statementsInHand } from './work-in-hand.ts';

describe("Effect's Clock for a server on a stepped clock", () => {
  it('reads the time of the stepped clock, in milliseconds and in nanoseconds, as it moves', () => {
    const clock = steppedServerClock(1000, 1000);
    const effectClock = effectClockOn(clock.now);
    const read = () => [
      effectClock.currentTimeMillisUnsafe(),
      Effect.runSync(effectClock.currentTimeMillis),
      effectClock.currentTimeNanosUnsafe(),
      Effect.runSync(effectClock.currentTimeNanos),
    ];
    const before = read();
    clock.moveTo(2500);

    expect([before, read()]).toEqual([
      [1000, 1000, 1_000_000_000n, 1_000_000_000n],
      [2500, 2500, 2_500_000_000n, 2_500_000_000n],
    ]);
  });
});

describe('a wait that steps the sweeps of a server', () => {
  it('steps the clock of its own the server runs on, a sweep at a time, until the read holds', async () => {
    const clock = steppedServerClock(0, 1000);
    const context = clock.watching();
    const done = { now: false };
    const host = Effect.runForkWith(context)(
      Effect.andThen(
        clock.sleep(3000),
        Effect.sync(() => {
          done.now = true;
        }),
      ),
    );
    Context.get(context, ForkWatch).forked(
      (ended) => {
        host.addObserver(ended);
      },
      { label: 'host' },
    );

    const held = await whenSwept(
      { clock },
      () => done.now,
      (now) => now,
    );

    expect([held, clock.now()]).toEqual([true, 3000]);
  });

  it('fails at once, saying so, for a server with no stepped clock of its own to step', async () => {
    await expect(
      whenSwept(
        {},
        () => false,
        (held) => held,
      ),
    ).rejects.toThrow(/no stepped clock/u);
  });
});

/** The next macrotask, by which a host at rest has been stepped, unless something keeps it from rest. */
function aTurnLater(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe('a wait that steps the sweeps of a server with work in hand', () => {
  it('steps no sweep while a request or a statement of its ledger is in hand, though every fiber of its host sleeps', async () => {
    const clock = steppedServerClock(0, 1000);
    const context = clock.watching();
    const busyWhenWoken: boolean[] = [];
    const host = Effect.runForkWith(context)(
      Effect.forever(
        Effect.andThen(
          clock.sleep(1000),
          Effect.sync(() => busyWhenWoken.push(clock.inHand.busy())),
        ),
      ),
    );
    Context.get(context, ForkWatch).forked(
      (ended) => {
        host.addObserver(ended);
      },
      { label: 'sleeping' },
    );
    const statement = Promise.withResolvers<string>();
    const ledger = statementsInHand(clock.inHand, {
      holderOfRunId: (_claimed: { readonly runId: string }) => Effect.promise(() => statement.promise),
      named: (name: string) => name,
      content: 'kept',
    });
    const request = clock.inHand.begun();
    const read = Effect.runPromise(ledger.holderOfRunId({ runId: 'run' }));

    const swept = clock.swept.until(
      () => busyWhenWoken.length,
      (woken) => woken > 0,
      { atMost: 1 },
    );
    await aTurnLater();
    request();
    await aTurnLater();
    statement.resolve('holder');

    expect([await swept, await read, busyWhenWoken, clock.now()]).toEqual([1, 'holder', [false], 1000]);
    expect([ledger.named('plain'), ledger.content]).toEqual(['plain', 'kept']);
    await Effect.runPromise(Fiber.interrupt(host));
  });
});

/** What a test would add to its failure as it fails, each said once. */
function failingTheTest(): {
  readonly whenTheTestFails: (named: () => void) => void;
  readonly failed: () => unknown[];
} {
  const handlers: (() => void)[] = [];
  return {
    whenTheTestFails: (named) => {
      handlers.push(named);
    },
    failed: () =>
      handlers.flatMap((named) => {
        try {
          named();
          return [];
        } catch (failure) {
          return [failure];
        }
      }),
  };
}

describe('a wait for the rest of a server whose test fails while it waits', () => {
  it('names the fibers of the host still awake, and nothing once the wait has ended', async () => {
    const clock = steppedServerClock(0, 1000);
    const context = clock.watching();
    const working = Promise.withResolvers<void>();
    const host = Effect.runForkWith(context)(Effect.promise(() => working.promise));
    Context.get(context, ForkWatch).forked(
      (ended) => {
        host.addObserver(ended);
      },
      { label: 'working' },
    );
    const test = failingTheTest();
    const sweeps = namingTheAwake(clock, steppedBy(clock, 1000), test.whenTheTestFails);

    const rest = sweeps.rested();
    const whileItWaits = test.failed();
    working.resolve();
    await rest;
    const held = await sweeps.until(
      () => clock.now(),
      (now) => now >= 0,
      { atMost: 1 },
    );

    expect(whileItWaits).toEqual([expect.objectContaining({ name: 'StillAwake', awake: ['working'] })]);
    expect([held, test.failed()]).toEqual([0, []]);
  });
});

describe('a wait for the rest of a server in a hook, outside any test', () => {
  const rested = { now: false };

  beforeAll(async () => {
    const clock = steppedServerClock(0, 1000);
    const context = clock.watching();
    const host = Effect.runForkWith(context)(Effect.forever(clock.sleep(1000)));
    Context.get(context, ForkWatch).forked(
      (ended) => {
        host.addObserver(ended);
      },
      { label: 'sleeping' },
    );
    await clock.swept.rested();
    rested.now = true;
    await Effect.runPromise(Fiber.interrupt(host));
  });

  it('waits as in a test, with no test to name the awake to', () => {
    expect(rested.now).toBe(true);
  });
});
