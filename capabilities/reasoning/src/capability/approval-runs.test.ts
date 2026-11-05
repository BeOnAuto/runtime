import { approvalKey } from '@on.auto/tool-servers/policy';
import { askedDigest } from '@on.auto/tool-servers/testing';
import { describe, expect, it } from 'vitest';

import { nobodyToAsk, noWayToPassItOn, notPassedOn } from '../approvals/approval-words.ts';
import { askedFirst, priya, signing, wentOn } from '../testing/approving-runs.ts';
import { acmeAdmin } from '../testing/reasoning-runs.ts';

describe('a reasoning run whose tool asks the person it acts for to approve an action', () => {
  it('waits for them with an approval request, keeping the call that asked and what its model calls spent', async () => {
    const { answered, first } = await askedFirst();

    expect(answered).toMatchObject({
      finishesLater: true,
      record: {
        to: priya.id,
        answerer: priya.id,
        approval: { server: 'graph', tool: 'pay', action: 'Pay for order A-17', site: 'shop.example', kind: 'pay' },
        call: { number: 1, last_call: 1, last_model_call: 1 },
      },
    });
    expect(answered).toHaveProperty('record.spent.duration_ms');
    expect(first.requests()).toHaveLength(1);
  });

  it('answers at once, telling the model why, where it acts for nobody or nobody passes approvals on', async () => {
    const forNobody = await askedFirst({ caller: acmeAdmin });
    const unsigned = await askedFirst({ approvals: {} });

    expect([forNobody.answered, unsigned.answered]).toMatchObject([
      { output: 'It needs an approval nobody can give.' },
      { output: 'It needs an approval nobody can give.' },
    ]);
    expect(JSON.stringify(forNobody.first.requests().at(-1))).toContain(nobodyToAsk);
    expect(JSON.stringify(unsigned.first.requests().at(-1))).toContain(noWayToPassItOn);
  });
});

describe('a reasoning run that goes on once the person approved the action', () => {
  it('sends the call again once, carrying the approval its host signed, and answers from what the tool did', async () => {
    const { fake, second, answered } = await wentOn(signing);
    const [asked, approved] = fake.received();

    expect(answered).toMatchObject({ output: 'Paid.' });
    expect(fake.received()).toHaveLength(2);
    expect(asked?.meta).not.toHaveProperty([approvalKey]);
    expect(approved?.meta).toHaveProperty([approvalKey], `approval of ${priya.id} for approval-1 ${askedDigest}`);
    expect(JSON.stringify(second.requests().at(-1))).toContain(`with the approval approval of ${priya.id}`);
  });

  it('tells the model the approval was not passed on where its host no longer signs approvals', async () => {
    const { fake, second, answered } = await wentOn({});

    expect(answered).toMatchObject({ output: 'Paid.' });
    expect(fake.received()).toHaveLength(1);
    expect(JSON.stringify(second.requests().at(-1))).toContain(notPassedOn);
  });
});

describe('a reasoning run cancelled while it waits for an approval', () => {
  it('ends cancelled, keeping what its model calls spent, or nothing where its deferral kept none', async () => {
    const { first, answered } = await askedFirst();
    const cancelling = {
      run: { org: 'acme', playbook: 'alpha', id: 'run' },
      kind: 'requested',
      reason: 'Stopped by its caller',
      answer: null,
      work: [],
    } as const;
    const cancelled = { status: 'rejected', reason: 'cancelled', kind: 'requested', detail: 'Stopped by its caller' };

    expect(first.capability.cancel({ ...cancelling, record: answered.record })).toEqual({
      ...cancelled,
      record: answered.record['spent'],
    });
    expect(first.capability.cancel({ ...cancelling, record: {} })).toEqual(cancelled);
  });
});
