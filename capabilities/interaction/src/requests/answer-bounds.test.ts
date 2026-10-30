import { describe, expect, it } from 'vitest';

import { interactionBounds } from '../run/run-bounds.ts';
import { answeringAnyRun } from '../testing/harness-parts.ts';
import { interactionHarness } from '../testing/index.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const answer = answeringAnyRun;

const anyAnswer = ['---', "to: 'ada'", 'expires: P2D', 'output:', '  schema: {}', '---', 'Anything?'].join('\n');

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
      playbook.call(answer, { run_id: runId, answer: 'yes', claimed_for: claimedFor });

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

    const deeper = await playbook.call(answer, {
      run_id: runId,
      answer: nestedLevels(interactionBounds.answerDepth + 1),
    });
    const deepest = await playbook.call(answer, {
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
