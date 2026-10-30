import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { shapeNamed } from '../testing/index.ts';

const { check } = shapeNamed('table');

function columnsOf(count: number): readonly Schema.Json[] {
  return Array.from({ length: count }, (_, index) => ({ name: `Column ${index}` }));
}

function tableOf(columns: number, rows: number): Schema.Json {
  return {
    columns: columnsOf(columns),
    rows: Array.from({ length: rows }, () => Array.from({ length: columns }, (_, index) => index)),
  };
}

describe('a table', () => {
  it('takes 1 to 50 columns and at most 500 rows', () => {
    expect([check(tableOf(1, 0)), check(tableOf(50, 500))]).toEqual([[], []]);
    expect([check(tableOf(0, 0)), check(tableOf(51, 0)), check(tableOf(1, 501))]).toEqual([
      [{ pointer: '/columns', detail: 'Expected a value with a length of at least 1' }],
      [{ pointer: '/columns', detail: 'Expected a value with a length of at most 50' }],
      [{ pointer: '/rows', detail: 'Expected a value with a length of at most 500' }],
    ]);
  });

  it('names each column, with a unit where given, each of 1 to 64 characters, and a name no column before it has', () => {
    expect(check({ columns: [{ name: 'Count', unit: 'pieces' }], rows: [] })).toEqual([]);
    expect(check({ columns: [{ name: 'Count', unit: '' }, { name: 'x'.repeat(65) }], rows: [] })).toEqual([
      { pointer: '/columns/0/unit', detail: 'Expected a value with a length of at least 1' },
      { pointer: '/columns/1/name', detail: 'Expected a string with at most 64 code points' },
    ]);
    expect(check({ columns: [{ name: 'A' }, { name: 'B' }, { name: 'A' }], rows: [] })).toEqual([
      { pointer: '/columns/2/name', detail: 'Expected a name no column before it has' },
    ]);
  });

  it('holds in each row one cell for each column, each text, a number, yes or no, or nothing', () => {
    expect(check({ columns: columnsOf(4), rows: [['a', 1, true, null]] })).toEqual([]);
    expect(check({ columns: columnsOf(2), rows: [['a'], ['a', 1], ['a', 1, 2]] })).toEqual([
      { pointer: '/rows/0', detail: 'Expected 2 cells, one for each column' },
      { pointer: '/rows/2', detail: 'Expected 2 cells, one for each column' },
    ]);
    expect(check({ columns: columnsOf(1), rows: [[]] })).toEqual([
      { pointer: '/rows/0', detail: 'Expected 1 cell, for its one column' },
    ]);
    expect(check({ columns: columnsOf(1), rows: [[{ a: 1 }]] })).toEqual([
      { pointer: '/rows/0/0', detail: 'Expected string | number | boolean | null' },
    ]);
  });

  it('is not read for the width of its rows without its columns, nor for a row that is no list', () => {
    expect(check({ columns: [], rows: [[1]] })).toEqual([
      { pointer: '/columns', detail: 'Expected a value with a length of at least 1' },
    ]);
    expect(check({ columns: columnsOf(1), rows: ['a'] })).toEqual([{ pointer: '/rows/0', detail: 'Expected array' }]);
  });
});
