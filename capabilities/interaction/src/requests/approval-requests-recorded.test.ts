import type { ProjectedRow, RunContext } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { openRequests } from './open-requests.ts';

const person = 'person:user_7kLm2';

const ofAReasoningRun: RunContext = {
  by: person,
  at: '2026-11-05T10:00:00.000Z',
  runId: 'r-pay',
  definitionType: 'reasoning',
  definitionName: 'pay-supplier',
  definitionVersion: 1,
};

const approvalRequest = {
  to: person,
  answerer: person,
  message: 'pay-supplier needs your approval for this action',
  answer_schema: { type: 'object', properties: { approved: { type: 'boolean' } }, required: ['approved'] },
  expires_at: '2026-11-05T10:05:00.000Z',
  requested_at: '2026-11-05T10:00:00.000Z',
  approval: { server: 'browser', tool: 'browser_click', action: 'Click "Pay now"', site: 'shop.example', kind: 'pay' },
};

function after(row: ProjectedRow | undefined, type: string, data: unknown): ProjectedRow | undefined {
  return openRequests.rowAfter(row, { id: 'm-1', position: 2, type, data, context: ofAReasoningRun });
}

describe('the open request a reasoning run recorded when it asked a person to approve an action', () => {
  it('is held for an agent with nothing of the approval kept, and closes at its answer as a request of another type does', () => {
    const asked = after(undefined, 'run_deferred', { record: approvalRequest });
    const answered = after(asked, 'request_answered', {
      answer: { approved: true },
      answered_by: { id: person, name: 'Priya' },
    });

    expect([asked, answered]).toEqual([
      expect.objectContaining({
        type: 'reasoning',
        party: person,
        answerer: person,
        standing: 'held_for_an_agent',
        open: true,
        ending_due_at: Date.parse(approvalRequest.expires_at),
      }),
      expect.objectContaining({ standing: 'answered', open: false, ending_due_at: null }),
    ]);
    expect(asked).not.toHaveProperty('approval');
  });
});
