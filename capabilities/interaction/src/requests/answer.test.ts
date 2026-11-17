import { deferredCanceller } from '@on.auto/definitions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { interactionBounds } from '../run/run-bounds.ts';
import { approvalDocument, interactionHarness } from '../testing/index.ts';
import { answerInteraction } from './answer-interaction.ts';
import { listInteractions } from './list-interactions.ts';

const anyWords: unknown = expect.any(String);

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
      detail: anyWords,
    });
    expect(await playbook.runOf(runId)).toMatchObject({ output: { status: 'started' } });
  });
});

const anyAnswer = [
  '---',
  "to: 'ada'",
  'expires: P2D',
  'deliver: agent',
  'output:',
  '  schema: {}',
  '---',
  'Anything?',
].join('\n');

type Nested = readonly Nested[] | string;

function nestedLevels(levels: number): Nested {
  return levels === 0 ? 'deep' : [nestedLevels(levels - 1)];
}

async function asked() {
  const playbook = interactionHarness();
  await playbook.define('anything', anyAnswer);
  await playbook.ask('anything', {}, runId);
  return playbook;
}

describe('the claim an answer makes', () => {
  it('takes 256 bytes and refuses one more, and refuses a blank claim or one with a control character', async () => {
    const playbook = await asked();
    const answering = (claimedFor: string) =>
      playbook.call(answerInteraction, { run_id: runId, answer: 'yes', claimed_for: claimedFor });

    const refusals = [
      await answering(`${'é'.repeat(128)}a`),
      await answering('   '),
      await answering('the team\u0007'),
    ];
    const taken = await answering('é'.repeat(interactionBounds.claimBytes / 2));

    expect(refusals).toMatchObject([
      { status: 'rejected', reason: 'invalid_input' },
      { status: 'rejected', reason: 'invalid_input' },
      { status: 'rejected', reason: 'invalid_input' },
    ]);
    expect(taken).toMatchObject({ status: 'succeeded', output: { answer: 'yes' } });
  });
});

describe('the depth of an answer', () => {
  it(`takes an answer ${interactionBounds.answerDepth} levels deep and refuses one level more`, async () => {
    const playbook = await asked();

    const deeper = await playbook.call(answerInteraction, {
      run_id: runId,
      answer: nestedLevels(interactionBounds.answerDepth + 1),
    });
    const deepest = await playbook.call(answerInteraction, {
      run_id: runId,
      answer: nestedLevels(interactionBounds.answerDepth),
    });

    expect(deeper).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/answer', detail: `The answer nests more than ${interactionBounds.answerDepth} levels.` }],
    });
    expect(deepest).toMatchObject({ status: 'succeeded', output: { run_id: runId } });
  });
});
