import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { shapeNamed } from '../testing/index.ts';

const { check } = shapeNamed('categories');

function valuesOf(count: number): Schema.Json {
  return { values: Array.from({ length: count }, (_, index) => ({ name: `Category ${index}`, value: index })) };
}

describe('categories', () => {
  it('take 1 to 200 values, in a unit of 1 to 64 characters where given', () => {
    expect([
      check(valuesOf(1)),
      check(valuesOf(200)),
      check({ unit: 'x'.repeat(64), values: [{ name: 'A', value: 0 }] }),
    ]).toEqual([[], [], []]);
    expect([check(valuesOf(0)), check(valuesOf(201)), check({ unit: 'x'.repeat(65), values: [] })]).toEqual([
      [{ pointer: '/values', detail: 'Expected a value with a length of at least 1' }],
      [{ pointer: '/values', detail: 'Expected a value with a length of at most 200' }],
      [
        { pointer: '/unit', detail: 'Expected a string with at most 64 code points' },
        { pointer: '/values', detail: 'Expected a value with a length of at least 1' },
      ],
    ]);
  });

  it('name each value, with a name no value before it has', () => {
    expect(
      check({
        values: [
          { name: 'North', value: 1 },
          { name: 'South', value: 2 },
          { name: 'North', value: 3 },
        ],
      }),
    ).toEqual([{ pointer: '/values/2/name', detail: 'Expected a name no value before it has' }]);
    expect(check({ values: [{ name: '', value: 1 }, { value: 2 }] })).toEqual([
      { pointer: '/values/0/name', detail: 'Expected a value with a length of at least 1' },
      { pointer: '/values/1/name', detail: 'Missing key' },
    ]);
  });
});

describe('the values of categories', () => {
  it('lie each between its low and its high, where it has them', () => {
    expect(check({ values: [{ name: 'A', value: 5, low: 4, high: 6 }] })).toEqual([]);
    expect(
      check({
        values: [
          { name: 'A', value: 5, high: 4 },
          { name: 'B', value: 5, low: 6 },
        ],
      }),
    ).toEqual([
      { pointer: '/values/0/high', detail: 'Expected a high of at least the value' },
      { pointer: '/values/1/low', detail: 'Expected a low of at most the value' },
    ]);
  });

  it('take nothing their shape does not describe', () => {
    expect(check({ values: [{ name: 'A', value: 1, share: 0.5 }], total: 1 })).toEqual([
      { pointer: '/total', detail: 'Expected no excess property' },
      { pointer: '/values/0/share', detail: 'Expected no excess property' },
    ]);
  });
});
