import { describe, expect, it } from 'vitest';

import { isAtLeast, sqliteVersionRefusal } from './sqlite-version.ts';

describe('a version of SQLite', () => {
  it.each([
    ['3.54.0', '3.43', true],
    ['3.43', '3.43.0', true],
    ['3.43.0', '3.43.0', true],
    ['3.43.1', '3.43.2', false],
    ['3.42.9', '3.43', false],
    ['4.0.0', '3.43.0', true],
    ['3.9.0', '3.43.0', false],
  ])('%s is at least %s: %s', (found, minimum, atLeast) => {
    expect(isAtLeast(found, minimum)).toBe(atLeast);
  });

  it('is refused naming both versions', () => {
    const { message } = sqliteVersionRefusal('3.40.1', '3.43.0');

    expect([message.includes('3.40.1'), message.includes('3.43.0')]).toEqual([true, true]);
  });
});
