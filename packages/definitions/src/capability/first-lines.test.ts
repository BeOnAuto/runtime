import { describe, expect, it } from 'vitest';

import { firstLineOf } from './first-lines.ts';

describe('the words of a failure an extension throws', () => {
  it('are the first line of its message, or of what else was thrown, trimmed', () => {
    expect([
      firstLineOf(new Error('  first  \nsecond')),
      firstLineOf('plain\nrest'),
      firstLineOf(new Error('')),
    ]).toEqual(['first', 'plain', '']);
  });
});
