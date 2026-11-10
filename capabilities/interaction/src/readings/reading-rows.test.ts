import type { ProjectedMessage } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { readings } from './reading-rows.ts';

const stream = { kind: 'conversation-calls', id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70' };

const reading = 'f'.repeat(64);

function readOf(type: string, extra: object, id = 'fact-1'): ProjectedMessage {
  const data = {
    call_id: stream.id,
    server: 'chat',
    tool: 'thread_replies',
    conversation: '#approvals-sales',
    since: '1699.4',
    ...extra,
  };
  return { id, position: 1, type, data, context: { by: 'playbook:alpha', at: '2026-10-01T09:00:10.000Z' } };
}

const found = {
  arguments_bytes: 34,
  result_bytes: 120,
  jsonrpc_id: 2,
  duration_ms: 12,
  replies: 1,
  taken: 0,
  refused: 0,
};

describe('the readings projection', () => {
  it('keeps the cursor of a reading of a conversation from each read of it, found or failed, keyed by the conversation and the reading', () => {
    const repliesRead = readOf('replies_read', { ...found, reading });
    const failed = readOf('reading_failed', { reading, since: '1699.4', because: 'timed_out' }, 'fact-2');

    expect([readings.keyOf?.(repliesRead, stream), readings.rowAfter(undefined, repliesRead)]).toEqual([
      `chat/thread_replies/#approvals-sales/${reading}`,
      {
        server: 'chat',
        tool: 'thread_replies',
        conversation: '#approvals-sales',
        reading,
        since: '1699.4',
        last_fact: 'fact-1',
      },
    ]);
    expect(readings.rowAfter(readings.rowAfter(undefined, repliesRead), failed)).toMatchObject({
      since: '1699.4',
      last_fact: 'fact-2',
    });
  });

  it('keeps nothing of a read recorded before readings were, whose cursor is its conversation’s', () => {
    const before = readOf('replies_read', found);

    expect([readings.keyOf?.(before, stream), readings.rowAfter(undefined, before)]).toEqual([undefined, undefined]);
  });
});
