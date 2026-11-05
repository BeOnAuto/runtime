import { describe, expect, it } from 'vitest';

import {
  answerBy,
  approvalIn,
  asked,
  askingPriya,
  lastToolAnswersIn,
  priya,
  search,
  wentOnAfter,
} from '../testing/approving-steps.ts';
import { askingNobody } from '../testing/step-runs.ts';
import { declinedWords, expiredWords, noLongerOfferedWords, notPassedOn } from './approval-words.ts';

describe('a run that goes on after its approval request was approved', () => {
  it('sends the call once more, carrying the approval its host gave, and the model reads what the tool answers then', async () => {
    const { stepped, second } = await wentOnAfter(answerBy({ approved: true }));

    expect(stepped.ending.type).toBe('answered');
    expect(second.sends()).toMatchObject([
      { callId: 'call-1', tool: 'shop__pay', input: { order: 'A-17' }, approval: `signed by ${priya} for call-1` },
    ]);
    expect(second.journal.recorded()).toMatchObject([
      { number: 2, type: 'tool_call_started', data: { call_id: 'call-1' } },
      { number: 2, type: 'tool_call_answered' },
      { type: 'model_call_started' },
      { type: 'model_call_answered' },
    ]);
    expect(lastToolAnswersIn(second.requests)).toContain(`Paid with signed by ${priya} for call-1.`);
    expect(lastToolAnswersIn(second.requests)).not.toContain('Paying needs approval.');
  });

  it('waits again when the tool asks again for the call sent with the approval', async () => {
    const { stepped, second } = await wentOnAfter(answerBy({ approved: true }), {}, { asksAgain: true });

    expect(approvalIn(stepped)).toMatchObject({ callId: 'call-1', number: 2, approvedAt: null });
    expect(second.requests()).toEqual([]);
  });

  it('reads the failure of the call sent with the approval as the answer of its call, and asks nothing again', async () => {
    const { stepped, second } = await wentOnAfter(answerBy({ approved: true }), {}, { fails: true });

    expect(stepped.ending.type).toBe('answered');
    expect(lastToolAnswersIn(second.requests)).toContain('did not answer in time');
  });
});

describe('a run that goes on after its approval request, without sending the call again', () => {
  it('tells the model the person declined the action, with their reason where they gave one', async () => {
    const withAReason = await wentOnAfter(answerBy({ approved: false, reason: 'Wrong amount' }));
    const without = await wentOnAfter(answerBy({ approved: false }));

    expect(withAReason.second.sends()).toEqual([]);
    expect(lastToolAnswersIn(withAReason.second.requests)).toContain(declinedWords('Wrong amount'));
    expect(lastToolAnswersIn(without.second.requests)).toContain(declinedWords());
  });

  it('tells the model nobody approved the action before its approval expired, and to start again', async () => {
    const { second } = await wentOnAfter(null);

    expect(second.sends()).toEqual([]);
    expect(lastToolAnswersIn(second.requests)).toContain(expiredWords(asked.expires_at).slice(0, 60));
  });

  it('tells the model the approval was not passed on where its host gave none', async () => {
    const unsigned = { ...askingPriya, signed: askingNobody.signed };
    const { second } = await wentOnAfter(answerBy({ approved: true }), { approvals: unsigned });

    expect(second.sends()).toEqual([]);
    expect(lastToolAnswersIn(second.requests)).toContain(notPassedOn);
  });

  it('tells the model the tool is no longer offered where its server changed while the run waited', async () => {
    const { second } = await wentOnAfter(answerBy({ approved: true }), { tools: [search] });

    expect(second.sends()).toEqual([]);
    expect(lastToolAnswersIn(second.requests)).toContain(noLongerOfferedWords('pay'));
  });
});
