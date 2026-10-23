import { describe, expect, it } from 'vitest';

import { until } from '../testing/until.ts';
import { steppedClock } from '../views-testing/stepped-sweeps.ts';
import { dueLooping, keysOf } from './due-looping.ts';
import { dueAwaitedMs, dueInOneWakeUp, duePerformedAtOnce } from './due-work.ts';
import { fakeDueWork } from './fake-due-work.ts';

describe('a due row that calls out nowhere, behind more deliveries than one read of them takes', () => {
  it('is performed, read apart from the deliveries due before it, and not at the next sweep', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    for (const key of keysOf(2 * dueInOneWakeUp + 300, 'delivery')) {
      rows.add(key, now - 2000);
      rows.hanging(key);
    }
    rows.add('expiry', now - 1000);
    rows.local('expiry');

    await dueLooping(rows);
    const [performed] = await until(rows.performed, (done) => done.length > 0);

    expect(performed?.key).toBe('expiry');
  });
});

describe('a delivery that waits for a place while deliveries hang', () => {
  it('is not held, so it ends when its ending comes due, and not at the next sweep', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    for (const key of keysOf(duePerformedAtOnce + 4, 'delivery')) {
      rows.add(key, now - 1000);
    }
    for (const key of keysOf(duePerformedAtOnce, 'delivery')) {
      rows.hanging(key);
    }
    const endsAt = now + dueAwaitedMs + 500;
    rows.endsAt('delivery-19', endsAt);

    await dueLooping(rows);
    const [performed] = await until(rows.performed, (done) => done.length > 0);

    expect(performed?.key).toBe('delivery-19');
    expect(rows.attempts().filter(({ key }) => key !== 'delivery-19')).toHaveLength(duePerformedAtOnce);
  });
});

describe('a due row whose ending falls due while a wake-up waits for the rows it handed out', () => {
  it('is performed by the next wake-up, not at the next sweep', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    for (const key of keysOf(duePerformedAtOnce + 4, 'delivery')) {
      rows.add(key, now - 1000);
    }
    for (const key of keysOf(duePerformedAtOnce, 'delivery')) {
      rows.hanging(key);
    }
    const endsAt = now + 300;
    rows.endsAt('delivery-19', endsAt);

    await dueLooping(rows);
    const [performed] = await until(rows.performed, (done) => done.length > 0);

    expect(performed?.key).toBe('delivery-19');
  });
});

describe('due rows that end while the loop reads when to wake next', () => {
  it('wake it, so the rows behind them are handed out then and not at the next sweep', async () => {
    const now = Date.now();
    const rows = fakeDueWork(dueAwaitedMs + 500, { nextReadMs: 1000 });
    for (const key of keysOf(duePerformedAtOnce + 1, 'delivery')) {
      rows.add(key, now - 1000);
    }

    await dueLooping(rows);
    const performed = await until(rows.performed, (done) => done.length === duePerformedAtOnce + 1);

    expect(performed).toHaveLength(duePerformedAtOnce + 1);
  });
});

describe('a host that stops while due rows are in flight', () => {
  it('interrupts them in both lanes', async () => {
    const rows = fakeDueWork();
    for (const key of ['delivery', 'expiry']) {
      rows.add(key, Date.now() - 1000);
      rows.hanging(key);
    }
    rows.local('expiry');
    const looping = await dueLooping(rows);
    await until(rows.attempts, (made) => made.length === 2);

    await looping.stop();

    expect(new Set(rows.interrupted())).toEqual(new Set(['delivery', 'expiry']));
  });
});

describe('a delivery handed out while workflow timers fall due', () => {
  it('holds none of them, as the wake-up waits for the rows that call out nowhere alone', async () => {
    const now = Date.now();
    const clock = steppedClock(now);
    const rows = fakeDueWork();
    for (const key of keysOf(duePerformedAtOnce - 1, 'delivery')) {
      rows.add(key, now - 1000);
    }
    rows.add('handed-as-the-timer-falls-due', now + 500);
    rows.hold();
    const looping = await dueLooping(rows, clock);

    await looping.armTimer(now + 500);
    clock.step(500);
    await until(looping.order, (order) => order.length === 1);
    const handed = await until(rows.attempts, (made) => made.length === duePerformedAtOnce);
    rows.release();

    expect(looping.firedAt()).toEqual([now + 500]);
    expect(handed.at(-1)).toEqual({ key: 'handed-as-the-timer-falls-due', at: now + 500, by: 'host' });
  });
});
