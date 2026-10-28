import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { CandidateSignatureSchema } from './loaded-model.ts';

const isSignature = Schema.is(CandidateSignatureSchema);

describe('the signature of a candidate', () => {
  it('is whatever JSON object its runtime answers, which the capability records as given', () => {
    expect([
      isSignature({ opset: 13, inputs: [{ name: 'y', type: 'float32', shape: [1, 'L'] }] }),
      isSignature({ recipe: 'mean' }),
      isSignature(['y']),
      isSignature({ answers: () => 1 }),
    ]).toEqual([true, true, false, false]);
  });
});
