import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { DescriptionSchema } from '../document.ts';

const holds = Schema.is(DescriptionSchema);

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
