import { describe, expect, it } from 'vitest';

import { lineOf, mostLineCharacters } from './activity-facts.ts';

describe('the one line a row keeps of a text', () => {
  it('is its first line, trimmed', () => {
    expect(lineOf('  Approve this?  \r\nThe invoice is attached.')).toBe('Approve this?');
  });

  it(`is cut at ${mostLineCharacters} characters with an ellipsis, counting each character once`, () => {
    const line = lineOf('🧾'.repeat(mostLineCharacters + 1));

    expect(Array.from(line)).toHaveLength(mostLineCharacters);
    expect(line.endsWith('🧾…')).toBe(true);
    expect(lineOf('a'.repeat(mostLineCharacters))).toBe('a'.repeat(mostLineCharacters));
  });
});
