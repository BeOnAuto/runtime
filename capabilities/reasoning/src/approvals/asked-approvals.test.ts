import { memoryRecordedContent } from '@on.auto/content/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  approvalIn,
  asked,
  askingPriya,
  firstAsking,
  lastToolAnswersIn,
  payingForA17,
  priya,
  shop,
} from '../testing/approving-steps.ts';
import { textResult, toolCallsResult } from '../testing/model-results.ts';
import { answers } from '../testing/scripted-language-model.ts';
import { askedOneAtATime, nobodyMayApprove } from './approval-words.ts';

function payingAnd(order: readonly [string, Readonly<Record<string, unknown>>]) {
  return answers(toolCallsResult([['shop__pay', { order: 'A-17' }], order]));
}

describe('a call whose tool asks for a person’s approval', () => {
  it('ends the steps waiting for the person the run acts for, once every call of its step has ended', async () => {
    const steps = firstAsking(memoryRecordedContent(), {
      replies: [payingAnd(['graph__search', { query: 'acme' }])],
    });

    const stepped = await Effect.runPromise(steps.stepping);

    expect(stepped.ending).toEqual({
      type: 'approval',
      approval: { callId: 'call-1', number: 1, server: 'shop', asked, person: priya, approvedAt: null },
    });
    expect(steps.requests()).toHaveLength(1);
    expect(steps.sends().map(({ tool }) => tool)).toEqual(['shop__pay', 'graph__search']);
  });

  it('asks for one approval at a time, the model reading why another call of its step was not done', async () => {
    const steps = firstAsking(memoryRecordedContent(), { replies: [payingAnd(['shop__pay', { order: 'B-4' }])] });

    const stepped = await Effect.runPromise(steps.stepping);

    expect(approvalIn(stepped).callId).toBe('call-1');
    expect(JSON.stringify(stepped.state.asking.results.get('call-2'))).toContain(askedOneAtATime);
  });
});

describe('a call whose approval nobody can give in the run', () => {
  it('is read by the model with why it was not done, where the run cannot wait or nobody may approve it', async () => {
    const refusing = { ...askingPriya, waiting: { asks: false, because: 'This run cannot wait.' } } as const;
    const cannotWait = firstAsking(memoryRecordedContent(), {
      approvals: refusing,
      replies: [payingForA17, answers(textResult('It needs approval.'))],
    });
    const content = memoryRecordedContent();
    const nobody = firstAsking(content, {
      send: shop(content, { asking: { ...asked, request: null } }),
      replies: [payingForA17, answers(textResult('It needs approval.'))],
    });

    expect([
      (await Effect.runPromise(cannotWait.stepping)).ending.type,
      (await Effect.runPromise(nobody.stepping)).ending.type,
    ]).toEqual(['answered', 'answered']);
    expect(lastToolAnswersIn(cannotWait.requests)).toContain('This run cannot wait.');
    expect(lastToolAnswersIn(nobody.requests)).toContain(nobodyMayApprove);
  });
});
