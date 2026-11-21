import type { WorkflowEngine } from '@on.auto/workflow-engine';
import { Effect, Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { systemClock } from '../loop/host-clock.ts';
import { hostWakeUp, type NextWake } from '../loop/host-wake-up.ts';
import { aSQLiteFile } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { signals } from '../testing/signals.ts';
import { steppedClock, type SteppedClock } from '../testing/stepped-clock.ts';
import { type Chore, choreWork } from './due-chores.ts';
import { dueLooping, keysOf } from './due-looping.ts';
import { dueAwaitedMs, dueInOneWakeUp, duePerformedAtOnce, type DueWork } from './due-work.ts';
import { fakeDueWork, type FakeDueWork } from './fake-due-work.ts';
import { rowWaitBounds, rowWaits } from './row-waits.ts';

function rowsDueBy(count: number, dueAt: number, { callsOut }: { readonly callsOut: boolean }): FakeDueWork {
  const rows = fakeDueWork(1);
  for (const key of keysOf(count, 'row')) {
    rows.add(key, dueAt);
    if (!callsOut) {
      rows.local(key);
    }
  }
  return rows;
}

async function aSecondLater(clock: SteppedClock, rows: FakeDueWork, sweeps: number): Promise<void> {
  const asleep = clock.asleep();
  clock.step(1000);
  await rows.when(rows.reads, (read) => read.due >= sweeps);
  await clock.when(clock.asleep, (sleeping) => sleeping >= asleep);
}

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

const fiveMinutes = 5 * 60_000;

function nextDueFailingFirst(work: DueWork, times: number): DueWork {
  const failures = { left: times };
  return {
    ...work,
    nextDueAt: (after, callsOut) =>
      Effect.suspend(() => {
        failures.left -= 1;
        return failures.left < 0
          ? work.nextDueAt(after, callsOut)
          : Effect.fail(new Error('The rows are out of reach'));
      }),
  };
}

function wakeUpWith(dueWork: DueWork, clock: SteppedClock): (now: number) => Promise<NextWake> {
  const work = hostWakeUp(
    {
      clock,
      timers: noTimers,
      dueWork: [dueWork],
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

describe('the due rows of a projection, in the loop of the host', () => {
  it('are performed before the timers of the same wake-up, at most 256 a wake-up and 16 at once, the rest at once after', async () => {
    const now = Date.now();
    const rows = rowsDueBy(300, now - 1000, { callsOut: false });
    rows.hold();
    const looping = await dueLooping(rows, steppedClock(now));

    await looping.armTimer(now - 1000);
    rows.release();
    await rows.when(rows.performed, (performed) => performed.length === 300);

    expect(looping.order()).toEqual([`timer 1 after ${dueInOneWakeUp} rows`]);
    expect([rows.mostAtOnce(), new Set(rows.performed().map(({ at }) => at)).size]).toEqual([duePerformedAtOnce, 1]);
  });

  it('that call out are handed out as many a wake-up as are performed at once, the rest as places free, holding no timer', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    for (const key of keysOf(40, 'row')) {
      rows.add(key, now - 1000);
    }
    rows.hold();
    const looping = await dueLooping(rows, steppedClock(now));

    await looping.armTimer(now - 1000);
    const firedWhileHeld = [...(await rows.when(looping.order, (order) => order.length === 1))];
    const handedWhileHeld = (await rows.when(rows.attempts, (made) => made.length === duePerformedAtOnce)).length;
    rows.release();
    await rows.when(rows.performed, (performed) => performed.length === 40);

    expect([firedWhileHeld, handedWhileHeld]).toEqual([['timer 1 after 0 rows'], duePerformedAtOnce]);
    expect([rows.attempts().length, rows.mostAtOnce()]).toEqual([40, duePerformedAtOnce]);
  });

  it('wake the loop when the next of them is due', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    rows.add('later', now + 90_000);
    const clock = steppedClock(now);

    await dueLooping(rows, clock);
    clock.step(90_000);
    const [performed] = await rows.when(rows.performed, (done) => done.length > 0);

    expect(performed).toEqual({ key: 'later', at: now + 90_000, by: 'host' });
  });
});

describe('due rows whose perform never ends, as a delivery through a tool that never answers', () => {
  it('hold no timer, of the wake-up that hands them out or of the wake-ups after, 16 of them at once', async () => {
    const now = Date.now();
    const clock = steppedClock(now);
    const rows = fakeDueWork();
    for (const key of Array.from({ length: 20 }, (_, index) => `hanging-${index}`)) {
      rows.add(key, now - 1000);
      rows.hanging(key);
    }
    const looping = await dueLooping(rows, clock);

    await looping.armTimer(now - 1000);
    await rows.when(looping.order, (order) => order.length === 1);
    await looping.armTimer(now + 300, '2');
    clock.step(300);
    await rows.when(looping.order, (order) => order.length === 2);

    expect(looping.order()).toEqual(['timer 1 after 0 rows', 'timer 2 after 0 rows']);
    expect(looping.firedAt()).toEqual([now, now + 300]);
    expect([rows.attempts().length, rows.mostAtOnce()]).toEqual([duePerformedAtOnce, duePerformedAtOnce]);
  });
});

describe('a due row that calls out nowhere and whose perform never ends', () => {
  it('holds the timers of the wake-up that hands it out a second at most, and those of the wake-ups after not at all', async () => {
    const now = Date.now();
    const clock = steppedClock(now);
    const rows = fakeDueWork();
    rows.add('expiry', now - 1000);
    rows.local('expiry');
    rows.hanging('expiry');
    const looping = await dueLooping(rows, clock);

    await rows.when(rows.attempts, (made) => made.length === 1);
    await looping.armTimer(now - 1000);
    const beforeTheSecond = [...looping.order()];
    clock.step(dueAwaitedMs);
    await rows.when(looping.order, (order) => order.length === 1);
    await looping.armTimer(now + dueAwaitedMs + 300, '2');
    clock.step(300);
    await rows.when(looping.order, (order) => order.length === 2);

    expect(beforeTheSecond).toEqual([]);
    expect(looping.firedAt()).toEqual([now + dueAwaitedMs, now + dueAwaitedMs + 300]);
    expect(rows.attempts()).toHaveLength(1);
  });
});

describe('due rows in flight', () => {
  it.each([16, 20, 300])(
    'are read once a sweep for each lane while %i of them hang, however their work reports its next due time',
    async (count) => {
      const now = Date.now();
      const rows = fakeDueWork(0, { reportsRowsInFlight: true });
      for (const key of Array.from({ length: count }, (_, index) => `hanging-${index}`)) {
        rows.add(key, now - 1000);
        rows.hanging(key);
      }

      const clock = steppedClock(now);
      await dueLooping(rows, clock, 1000);
      await rows.when(rows.attempts, (made) => made.length === duePerformedAtOnce);
      await aSecondLater(clock, rows, 1);
      await aSecondLater(clock, rows, 2);
      await aSecondLater(clock, rows, 3);

      expect(rows.reads().due).toBeLessThanOrEqual(10);
      expect(rows.attempts()).toHaveLength(duePerformedAtOnce);
    },
  );

  it('wake the loop when one of them ends, to hand out the rows behind it', async () => {
    const now = Date.now();
    const rows = fakeDueWork(50);
    for (const key of Array.from({ length: dueInOneWakeUp + 20 }, (_, index) => `row-${index}`)) {
      rows.add(key, now - 1000);
    }

    await dueLooping(rows);
    const performed = await rows.when(rows.performed, (done) => done.length === dueInOneWakeUp + 20);

    expect(performed).toHaveLength(dueInOneWakeUp + 20);
  });
});

describe('a due row that calls out nowhere, while deliveries hang', () => {
  it('is performed at once, beside the 16 that hang, not behind them', async () => {
    const now = Date.now();
    const clock = steppedClock(now);
    const rows = fakeDueWork();
    for (const key of Array.from({ length: 20 }, (_, index) => `delivery-${index}`)) {
      rows.add(key, now - 1000);
      rows.hanging(key);
    }
    rows.add('expiry', now - 1000);
    rows.local('expiry');

    await dueLooping(rows, clock);
    const [performed] = await rows.when(rows.performed, (done) => done.length > 0);

    expect(performed).toEqual({ key: 'expiry', at: now, by: 'host' });
    expect(rows.mostAtOnce()).toBe(duePerformedAtOnce + 1);
  });
});

describe('a due row that cannot be performed', () => {
  it('is tried again after a wait that doubles, without holding the rows due after it', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    rows.add('stuck', now);
    rows.failing('stuck');
    rows.add('next', now + 1500);
    rows.local('stuck');
    rows.local('next');

    const clock = steppedClock(now);
    const looping = await dueLooping(rows, clock);
    await rows.when(rows.attempts, (made) => made.length === 1);
    const steppedUntilTried = async (gapMs: number, made: number) => {
      clock.step(gapMs);
      await rows.when(rows.attempts, (attempted) => attempted.length === made);
    };
    await steppedUntilTried(1000, 2);
    await steppedUntilTried(500, 3);
    await steppedUntilTried(1500, 4);
    await steppedUntilTried(4000, 5);
    await steppedUntilTried(8000, 6);
    const attempts = rows.attempts();

    expect(attempts.slice(0, 6).map(({ key, at }) => [key, at - now])).toEqual([
      ['stuck', 0],
      ['stuck', 1000],
      ['next', 1500],
      ['stuck', 3000],
      ['stuck', 7000],
      ['stuck', 15_000],
    ]);
    expect(new Set(looping.troubles())).toEqual(
      new Set(['A due row of the fake rows could not be performed; the loop tries it again after a wait']),
    );
  });
});

describe('due rows that cannot be read', () => {
  it('are reported, and performed once the reads come back', async () => {
    const rows = rowsDueBy(1, Date.now(), { callsOut: true });
    rows.failReads(2);

    const looping = await dueLooping(rows, systemClock, 20);
    const performed = await rows.when(rows.performed, (done) => done.length > 0);

    expect([performed.length, new Set(looping.troubles())]).toEqual([
      1,
      new Set([
        'The due rows of the fake rows could not be read; the loop tries again',
        'The next due time of the fake rows could not be read; the loop reads it again at its next wake, at the latest a minute later, twice as long after each wake in a row that failed since the host started, at most an hour',
      ]),
    ]);
  });

  it('whose next due time could not be read are answered a retry a minute after the read when nothing else is due, so a host woken only at the times it answers performs the next at its time', async () => {
    const now = Date.now();
    const clock = steppedClock(now);
    const rows = fakeDueWork();
    rows.add('later', now + fiveMinutes);
    rows.local('later');
    const wakeUp = wakeUpWith(nextDueFailingFirst(rows.work('host'), 1), clock);

    const first = await wakeUp(now);
    clock.step(60_000);
    const second = await wakeUp(now + 60_000);
    clock.step(fiveMinutes - 60_000);
    const third = await wakeUp(now + fiveMinutes);

    expect([first, second, third]).toEqual([now + 60_000, now + fiveMinutes, null].map((nextDueAt) => ({ nextDueAt })));
    expect(rows.performed()).toEqual([{ key: 'later', at: now + fiveMinutes, by: 'host' }]);
  });

  it('keep the wait of a row that could not be performed, though the next due time of its work could not be read', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    rows.add('stuck', now);
    rows.local('stuck');
    rows.failing('stuck');
    const wakeUp = wakeUpWith(nextDueFailingFirst(rows.work('host'), 1), steppedClock(now));

    await expect(wakeUp(now)).resolves.toEqual({ nextDueAt: now + rowWaitBounds.firstMs });
  });

  it('due already, which could not be read though their next due time was, are answered a retry a minute after the read, so a host woken only at the times it answers performs them then', async () => {
    const now = Date.now();
    const clock = steppedClock(now);
    const rows = rowsDueBy(1, now - 1000, { callsOut: false });
    rows.failReads(1);
    const wakeUp = wakeUpWith(rows.work('host'), clock);

    const failed = await wakeUp(now);
    clock.step(60_000);
    const read = await wakeUp(now + 60_000);

    expect([failed, read]).toEqual([now + 60_000, null].map((nextDueAt) => ({ nextDueAt })));
    expect(rows.performed()).toEqual([{ key: 'row-0', at: now + 60_000, by: 'host' }]);
  });

  it('that a lane had room for at the wake before are answered a retry, not at once, so the host is not woken again and again while the read fails', async () => {
    const now = Date.now();
    const clock = steppedClock(now);
    const rows = rowsDueBy(dueInOneWakeUp + 44, now - 1000, { callsOut: false });
    const wakeUp = wakeUpWith(rows.work('host'), clock);

    const behind = await wakeUp(now);
    rows.failReads(1);
    const failed = await wakeUp(now);
    clock.step(60_000);
    const read = await wakeUp(now + 60_000);

    expect([behind, failed, read]).toEqual([now, now + 60_000, null].map((nextDueAt) => ({ nextDueAt })));
    expect(rows.performed()).toHaveLength(dueInOneWakeUp + 44);
  });
});

