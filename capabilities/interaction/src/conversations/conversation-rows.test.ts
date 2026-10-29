import type { Context, ProjectedMessage, RunContext } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { conversations } from './conversation-rows.ts';

const stream = { kind: 'runs', id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' };

function ofTheRun(at: string): RunContext {
  return {
    by: 'playbook:alpha',
    at,
    runId: stream.id,
    definitionType: 'interaction',
    definitionName: 'approve-brief',
    definitionVersion: 1,
  };
}

const deliveredAs = { conversation: 'C0123', id: '1699.1' };

const repliesIn = { server: 'chat', tool: 'thread_replies', key: 'C0123/1699.1' };

const answerOfTheTool = { result_bytes: 120, result_sha256: 'b'.repeat(64), jsonrpc_id: 2 };

function messageOf(type: string, data: unknown, context: Context, id = 'fact-1'): ProjectedMessage {
  return { id, position: 1, type, data, context };
}

function deliveryEnded(at: string, keeping = true, id = 'fact-1'): ProjectedMessage {
  const delivered = { number: 1, ...answerOfTheTool, duration_ms: 5 };
  const data = keeping ? { ...delivered, delivered_as: deliveredAs, replies_in: repliesIn } : delivered;
  return messageOf('delivery_succeeded', data, ofTheRun(at), id);
}

function read(since: string | null, type = 'replies_read', id = 'fact-1'): ProjectedMessage {
  const data = {
    call_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70',
    server: 'chat',
    tool: 'thread_replies',
    arguments_bytes: 34,
    arguments_sha256: 'a'.repeat(64),
    ...answerOfTheTool,
    duration_ms: 12,
    conversation: 'C0123/1699.1',
    since,
    replies: 1,
    taken: 0,
    refused: 0,
  };
  return messageOf(type, data, { by: 'playbook:alpha', at: '2026-10-01T09:00:10.000Z' }, id);
}

function readingFailed(since: string | null, id = 'fact-1'): ProjectedMessage {
  const data = {
    call_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70',
    server: 'chat',
    tool: 'thread_replies',
    conversation: 'C0123/1699.1',
    since,
    because: 'server_failure',
    server_request_id: null,
  };
  return messageOf('reading_failed', data, { by: 'playbook:alpha', at: '2026-10-01T09:00:10.000Z' }, id);
}

const joinedAt = Date.parse('2026-10-01T09:00:00.000Z');

describe('the conversations projection', () => {
  it('keys a delivery that kept where replies are read, and a read, by the server, the tool and the conversation', () => {
    const messages = [deliveryEnded('2026-10-01T09:00:00.000Z'), read(null), readingFailed(null)];

    expect(messages.map((message) => conversations.keyOf?.(message, stream))).toEqual([
      'chat/thread_replies/C0123/1699.1',
      'chat/thread_replies/C0123/1699.1',
      'chat/thread_replies/C0123/1699.1',
    ]);
  });

  it('keys nothing for a delivery that kept no place to read, nor for a telling', () => {
    const telling = messageOf(
      'telling_started',
      { call_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70', server: 'chat', tool: 'post_message', arguments_bytes: 34 },
      ofTheRun('2026-10-01T09:00:00.000Z'),
    );
    const messages = [deliveryEnded('2026-10-01T09:00:00.000Z', false), telling];

    expect(
      messages.map((message) => [conversations.keyOf?.(message, stream), conversations.rowAfter(undefined, message)]),
    ).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });
});

describe('the facts the conversations projection reads', () => {
  it('refuses one in a shape no reader of it knows, as any unreadable fact', () => {
    const at = '2026-10-01T09:00:00.000Z';

    expect(() =>
      conversations.rowAfter(undefined, messageOf('delivery_succeeded', { number: 1 }, ofTheRun(at))),
    ).toThrow('Missing key');
    expect(() =>
      conversations.rowAfter(undefined, messageOf('replies_read', { server: 'chat' }, ofTheRun(at))),
    ).toThrow('Missing key');
  });
});

describe('a conversation the projection opens', () => {
  it('opens a row when a request joins it, due five seconds after', () => {
    expect(conversations.rowAfter(undefined, deliveryEnded('2026-10-01T09:00:00.000Z'))).toEqual({
      server: 'chat',
      tool: 'thread_replies',
      conversation: 'C0123/1699.1',
      since: null,
      last_fact: 'fact-1',
      joined_by: 'fact-1',
      open: true,
      active_at: joinedAt,
      reads: 0,
      next_read_at: joinedAt + 5000,
      due_at: joinedAt + 5000,
    });
  });
});

describe('a row of the conversations projection', () => {
  it('keeps the cursor of a read and leaves its cadence to the reader', () => {
    const joined = conversations.rowAfter(undefined, deliveryEnded('2026-10-01T09:00:00.000Z'));
    const readOnce = conversations.rowAfter({ ...joined, reads: 3 }, read('1699.4', 'replies_read', 'fact-2'));

    expect([readOnce, conversations.rowAfter(readOnce, readingFailed('1699.4', 'fact-3'))]).toMatchObject([
      { since: '1699.4', last_fact: 'fact-2', joined_by: 'fact-1', reads: 3 },
      { since: '1699.4', last_fact: 'fact-3', joined_by: 'fact-1', reads: 3 },
    ]);
  });

  it('starts the cadence again when another request joins, keeping the cursor and the sooner read', () => {
    const joined = conversations.rowAfter(undefined, deliveryEnded('2026-10-01T09:00:00.000Z'));
    const resting = { ...joined, since: '1699.4', reads: 40 };

    expect(conversations.rowAfter(resting, deliveryEnded('2026-10-01T10:00:00.000Z', true, 'fact-3'))).toMatchObject({
      since: '1699.4',
      last_fact: 'fact-3',
      joined_by: 'fact-3',
      open: true,
      reads: 0,
      active_at: joinedAt + 3_600_000,
      next_read_at: joinedAt + 5000,
    });
  });

  it('writes no row for a read of a conversation it never opened', () => {
    expect(conversations.rowAfter(undefined, read('1699.4'))).toBeUndefined();
  });
});
