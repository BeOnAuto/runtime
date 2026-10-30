import { describe, expect, it } from 'vitest';

import { approvalDocument, interactionHarness } from '../testing/index.ts';
import { defineAnswerInteraction } from './answer-interaction.ts';
import { listInteractions } from './list-interactions.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function askedApproval() {
  const playbook = interactionHarness();
  await playbook.define('approve-brief', approvalDocument());
  await playbook.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, runId);
  return { playbook };
}

describe('an answer the capability of the run that asked checks', () => {
  it('is invalid input when the capability of the run that asked names issues of it, with pointers, and leaves the request open', async () => {
    const { playbook } = await askedApproval();
    const checked = defineAnswerInteraction([
      { type: 'workflow', answerIssues: () => [{ pointer: '', detail: 'Never asked' }] },
      {
        type: 'interaction',
        answerIssues: (given) => [{ pointer: '/choice', detail: `Not ${JSON.stringify(given)}` }],
      },
    ]);

    expect(await playbook.call(checked, { run_id: runId, answer: { choice: 'approve' } })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The answer names what the run that asked cannot take',
      issues: [{ pointer: '/answer/choice', detail: 'Not {"choice":"approve"}' }],
    });
    expect(await playbook.call(listInteractions, {})).toMatchObject({
      output: { interactions: [{ run_id: runId }] },
    });
  });
});