describe('a chore the wake-up of the host performs', () => {
  it('is performed at the first wake-up, wakes nothing while it is under way, then waits for the time it answered', async () => {
    const performedAt: number[] = [];
    const signalled = signals();
    const held = Promise.withResolvers<void>();
    const clock = steppedClock(5000);
    const chore: Chore = {
      name: 'orphans',
      perform: (now) =>
        Effect.andThen(
          Effect.promise(() => held.promise),
          Effect.sync(() => {
            performedAt.push(now);
            signalled.changed();
            return now + 1000;
          }),
        ),
    };
    const wakeUp = wakeUpWith(choreWork(chore), clock);

    const underWay = await wakeUp(5000);
    held.resolve();
    await signalled.when(
      () => performedAt.length,
      (performed) => performed > 0,
    );
    clock.step(500);
    const between = await wakeUp(5500);
    clock.step(500);
    await wakeUp(6000);
    await signalled.when(
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

describe('the due rows of a projection, across hosts of one database', () => {
  it('are performed by the host that holds the lease alone, and by the next once it stops', async () => {
    const database = { store: 'sqlite', file: aSQLiteFile() } as const;
    const rows = fakeDueWork();
    const first = await hostedOn(database, { sweepEveryMs: 50, holder: 'first', dueWork: [rows.work('first')] });
    await hostedOn(database, { sweepEveryMs: 50, holder: 'second', dueWork: [rows.work('second')] });

    rows.add('before', Date.now());
    await rows.when(rows.performed, (performed) => performed.length === 1);
    await first.host.stop();
    rows.add('after', Date.now());
    await rows.when(rows.performed, (performed) => performed.length === 2);

    expect(rows.performed().map(({ key, by }) => [key, by])).toEqual([
      ['before', 'first'],
      ['after', 'second'],
    ]);
    expect(rows.attempts()).toHaveLength(2);
  });
});

describe('the waits of rows that could not be performed', () => {
  it('hold a row for a second, then twice as long each time, up to five minutes, and let it go once performed', () => {
    const waits = rowWaits();
    const untils: number[] = [];
    for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((step) => step * 1_000_000)) {
      waits.failed('row', at);
      untils.push(waits.nextUntil(at) - at);
    }

    expect(untils).toEqual([1000, 2000, 4000, 8000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000, 300_000]);
    expect([waits.holds('row', 10_000_000), waits.heldAt(10_000_000)]).toEqual([true, 1]);
    waits.performed('row');
    expect([waits.holds('row', 10_000_000), waits.heldAt(10_000_000), waits.nextUntil(0)]).toEqual([
      false,
      0,
      Number.POSITIVE_INFINITY,
    ]);
  });

  it('keep at most 4,096 rows, letting the one that failed first go', () => {
    const waits = rowWaits();
    for (const index of Array.from({ length: rowWaitBounds.keptRows + 1 }, (_, each) => each)) {
      waits.failed(`row-${index}`, 0);
    }

    expect([waits.heldAt(0), waits.holds('row-0', 0), waits.holds('row-1', 0)]).toEqual([
      rowWaitBounds.keptRows,
      false,
      true,
    ]);
  });
});
