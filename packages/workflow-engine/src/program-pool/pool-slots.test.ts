import { describe, expect, it } from 'vitest';

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
    expect(performance.now() - started).toBeGreaterThanOrEqual(15);
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
