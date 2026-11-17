import type { CallAnswer } from '@on.auto/tool-servers';
import { describe, expect, it } from 'vitest';

import type { DeliveringRecord } from '../run/request-record.ts';
import { standingRendering } from '../testing/route-documents.ts';
import { endOfCall } from './call-ends.ts';
import { keptOf } from './sent-messages.ts';

const anyWords: unknown = expect.any(String);

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

    expect(keptOf(delivering, { content: [{ type: 'text', text: '{"channel":"C0123"}' }] }, standingRendering)).toEqual(
      {
        detail: anyWords,
      },
    );
  });
});

describe('a recorded reading without a reply rule', () => {
  it('keeps what the message was delivered as, and no place to read replies', () => {
    const { reply: _rule, ...unruled } = record;

    expect(keptOf(unruled, posted, standingRendering)).toEqual({
      delivered_as: { conversation: 'C0123', id: '1699.1' },
    });
  });
});

describe('a message whose tool answered where it landed in a file', () => {
  it('keeps what the message was delivered as from the text of the file', () => {
    const { reply: _rule, ...unruled } = record;
    const file = {
      uri: 'file:///posted.json',
      mimeType: 'application/json',
      text: '{"channel":"C0123","ts":"1699.1"}',
    };

    expect(keptOf(unruled, { content: [{ type: 'resource', resource: file }] }, standingRendering)).toEqual({
      delivered_as: { conversation: 'C0123', id: '1699.1' },
    });
  });
});

describe('the conversation key of a recorded reading', () => {
  it('keeps no place to read when it cannot be rendered, and says so', () => {
    expect(keptOf(record, posted, standingRendering)).toEqual({
      detail:
        "The conversation's key renders to nothing, to more than 256 bytes or to a character a key may not hold, so the request takes no reply and waits for answer_interaction",
    });
  });
});

const answering = { kind: 'answered', mark: 'unmarked' } as const;

const answered = {
  is_error: false,
  result_bytes: 52,
  result_sha256: 'b'.repeat(64),
  duration_ms: 3,
  jsonrpc_id: 1,
};

type Failure = 'server_failure' | 'cancelled' | 'timed_out' | 'too_large' | 'arguments_refused';

function failedBecause(because: Failure) {
  return { because, duration_ms: 3, jsonrpc_id: 1 };
}

function endedBecause(outcome: Failure, detail: string, retryAfterMs: number | null = null) {
  return endOfCall({ ...answering, outcome, failed: failedBecause(outcome), detail, retryAfterMs });
}

function resultOf(answer: CallAnswer) {
  return endOfCall({ ...answering, outcome: 'result', answer, answered, detail: '', retryAfterMs: null });
}

describe('the end of one call of a tool the playbook makes', () => {
  it('is what the tool answered, its structured content where it gave one, with what the call recorded', () => {
    expect([
      resultOf({ content: [{ type: 'text', text: '{"ts":"1.1"}' }] }),
      resultOf({ content: [], structuredContent: { ts: '1.1' } }),
    ]).toEqual([
      { answered: { content: [{ type: 'text', text: '{"ts":"1.1"}' }] }, fields: answered },
      { answered: { content: [], structuredContent: { ts: '1.1' } }, fields: answered },
    ]);
  });
});

describe('the end of one call of a tool the playbook makes that failed', () => {
  it('is a failure in the words every call of the playbook shares, an answer past the transport too large and an interrupted call lost', () => {
    expect([
      endedBecause('server_failure', 'Busy', 60_000),
      endedBecause('cancelled', ''),
      endedBecause('timed_out', 'Late'),
      endedBecause('too_large', 'Large'),
      endedBecause('arguments_refused', 'Bad'),
    ]).toEqual([
      {
        failed: {
          because: 'server_failure',
          retryAfterMs: 60_000,
          detail: 'Busy',
          fields: failedBecause('server_failure'),
        },
      },
      { failed: { because: 'lost', retryAfterMs: null, detail: '', fields: failedBecause('cancelled') } },
      { failed: { because: 'timed_out', retryAfterMs: null, detail: 'Late', fields: failedBecause('timed_out') } },
      { failed: { because: 'too_large', retryAfterMs: null, detail: 'Large', fields: failedBecause('too_large') } },
      {
        failed: {
          because: 'arguments_refused',
          retryAfterMs: null,
          detail: 'Bad',
          fields: failedBecause('arguments_refused'),
        },
      },
    ]);
  });

  it('is a tool error with what the tool answered', () => {
    const errored = { ...answered, is_error: true };

    expect(
      endOfCall({ ...answering, outcome: 'tool_error', answered: errored, detail: 'Denied', retryAfterMs: null }),
    ).toEqual({
      failed: { because: 'tool_error', retryAfterMs: null, detail: 'Denied', fields: errored },
    });
  });
});
