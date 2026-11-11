import type { ProjectedMessage } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { tellings } from './telling-rows.ts';

const context = {
  at: '2026-11-10T09:00:00.000Z',
  by: 'playbook:alpha',
  runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'interaction',
  definitionName: 'approve-brief',
  definitionVersion: 1,
};

const answeredFields = { result_bytes: 64, result_sha256: 'd'.repeat(64), duration_ms: 3, jsonrpc_id: 2 };

function messageOf(type: string, data: unknown): ProjectedMessage {
  return { id: `${type}-1`, position: 1, type, data, context };
}

const succeeded = messageOf('telling_succeeded', {
  call_id: 'call-1',
  ...answeredFields,
  told_as: { conversation: '#approvals-sales', id: '1699.000003' },
});

describe('the row of a telling', () => {
  it('is made by its start and knows the message its end names', () => {
    const started = tellings.rowAfter(
      undefined,
      messageOf('telling_started', { call_id: 'call-1', server: 'chat', tool: 'post_message', arguments_bytes: 80 }),
    );

    expect([started, tellings.rowAfter(started, succeeded)]).toEqual([
      { run_id: context.runId, conversation: null, message: null, known: false },
      { run_id: context.runId, conversation: '#approvals-sales', message: '1699.000003', known: true },
    ]);
  });

  it('is changed by no end whose start it did not see, and by no fact but a telling', () => {
    const read = messageOf('replies_read', {
      call_id: 'call-2',
      server: 'chat',
      tool: 'thread_replies',
      conversation: '#approvals-sales',
      since: null,
      ...answeredFields,
      replies: 1,
      taken: 0,
      refused: 0,
    });

    expect([tellings.rowAfter(undefined, succeeded), tellings.rowAfter(undefined, read)]).toEqual([
      undefined,
      undefined,
    ]);
  });
});
