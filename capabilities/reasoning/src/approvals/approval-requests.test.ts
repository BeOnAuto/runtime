import { describe, expect, it } from 'vitest';

import {
  approvalAnswerOf,
  approvalAnswerSchema,
  approvalRequestOf,
  spentIn,
  waitedApprovalOf,
  type ApprovalAsking,
} from './approval-requests.ts';

const asked = {
  request: 'approval-1',
  tool: 'browser_click',
  digest: 'sha256-of-the-arguments',
  kind: 'pay',
  action: 'Click "Pay now"',
  site: 'shop.example',
  person: 'person:user_7kLm2',
  expires_at: '2026-11-05T10:05:00.000Z',
};

const at = Date.parse('2026-11-05T10:00:00.000Z');

const asking: ApprovalAsking = {
  person: 'person:user_7kLm2',
  at,
  functionName: 'pay-supplier',
  approval: { callId: 'toolu_1', number: 2, server: 'browser', asked, person: 'person:user_7kLm2', approvedAt: null },
  numbering: { lastCall: 3, lastModelCall: 1 },
  spent: { usage: { total: 120 }, duration_ms: 900 },
};

describe('the request a run makes for an approval', () => {
  it('asks the person the run acts for, held for their agent and listed in Studio, until the server stops holding the action', () => {
    expect(approvalRequestOf(asking)).toEqual({
      to: 'person:user_7kLm2',
      answerer: 'person:user_7kLm2',
      message: [
        'pay-supplier needs your approval for this action, through the browser_click tool of browser, on shop.example:',
        'Click "Pay now"',
        'Approve it to let the run take it once, or decline it.',
      ].join('\n\n'),
      answer_schema: approvalAnswerSchema,
      expires_at: '2026-11-05T10:05:00.000Z',
      requested_at: '2026-11-05T10:00:00.000Z',
      approval: {
        server: 'browser',
        tool: 'browser_click',
        action: 'Click "Pay now"',
        site: 'shop.example',
        kind: 'pay',
      },
      call: { number: 2, call_id: 'toolu_1', last_call: 3, last_model_call: 1, asked },
      spent: { usage: { total: 120 }, duration_ms: 900 },
    });
  });
});

describe('the request a run makes for an approval, at its bounds', () => {
  it('waits 10 minutes at most, shows the first 300 characters of the action, and names no site, kind or spending it lacks', () => {
    const {
      kind: _kind,
      site: _site,
      person: _person,
      ...plain
    } = { ...asked, expires_at: '2026-11-05T11:00:00.000Z' };
    const long = { ...plain, action: 'a'.repeat(400) };
    const record = approvalRequestOf({ ...asking, approval: { ...asking.approval, asked: long }, spent: undefined });

    expect(record).toMatchObject({
      expires_at: '2026-11-05T10:10:00.000Z',
      approval: { server: 'browser', tool: 'browser_click', action: 'a'.repeat(300) },
      call: { asked: long },
    });
    expect(record).not.toHaveProperty('spent');
    expect(record['approval']).toEqual({ server: 'browser', tool: 'browser_click', action: 'a'.repeat(300) });
  });
});

describe('the request a run made for an approval, read back', () => {
  it('is read back when the run goes on, and nothing that is not such a request is', () => {
    const record = approvalRequestOf(asking);

    expect(waitedApprovalOf(record)).toMatchObject({ expires_at: asked.expires_at, call: { call_id: 'toolu_1' } });
    expect(waitedApprovalOf({ to: 'ada', message: 'Approve?' })).toBeUndefined();
    expect([spentIn(record), spentIn({ to: 'ada' })]).toEqual([{ record: asking.spent }, {}]);
  });
});

describe('the answer to an approval request', () => {
  it('is read as approved or declined, with a reason where given, and as nothing in another shape', () => {
    expect([
      approvalAnswerOf({ approved: true }),
      approvalAnswerOf({ approved: false, reason: 'Wrong amount' }),
      approvalAnswerOf({ choice: 'approve' }),
    ]).toEqual([{ approved: true }, { approved: false, reason: 'Wrong amount' }, undefined]);
  });
});
