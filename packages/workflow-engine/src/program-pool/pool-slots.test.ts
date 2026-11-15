import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { poolSlots } from './pool-slots.ts';

function inMs(milliseconds: number): number {
  return performance.now() + milliseconds;
}

describe('the slots of a pool', () => {
  it('admit as many runs at once as the pool has slots, and the next waiting run as one ends, in turn', async () => {
    const slots = poolSlots(1);
    const order: string[] = [];

    expect(await slots.admit(inMs(1000))).toBe('admitted');
    const second = slots.admit(inMs(1000)).then((admission) => order.push(`second ${admission}`));
    const third = slots.admit(inMs(1000)).then((admission) => order.push(`third ${admission}`));
    slots.release();
    await second;
    slots.release();
    await third;
    slots.release();

    expect(order).toEqual(['second admitted', 'third admitted']);
    expect(await slots.admit(inMs(1000))).toBe('admitted');
  });

  it('turn away a run that finds no free slot before its deadline', async () => {
    const slots = poolSlots(1);
    await slots.admit(inMs(1000));
    const started = performance.now();

    expect(await slots.admit(inMs(20))).toBe('busy');
    expect(performance.now() - started).toBeGreaterThanOrEqual(20);
  });

  it('turn away a run no sooner than its deadline, though its timer fires before it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const clock = { now: 1000 };
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
    onTestFinished(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });
    const slots = poolSlots(1);
    await slots.admit(2000);
    const settled: string[] = [];
    const turnedAway = slots.admit(1050).then((admission) => settled.push(admission));

    await vi.advanceTimersByTimeAsync(50);
    const whileEarly = [...settled];
    clock.now = 1050;
    await vi.advanceTimersByTimeAsync(50);
    await turnedAway;

    expect([whileEarly, settled]).toEqual([[], ['busy']]);
  });
});

describe('a run waiting for a slot', () => {
  it('goes when it is cancelled, and leaves its turn to the next', async () => {
    const slots = poolSlots(1);
    await slots.admit(inMs(1000));
    const cancelling = new AbortController();
    const cancelled = slots.admit(inMs(1000), cancelling.signal);
    const next = slots.admit(inMs(1000));

    cancelling.abort();
    slots.release();

    expect(await cancelled).toBe('cancelled');
    expect(await next).toBe('admitted');
  });

  it('ignores a cancellation that comes after it was admitted', async () => {
    const slots = poolSlots(1);
    await slots.admit(inMs(1000));
    const cancelling = new AbortController();
    const admitted = slots.admit(inMs(1000), cancelling.signal);
    slots.release();

    expect(await admitted).toBe('admitted');
    cancelling.abort();
    expect(await admitted).toBe('admitted');
  });

  it('ends when the pool closes, and the pool admits no more', async () => {
    const slots = poolSlots(1);
    await slots.admit(inMs(1000));
    const waiting = slots.admit(inMs(1000));

    slots.close();

    expect(await waiting).toBe('closing');
    expect(await slots.admit(inMs(1000))).toBe('closing');
  });
});
