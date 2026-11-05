import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { reasoningRunWords } from './approval-accounts.ts';
import { approvalRequestOf } from './approval-requests.ts';
import { requestMessageOf } from './approval-words.ts';

const record = approvalRequestOf({
  person: 'person:user_7kLm2',
  at: Date.parse('2026-11-05T10:00:00.000Z'),
  functionName: 'pay-supplier',
  approval: {
    callId: 'toolu_1',
    number: 1,
    server: 'browser',
    asked: {
      request: 'approval-1',
      tool: 'browser_click',
      digest: 'sha256',
      action: 'Click "Pay now"',
      expires_at: '2026-11-05T10:05:00.000Z',
    },
    person: 'person:user_7kLm2',
    approvedAt: null,
  },
  numbering: { lastCall: 1, lastModelCall: 1 },
  spent: undefined,
});

describe('the words of a reasoning run that waits for an approval', () => {
  it('shows its deferral as a request waiting for the person, never its message', () => {
    expect(reasoningRunWords.deferralType).toBe('interaction_requested');
    expect(reasoningRunWords.deferral(record)).toEqual({
      summary:
        'An approval request is waiting for the person the run acts for to approve an action of browser, until 2026-11-05T10:05:00.000Z.',
      data: {
        delivery: null,
        to: 'person:user_7kLm2',
        message_bytes: Buffer.byteLength(
          requestMessageOf({
            functionName: 'pay-supplier',
            server: 'browser',
            tool: 'browser_click',
            action: 'Click "Pay now"',
          }),
          'utf8',
        ),
        takes_answer: true,
        expires_at: '2026-11-05T10:05:00.000Z',
        approval: { server: 'browser', tool: 'browser_click' },
      },
    });
  });

  it('shows no deferral that is not an approval request', () => {
    expect([
      reasoningRunWords.deferral({ waiting: true }),
      reasoningRunWords.deferral({
        to: 'ada',
        message: 'Approve?',
        expires_at: '2099-01-01T00:00:00Z',
        requested_at: '2026-01-01T00:00:00Z',
      }),
    ]).toEqual([undefined, undefined]);
  });
});
