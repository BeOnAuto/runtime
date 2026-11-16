import { DatabaseSync } from 'node:sqlite';

import { DataError, DumboError } from '@event-driven-io/dumbo';
import { describe, expect, it } from 'vitest';

import { boundValueOf } from './binding.ts';

const asTheAddOnStoresThem: readonly (readonly [string, unknown, string])[] = [
  ['one', 1, 'integer'],
  ['zero', 0, 'integer'],
  ['a negative whole number', -7, 'integer'],
  ['negative zero', -0, 'integer'],
  ['the largest whole number within 32 bits', 2 ** 31 - 1, 'integer'],
  ['the smallest whole number within 32 bits', -(2 ** 31), 'integer'],
  ['the first whole number beyond 32 bits', 2 ** 31, 'real'],
  ['the first negative whole number beyond 32 bits', -(2 ** 31) - 1, 'real'],
  ['a time in milliseconds', 1_700_000_000_000, 'real'],
  ['the largest safe whole number', Number.MAX_SAFE_INTEGER, 'real'],
  ['a fraction', 1.5, 'real'],
  ['a number written with an exponent', 1e17, 'real'],
  ['infinity', Infinity, 'real'],
  ['not a number', Number.NaN, 'null'],
  ['true', true, 'integer'],
  ['false', false, 'integer'],
  ['null', null, 'null'],
  ['undefined', undefined, 'null'],
  ['a string', 'x', 'text'],
  ['a Buffer', Buffer.from('ab'), 'blob'],
  ['bytes', new Uint8Array([1, 2]), 'blob'],
];

function storedTypeOf(value: unknown): unknown {
  const database = new DatabaseSync(':memory:');
  try {
    return database.prepare('SELECT typeof(?) AS type').get(boundValueOf(value))?.['type'];
  } finally {
    database.close();
  }
}

describe('a value bound to a statement', () => {
  it.each(asTheAddOnStoresThem)('stores %s as SQLite stored it through the sqlite3 add-on', (_named, value, type) => {
    expect(storedTypeOf(value)).toBe(type);
  });

  it('stores a whole number within 32 bits in a TEXT column as the add-on did, without a decimal point', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('CREATE TABLE notes (note TEXT)');
    database.prepare('INSERT INTO notes (note) VALUES (?)').run(boundValueOf(5));

    expect(database.prepare("SELECT count(*) AS found FROM notes WHERE note = '5'").get()).toEqual({ found: 1 });
    database.close();
  });

  it('binds true and false as the integers 1 and 0', () => {
    expect([boundValueOf(true), boundValueOf(false)]).toEqual([1n, 0n]);
  });

  it('binds a BigInt as an integer', () => {
    expect([boundValueOf(5n), storedTypeOf(5n)]).toEqual([5n, 'integer']);
  });

  it.each([
    ['an object', {}, 'object'],
    ['a date', new Date(0), 'object'],
    ['a function', () => 1, 'function'],
    ['a symbol', Symbol('kept'), 'symbol'],
  ])('refuses %s, naming its type', (_named, value, type) => {
    const refusal = (() => {
      try {
        return boundValueOf(value);
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(refusal).toBeInstanceOf(DataError);
    expect(DumboError.isInstanceOf(refusal)).toBe(true);
    expect(refusal).toMatchObject({ message: `Unsupported node:sqlite binding type: ${type}` });
  });
});
