import { standingRenderClock } from '@on.auto/definitions/testing';
import { describe, expect, it } from 'vitest';

import type { DeliveringRecord } from '../run/request-record.ts';
import { keptOf } from './sent-messages.ts';

const record: DeliveringRecord = {
  to: '#approvals-sales',
  message: 'Approve?',
  answer_schema: { type: 'object' },
  answerer: 'U024BE7LH',
  reply: { choice: { from: 'text' } },
  expires_at: '2026-10-09T09:00:00.000Z',
  requested_at: '2026-10-07T09:00:00.000Z',
  deliver: { server: 'chat', tool: 'post_message', with: {}, sent: { conversation: '/channel', id: '/ts' } },
  replies: {
    conversation: '{{ sent.id',
    tool: 'thread_replies',
    with: {},
    read: { list: '/messages', order: 'oldest_first', each: { id: '/ts', sender: '/user', text: '/text' } },
  },
};

const posted = { content: [{ type: 'text', text: JSON.stringify({ channel: 'C0123', ts: '1699.1' }) }] };

describe('a message a delivery that reads no replies cannot keep', () => {
  it('is said in the detail, with nothing about replies', () => {
    const { replies: _reading, ...delivering } = record;

    expect(
      keptOf(delivering, { content: [{ type: 'text', text: '{"channel":"C0123"}' }] }, standingRenderClock),
    ).toEqual({
      detail: 'The answer of the tool has no text or whole number at /ts, its message',
    });
  });
});

describe('a recorded reading without a reply rule', () => {
  it('keeps what the message was delivered as, and no place to read replies', () => {
    const { reply: _rule, ...unruled } = record;

    expect(keptOf(unruled, posted, standingRenderClock)).toEqual({
      delivered_as: { conversation: 'C0123', id: '1699.1' },
    });
  });
});

describe('the conversation key of a recorded reading', () => {
  it('keeps no place to read when it cannot be rendered, and says so', () => {
    expect(keptOf(record, posted, standingRenderClock)).toEqual({
      detail:
        "The conversation's key renders to nothing, to more than 256 bytes or to a character a key may not hold, so the request takes no reply and waits for answer_interaction",
    });
  });
});
