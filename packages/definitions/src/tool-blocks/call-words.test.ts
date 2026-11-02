import { describe, expect, it } from 'vitest';

import { callOutputInWords } from './call-words.ts';

const record = { server: 'chat', tool: 'thread_replies', read: '/messages' };

describe('the words of what a call answered', () => {
  it('say what the tool answered, the records of a list in parentheses, or how many items there are', () => {
    const many = Array.from({ length: 14 }, (_, index) => ({ user: `member-${index}`, text: 'x'.repeat(40) }));

    expect([
      callOutputInWords([{ user: 'member-17', text: 'Shipped the fix' }], record),
      callOutputInWords(many, record),
      callOutputInWords({ text: 'x'.repeat(400) }, record),
      callOutputInWords({}, { server: 'chat', tool: 'thread_replies' }),
    ]).toEqual([
      'It asked the thread replies tool of chat; its answer: (user: “member-17” and text: “Shipped the fix”).',
      'It asked the thread replies tool of chat, whose answer of 14 items is too long to repeat here; the whole of it is in the details below.',
      'It asked the thread replies tool of chat, whose answer is too long to repeat here; the whole of it is in the details below.',
      'It asked the thread replies tool of chat; its answer: nothing.',
    ]);
  });

  it('say nothing of a record that is not the record of a call', () => {
    expect([callOutputInWords({}, null), callOutputInWords({}, { delivered_at: '2026-10-07' })]).toEqual([
      undefined,
      undefined,
    ]);
  });
});
