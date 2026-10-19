import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { AboutSchema, DescriptionSchema } from '../document.ts';

const holds = Schema.is(DescriptionSchema);

const holdsAbout = Schema.is(AboutSchema);

describe('the description of a function document', () => {
  it('takes 1 to 1,000 characters', () => {
    expect([holds(''), holds('x'), holds('x'.repeat(1000)), holds('x'.repeat(1001))]).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
});

describe('the about of a function document', () => {
  it('takes 1 to 4,000 characters, counted as UTF-16 units', () => {
    expect([holdsAbout(''), holdsAbout('x'), holdsAbout('x'.repeat(4000)), holdsAbout('x'.repeat(4001))]).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect([holdsAbout('😀'.repeat(2000)), holdsAbout(`${'😀'.repeat(2000)}x`)]).toEqual([true, false]);
  });
});
