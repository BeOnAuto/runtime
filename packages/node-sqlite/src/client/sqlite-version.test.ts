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

  it('is refused in plain words that name both versions', () => {
    expect(sqliteVersionRefusal('3.40.1', '3.43.0').message).toBe(
      'This Node.js carries SQLite 3.40.1, and SQLite 3.43.0 or later is needed. Use a Node.js that carries SQLite 3.43.0 or later.',
    );
  });
});
