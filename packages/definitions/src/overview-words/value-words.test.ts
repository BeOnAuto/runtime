import { describe, expect, it } from 'vitest';

import { undescribedSentence } from '../index.ts';

describe('the sentence of a value its document does not describe', () => {
  it('says the input a definition takes, or the output it produces', () => {
    expect([undescribedSentence('input'), undescribedSentence('output')]).toEqual([
      'It takes any input, which its document does not describe.',
      'It produces any output, which its document does not describe.',
    ]);
  });

  it('names the input, the output or a value alone, after words of its own', () => {
    expect([
      undescribedSentence('input', 'alone'),
      undescribedSentence('output', 'alone'),
      undescribedSentence('value', 'alone'),
    ]).toEqual([
      'Any input, which its document does not describe.',
      'Any output, which its document does not describe.',
      'Any value, which its document does not describe.',
    ]);
  });
});
