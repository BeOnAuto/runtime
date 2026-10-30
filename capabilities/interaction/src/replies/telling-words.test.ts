import { describe, expect, it } from 'vitest';

import type { ReplyRule } from './reply-rule.ts';
import { howToAnswer, tellingWords } from './telling-words.ts';

const reason: ReplyRule = { reason: { from: 'text' } };

describe('the words that tell a party how to answer', () => {
  it('ask for an answer in words, kept whole, when the rule lists no words', () => {
    expect(howToAnswer(reason)).toBe(
      'To answer, reply with your answer in words; the whole reply is kept as the reason.',
    );
  });

  it('say what is wrong with the whole answer before how to answer', () => {
    expect(tellingWords(reason, 'invalid', [{ pointer: '/answer', detail: 'The answer: expected a record.' }])).toBe(
      'That reply is not an answer this request takes: The answer: expected a record. To answer, reply with your answer in words; the whole reply is kept as the reason.',
    );
  });
});
