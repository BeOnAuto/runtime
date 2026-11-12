import { describe, expect, it } from 'vitest';

import type { CallAnswered } from '../calls/call-facts.ts';
import { readingFailedOf, repliesReadOf } from './conversation-calls.ts';

const recorded = { by: 'playbook:alpha', at: '2026-10-08T09:00:05.000Z' };

const answered: CallAnswered = {
  is_error: false,
  result_bytes: 61,
  result_sha256: 'b'.repeat(64),
  duration_ms: 7,
  jsonrpc_id: 2,
};

const reading = 'c'.repeat(64);

const ofOneReading = {
  callId: 'call-1',
  start: { server: 'chat', tool: 'thread_replies', arguments_bytes: 40 },
  conversation: 'C0123',
  reading,
  since: '1699.3',
};

function dataOfARead(woken?: boolean) {
  const found = { ...ofOneReading, answered, replies: 1, taken: 1, refused: 0 };
  return repliesReadOf(woken === undefined ? found : { ...found, woken }, recorded).event.data;
}

describe('a read of one reading of a conversation', () => {
  it('records the reading it read beside the conversation, so the cursor it moves is that reading’s', () => {
    const read = repliesReadOf({ ...ofOneReading, answered, replies: 1, taken: 0, refused: 0 }, recorded);
    const failed = readingFailedOf({ ...ofOneReading, because: 'timed_out', retryAfterMs: null }, recorded);

    expect([read.event.data, failed.event.data]).toMatchObject([
      { conversation: 'C0123', reading, since: '1699.3', replies: 1 },
      { conversation: 'C0123', reading, since: '1699.3', because: 'timed_out' },
    ]);
  });

  it('says that a wake caused the read where one did, and says nothing of a read the timer made', () => {
    expect([dataOfARead(true), dataOfARead(false), dataOfARead()]).toMatchObject([
      { woken: true },
      { replies: 1 },
      { replies: 1 },
    ]);
    expect([dataOfARead(false), dataOfARead()].map((data) => 'woken' in data)).toEqual([false, false]);
  });
});
