import { describe, expect, it } from 'vitest';

import { approvalDocument, fakeTools, interactionHarness, threadDocument } from '../testing/index.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function askedInAThread(owner: string) {
  const playbook = interactionHarness({ tools: fakeTools() });
  await playbook.define('approve-brief', threadDocument());
  await playbook.ask('approve-brief', { team: 'sales', owner, campaign: 'Spring' }, runId);
  return playbook.runOf(runId);
}

describe('the answerer of a request', () => {
  it('is the party the function names in from, recorded with the reply rule beside the answer schema', async () => {
    expect(await askedInAThread('U024BE7LH')).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'started',
        record: {
          to: '#approvals-sales',
          answerer: 'U024BE7LH',
          reply: {
            choice: { from: 'word', words: { approve: ['approved', 'yes', 'ok'], reject: ['rejected', 'no'] } },
            note: { from: 'rest' },
          },
        },
      },
    });
  });

  it('is the party the request goes to when the function gives no from', async () => {
    const playbook = interactionHarness();
    await playbook.define('approve-brief', approvalDocument());

    await playbook.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, runId);

    expect(await playbook.runOf(runId)).toMatchObject({
      output: { record: { to: 'ada', answerer: 'ada', reply: { choice: { from: 'word' } } } },
    });
  });
});

describe('an answerer a run cannot record', () => {
  it('ends the run as unworkable when from renders to nothing or holds a control character', async () => {
    expect([await askedInAThread(' '), await askedInAThread('U02\u0007')]).toMatchObject([
      {
        status: 'succeeded',
        output: {
          status: 'rejected',
          rejection: {
            reason: 'conflict',
            kind: 'unworkable',
            detail: 'The party whose reply counts renders to nothing',
          },
        },
      },
      {
        output: {
          rejection: {
            reason: 'conflict',
            detail: 'The party whose reply counts holds a control character, or another a party may not hold',
          },
        },
      },
    ]);
  });
});
