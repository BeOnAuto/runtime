import { describe, expect, it } from 'vitest';

import type { ReplyRule } from './reply-rule.ts';
import { answeredAlreadyWords, tellingWords, type Refused } from './telling-words.ts';

const choice: ReplyRule = {
  choice: { from: 'word', words: { approve: [], revise: [] } },
  note: { from: 'rest' },
};

const reason: ReplyRule = { reason: { from: 'text' } };

const plainly: Refused = { rule: choice, because: 'not_an_answer', issues: [], open: 1, namesItsMessage: true };

describe('the words a reply that was not taken is told', () => {
  it('say Auto could not take it and how to answer, naming the words and what follows them', () => {
    expect([
      tellingWords(plainly),
      tellingWords({ ...plainly, rule: { choice: { from: 'word', words: { approve: [], revise: [] } } } }),
      tellingWords({ ...plainly, rule: reason }),
    ]).toEqual([
      "Auto couldn't take that as an answer. Reply with approve or revise. Anything after that word is kept as the note.",
      "Auto couldn't take that as an answer. Reply with approve or revise.",
      "Auto couldn't take that as an answer. Reply with your answer in words.",
    ]);
  });

  it('say what is wrong with an answer that does not fit, and how to answer', () => {
    const issues = [{ pointer: '/answer/note', detail: 'note: expected at most 2,000 characters' }];

    expect(tellingWords({ ...plainly, because: 'invalid', issues })).toBe(
      "Auto couldn't take that answer: note: expected at most 2,000 characters. Reply with approve or revise.",
    );
  });

  it('say a reply is too long, by the bound of a reply', () => {
    expect(tellingWords({ ...plainly, because: 'too_long' })).toBe(
      'That reply is too long for Auto to take. A reply can hold up to 8 KB of text.',
    );
  });

  it('say several requests are open, asking for a thread where a reply can name its message, and Auto where it cannot', () => {
    const ambiguous: Refused = { ...plainly, because: 'ambiguous' };

    expect([
      tellingWords(ambiguous),
      tellingWords({ ...ambiguous, namesItsMessage: false, open: 2 }),
      tellingWords({ ...ambiguous, namesItsMessage: false, open: 3 }),
    ]).toEqual([
      "More than one request is open here. Reply in the thread of the one you're answering.",
      "Two requests are open here, so Auto can't tell which one this answers. Neither was answered. Answer them in Auto, or reply here when one is left.",
      "3 requests are open here, so Auto can't tell which one this answers. None of them was answered. Answer them in Auto, or reply here when one is left.",
    ]);
  });

  it('say the request waits on someone else, or was answered already, so the reply was not taken', () => {
    expect([tellingWords({ ...plainly, because: 'not_the_answerer' }), answeredAlreadyWords]).toEqual([
      "This request is waiting for someone else's answer, so Auto didn't take this reply.",
      "This request was already answered, so Auto didn't take this reply.",
    ]);
  });
});
