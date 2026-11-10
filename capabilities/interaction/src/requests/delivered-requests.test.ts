import type { ProjectedRow, RunContext } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { openRequests } from './open-requests.ts';

const at = '2026-10-07T09:00:00.000Z';

const ofTheRun: RunContext = {
  by: 'playbook:alpha',
  at,
  runId: 'r-approve',
  definitionType: 'interaction',
  definitionName: 'approve-brief',
  definitionVersion: 1,
};

function after(row: ProjectedRow | undefined, type: string, data: unknown): ProjectedRow | undefined {
  return openRequests.rowAfter(row, { id: `fact-${type}`, position: 1, type, data, context: ofTheRun });
}

const asked = after(undefined, 'run_deferred', {
  record: {
    to: 'ada',
    message: 'Approve?',
    answer_schema: {},
    expires_at: '2026-10-09T09:00:00.000Z',
    requested_at: at,
    deliver: { server: 'chat', tool: 'post_message', with: { text: '{{ message }}' } },
  },
});

const attempted = after(asked, 'delivery_started', { number: 1, target: 'ada', server: 'chat', tool: 'post_message' });

function deliveredInto(repliesIn: object): ProjectedRow | undefined {
  return after(attempted, 'delivery_succeeded', {
    number: 1,
    result_bytes: 2,
    result_sha256: 'b'.repeat(64),
    jsonrpc_id: 1,
    duration_ms: 40,
    delivered_as: { conversation: 'C0123', id: '1699.1' },
    replies_in: repliesIn,
  });
}

describe('the open request of a run delivered where its replies are read', () => {
  it('keeps its conversation, the message it was delivered as and the reading of its replies, none where its delivery recorded none', () => {
    const place = { server: 'chat', tool: 'thread_replies', key: 'C0123' };
    const reading = 'a'.repeat(64);

    expect([deliveredInto({ ...place, reading }), deliveredInto(place)]).toMatchObject([
      {
        standing: 'delivered',
        conversation: 'chat/thread_replies/C0123',
        reading,
        sent_conversation: 'C0123',
        sent_id: '1699.1',
      },
      { standing: 'delivered', conversation: 'chat/thread_replies/C0123', reading: null, sent_id: '1699.1' },
    ]);
  });
});
