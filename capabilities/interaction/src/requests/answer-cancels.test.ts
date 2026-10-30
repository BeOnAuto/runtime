import { deferredCanceller } from '@on.auto/definitions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { approvalDocument, interactionHarness } from '../testing/index.ts';
import { answerInteraction } from './answer-interaction.ts';
import { listInteractions } from './list-interactions.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

async function askedApproval() {
  const playbook = interactionHarness();
  await playbook.define('approve-brief', approvalDocument());
  await playbook.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, runId);
  return { playbook };
}

describe('a request whose run is cancelled', () => {
  it('ends rejected as cancelled with the kind asked, closes, and takes no answer after', async () => {
    const { playbook } = await askedApproval();

    expect(await playbook.cancel(runId)).toMatchObject({ status: 'succeeded', output: { status: 'started' } });
    await Effect.runPromise(
      deferredCanceller([playbook.capability], playbook.ledger.service)(
        { org: 'acme', playbook: 'alpha', id: runId },
        { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' },
        { causationId: null, correlationId: runId },
      ),
    );

    expect(await playbook.runOf(runId)).toMatchObject({
      output: {
        status: 'rejected',
        rejection: { reason: 'cancelled', kind: 'requested', detail: 'Not needed any more' },
      },
    });
    expect(await playbook.call(listInteractions, {})).toMatchObject({ output: { interactions: [] } });
    expect(await playbook.call(answerInteraction, { run_id: runId, answer: { choice: 'approve' } })).toMatchObject({
      reason: 'conflict',
    });
  });
});

describe('an answer to a request whose run has a cancel asked', () => {
  it('is a conflict before the run ends, and the run stays started', async () => {
    const { playbook } = await askedApproval();
    await playbook.cancel(runId);

    expect(await playbook.call(answerInteraction, { run_id: runId, answer: { choice: 'approve' } })).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      detail: 'A cancel of the run was asked before it took an answer, so it takes none',
    });
    expect(await playbook.runOf(runId)).toMatchObject({ output: { status: 'started' } });
  });
});
