import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { systemClock } from '../loop/host-clock.ts';
import { until } from '../testing/until.ts';
import { steppedClock } from '../views-testing/stepped-sweeps.ts';
import { dueLooping, keysOf } from './due-looping.ts';
import { dueAwaitedMs, dueInOneWakeUp, duePerformedAtOnce } from './due-work.ts';
import { fakeDueWork, type FakeDueWork } from './fake-due-work.ts';

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

describe('the due rows of a projection, in the loop of the host', () => {
  it('are performed before the timers of the same wake-up, at most 256 a wake-up and 16 at once, the rest at once after', async () => {
    const now = Date.now();
    const rows = rowsDueBy(300, now - 1000, { callsOut: false });
    rows.hold();
    const looping = await dueLooping(rows, steppedClock(now));

    await looping.armTimer(now - 1000);
    rows.release();
    await until(rows.performed, (performed) => performed.length === 300);

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
    const firedWhileHeld = [...(await until(looping.order, (order) => order.length === 1))];
    const handedWhileHeld = (await until(rows.attempts, (made) => made.length === duePerformedAtOnce)).length;
    rows.release();
    await until(rows.performed, (performed) => performed.length === 40);

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
    const [performed] = await until(rows.performed, (done) => done.length > 0);

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
    await until(looping.order, (order) => order.length === 1);
    await looping.armTimer(now + 300, '2');
    clock.step(300);
    await until(looping.order, (order) => order.length === 2);

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

    await until(rows.attempts, (made) => made.length === 1);
    await looping.armTimer(now - 1000);
    const beforeTheSecond = [...looping.order()];
    clock.step(dueAwaitedMs);
    await until(looping.order, (order) => order.length === 1);
    await looping.armTimer(now + dueAwaitedMs + 300, '2');
    clock.step(300);
    await until(looping.order, (order) => order.length === 2);

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

      await dueLooping(rows, systemClock, 1000);
      await Effect.runPromise(Effect.sleep(3000));

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
    const performed = await until(rows.performed, (done) => done.length === dueInOneWakeUp + 20);

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
    const [performed] = await until(rows.performed, (done) => done.length > 0);

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
    await until(rows.attempts, (made) => made.length === 1);
    const steppedUntilTried = async (gapMs: number, made: number) => {
      clock.step(gapMs);
      await until(rows.attempts, (attempted) => attempted.length === made);
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
    const performed = await until(rows.performed, (done) => done.length > 0);

    expect([performed.length, new Set(looping.troubles())]).toEqual([
      1,
      new Set([
        'The due rows of the fake rows could not be read; the loop tries again',
        'The next due time of the fake rows could not be read; the loop waits for the next sweep',
      ]),
    ]);
  });
});
