import type { CallAnswer } from '@on.auto/tool-servers';
import { describe, expect, it } from 'vitest';

import { endOfCall } from './call-ends.ts';

const answering = { kind: 'answered', annotations: undefined } as const;

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
