import type { ProjectedRow, RunContext } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { openRequests } from './open-requests.ts';

const at = '2026-10-07T09:00:00.000Z';

const expiresAt = '2026-10-07T09:10:00.000Z';

const ofAReasoningRun: RunContext = {
  by: 'person:user_7kLm2',
  at,
  runId: 'r-pay',
  definitionType: 'reasoning',
  definitionName: 'pay-supplier',
  definitionVersion: 1,
};

interface Fact {
  readonly type: string;
  readonly data: unknown;
}

function after(row: ProjectedRow | undefined, { type, data }: Fact, context: RunContext = ofAReasoningRun) {
  return openRequests.rowAfter(row, { id: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', position: 2, type, data, context });
}

const request = {
  to: 'person:user_7kLm2',
  answerer: 'person:user_7kLm2',
  message: 'Approve paying for order A-17?',
  answer_schema: {},
  expires_at: expiresAt,
  requested_at: at,
};

const approval = { server: 'shop', tool: 'pay', action: 'Pay for order A-17' };

const asked = after(undefined, { type: 'run_deferred', data: { record: { ...request, approval } } });

const taken: Fact = {
  type: 'request_answered',
  data: { answer: { approved: true }, answered_by: { id: 'person:user_7kLm2', name: 'Priya Shah' } },
};

const cancelAsked: Fact = { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Off' } };

const resumed: Fact = { type: 'attempt_resumed', data: { attempt: 2 } };

describe('the open request of a run that asks a person to approve an action', () => {
  it('keeps the action, held for its person until it expires, when its run goes on rather than the playbook ending it', () => {
    expect(asked).toMatchObject({
      type: 'reasoning',
      approval: JSON.stringify(approval),
      standing: 'held_for_an_agent',
      open: true,
      ending_due_at: null,
      go_on_due_at: Date.parse(expiresAt),
    });
  });

  it('is due at once for its run to go on once it is answered, and due no more once a cancel is asked', () => {
    const answered = after(asked, taken);

    expect([answered, after(answered, cancelAsked)]).toMatchObject([
      { standing: 'answered', open: false, ended: null, ending_due_at: null, go_on_due_at: Date.parse(at) },
      { standing: 'cancelling', go_on_due_at: null },
    ]);
  });
});

describe('the open request of a run that went on after asking a person to approve an action', () => {
  it('ends as answered, or as expired with no answer, once its run goes on, and changes no more after', () => {
    const wentOnAnswered = after(after(asked, taken), resumed);
    const wentOnExpired = after(asked, resumed);
    const ofAnInteraction = { ...ofAReasoningRun, definitionType: 'interaction', definitionName: 'approve-brief' };
    const openOfAnInteraction = after(undefined, { type: 'run_deferred', data: { record: request } }, ofAnInteraction);

    expect([wentOnAnswered, wentOnExpired]).toMatchObject([
      { ended: 'answered', open: false, go_on_due_at: null, ending_due_at: null },
      { ended: 'expired', open: false, go_on_due_at: null, ending_due_at: null },
    ]);
    expect([
      after(wentOnExpired, resumed),
      after(wentOnExpired, cancelAsked),
      after(openOfAnInteraction, resumed, ofAnInteraction),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
