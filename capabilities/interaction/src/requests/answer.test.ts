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

type Nested = readonly Nested[] | string;

function nestedLevels(levels: number): Nested {
  return levels === 0 ? 'deep' : [nestedLevels(levels - 1)];
}

describe('an answer sent as JSON text', () => {
  it('is taken as the value the text holds when the answer schema takes that value, and is the same answer as that value', async () => {
    const { playbook } = await askedApproval();

    const answered = await playbook.call(answerInteraction, { run_id: runId, answer: '{"choice":"approve"}' });
    await playbook.performDue(Date.now());

    expect(answered).toMatchObject({ status: 'succeeded', output: { run_id: runId, answer: { choice: 'approve' } } });
    expect(await playbook.runOf(runId)).toMatchObject({
      output: { status: 'succeeded', output: { choice: 'approve' } },
    });
    expect(await playbook.call(answerInteraction, { run_id: runId, answer: { choice: 'approve' } })).toMatchObject(
      answered,
    );
  });

  it('is refused as it was given when the text holds a value past the bounds of an answer', async () => {
    const { playbook } = await askedApproval();
    const answering = (answer: string) => playbook.call(answerInteraction, { run_id: runId, answer });
    const refusedAsGiven = { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/answer' }] };

    expect([
      await answering(JSON.stringify({ choice: 'approve', extra: nestedLevels(interactionBounds.answerDepth) })),
      await answering(JSON.stringify({ choice: 'approve', extra: 'x'.repeat(interactionBounds.answerBytes) })),
    ]).toMatchObject([refusedAsGiven, refusedAsGiven]);
    expect(await playbook.call(listInteractions, {})).toMatchObject({
      output: { interactions: [{ run_id: runId }] },
    });
  });

  it('answers as before once its run has ended when it holds the answer the run took, and is a conflict when it holds another or is not JSON', async () => {
    const { playbook } = await askedApproval();
    const first = await playbook.call(answerInteraction, { run_id: runId, answer: { choice: 'approve' } });
    await playbook.performDue(Date.now());
    const answering = (answer: string) => playbook.call(answerInteraction, { run_id: runId, answer });
    const conflict = { status: 'rejected', reason: 'conflict' };

    expect(await playbook.runOf(runId)).toMatchObject({ output: { status: 'succeeded' } });
    expect([
      await answering(JSON.stringify({ choice: 'approve' })),
      await answering(JSON.stringify({ choice: 'reject' })),
      await answering('approve'),
    ]).toMatchObject([first, conflict, conflict]);
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
