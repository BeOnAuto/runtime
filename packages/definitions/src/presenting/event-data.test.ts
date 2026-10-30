import { describe, expect, it } from 'vitest';

import { cutAtCodePoint, issuesShown } from './event-data.ts';

describe('a text cut at a code point', () => {
  it('keeps a text that fits whole', () => {
    expect(cutAtCodePoint('fits', 4)).toBe('fits');
  });

  it('keeps the longest start that fits as JSON in UTF-8, never splitting a character', () => {
    expect([
      cutAtCodePoint('abcdef', 4),
      cutAtCodePoint('ééé', 5),
      cutAtCodePoint('a😀b', 4),
      cutAtCodePoint('a😀b', 5),
      cutAtCodePoint('a\u0000b', 6),
      cutAtCodePoint('a\u0000b', 7),
      cutAtCodePoint('"quoted"', 3),
    ]).toEqual(['abcd', 'éé', 'a', 'a😀', 'a', 'a\u0000', '"q']);
  });
});

describe('the issues shown of a rejection', () => {
  it('are counted, and the first five shown, each detail and pointer cut', () => {
    const issues = Array.from({ length: 7 }, (_, index) => ({
      detail: `${index}${'d'.repeat(300)}`,
      pointer: `/${'p'.repeat(200)}`,
    }));

    expect(issuesShown(issues)).toEqual({
      issue_count: 7,
      issues: ['0', '1', '2', '3', '4'].map((index) => ({
        detail: `${index}${'d'.repeat(255)}`,
        pointer: `/${'p'.repeat(127)}`,
      })),
    });
  });
});
