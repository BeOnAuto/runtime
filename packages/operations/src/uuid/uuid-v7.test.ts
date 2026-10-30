import { describe, expect, it } from 'vitest';

import { randomUUIDv7, uuidV7Before, uuidV7MakerOn, uuidV7TimeOf } from './uuid-v7.ts';

const uuidV7 = /^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

const at = 1_791_778_446_256;

const highestCounter = 0xfff;

const highestSeed = 0x7ff;

function millisecondsOf(id: string): number {
  return Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
}

function counterOf(id: string): number {
  return Number.parseInt(id.slice(15, 18), 16);
}

function madeOn(clock: { readonly at: number }, count: number): readonly string[] {
  const made = uuidV7MakerOn(() => clock.at);
  return Array.from({ length: count }, () => made());
}

function outOfOrder(ids: readonly string[]): readonly string[] {
  return ids.filter((id, index) => index > 0 && (ids[index - 1] ?? '') >= id);
}

describe('a UUID version 7 under the real clock', () => {
  it('is a version 7, RFC 9562 variant UUID in lowercase hex', () => {
    expect(randomUUIDv7()).toMatch(uuidV7);
  });

  it('starts with the Unix time in milliseconds it was made at', () => {
    const before = Date.now();
    const id = randomUUIDv7();
    const after = Date.now();

    expect(millisecondsOf(id)).toBeGreaterThanOrEqual(before);
    expect(millisecondsOf(id)).toBeLessThanOrEqual(after);
  });

  it('sorts after the one made before it', () => {
    const ids = Array.from({ length: 1000 }, () => randomUUIDv7());

    expect(outOfOrder(ids)).toEqual([]);
  });

  it('tells the time it carries, as the 12 hex digits it starts with, and whether it was made before a time', () => {
    const id = randomUUIDv7();

    expect(uuidV7TimeOf(at)).toBe('01a12e515bb0');
    expect(uuidV7TimeOf(1)).toBe('000000000001');
    expect([uuidV7Before(id, Date.now() + 1), uuidV7Before(id, millisecondsOf(id))]).toEqual([true, false]);
    expect([
      uuidV7Before('01a12e51-5bb0-7000-8000-000000000001', at),
      uuidV7Before('01a12e51-5baf-7000-8000-000000000001', at),
    ]).toEqual([false, true]);
  });
});

describe('a UUID version 7 made on a clock of its own', () => {
  it('sorts after the one made before it, ten thousand times over, under a clock that does not move', () => {
    const ids = madeOn({ at }, 10_000);
    const [first = ''] = ids;

    expect(outOfOrder(ids)).toEqual([]);
    expect(millisecondsOf(first)).toBe(at);
  });

  it('made first in a new millisecond sorts after every id of the millisecond before', () => {
    const clock = { at };
    const made = uuidV7MakerOn(() => clock.at);
    const before = Array.from({ length: 2000 }, () => made());
    clock.at += 1;
    const first = made();

    expect(before.filter((id) => id >= first)).toEqual([]);
    expect(millisecondsOf(first)).toBe(at + 1);
  });

  it('made past a counter at its ceiling takes the next millisecond and a counter seeded again in its lower half', () => {
    const ids = madeOn({ at }, highestCounter + 2);
    const atTheCeiling = ids.findIndex((id) => counterOf(id) === highestCounter);
    const [last = '', next = ''] = ids.slice(atTheCeiling, atTheCeiling + 2);

    expect(atTheCeiling).toBeGreaterThanOrEqual(highestCounter - highestSeed);
    expect(new Set(ids.slice(0, atTheCeiling + 1).map((id) => millisecondsOf(id)))).toEqual(new Set([at]));
    expect([millisecondsOf(last), millisecondsOf(next)]).toEqual([at, at + 1]);
    expect(counterOf(next)).toBeLessThanOrEqual(highestSeed);
    expect(next > last).toBe(true);
  });

  it('sorts after the last id under a clock that goes back, carrying the millisecond of the last id', () => {
    const clock = { at };
    const made = uuidV7MakerOn(() => clock.at);
    const last = made();
    clock.at -= 60_000;
    const after = Array.from({ length: 3 }, () => made());

    expect(outOfOrder([last, ...after])).toEqual([]);
    expect(after.map((id) => millisecondsOf(id))).toEqual([at, at, at]);
  });

  it('keeps the version and the variant of RFC 9562 past every ceiling of its counter', () => {
    expect(madeOn({ at }, 10_000).filter((id) => !uuidV7.test(id))).toEqual([]);
  });
});
