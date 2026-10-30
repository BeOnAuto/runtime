import { describe, expect, it } from 'vitest';

import { answerOfReply, type ReplyRule } from './reply-rule.ts';

const approval: ReplyRule = {
  choice: { from: 'word', words: { approve: ['approved', 'yes', 'ok'], reject: ['rejected', 'no'] } },
  note: { from: 'rest' },
};

describe('the words of a reply, as the rule reads them', () => {
  it('take the first word, lowercased and stripped of punctuation, as a value or a word listed for one', () => {
    expect(
      ['approve', 'Approved!', '*yes*', 'OK.', 'no thanks', 'Reject'].map((words) => answerOfReply(approval, words)),
    ).toEqual([
      { choice: 'approve' },
      { choice: 'approve' },
      { choice: 'approve' },
      { choice: 'approve' },
      { choice: 'reject', note: 'thanks' },
      { choice: 'reject' },
    ]);
  });

  it('keep what follows the first word, trimmed, as the part the rule names', () => {
    expect(answerOfReply(approval, '  reject,   the second point is wrong  ')).toEqual({
      choice: 'reject',
      note: 'the second point is wrong',
    });
  });

  it('read the first word whole, however long a run of punctuation it holds inside', () => {
    expect(answerOfReply(approval, `yes${'!'.repeat(100_000)}no`)).toBeUndefined();
  });

  it('strip a symbol of several parts from the edge of the first word', () => {
    expect(answerOfReply(approval, '👍🏽yes')).toEqual({ choice: 'approve' });
  });

  it('are no answer when the first word means no value, or there are no words at all', () => {
    expect([answerOfReply(approval, 'maybe later'), answerOfReply(approval, '   ')]).toEqual([undefined, undefined]);
  });

  it('take the whole reply, trimmed, for a part read as text', () => {
    expect(answerOfReply({ reason: { from: 'text' } }, '  Too costly this quarter. ')).toEqual({
      reason: 'Too costly this quarter.',
    });
  });
});
