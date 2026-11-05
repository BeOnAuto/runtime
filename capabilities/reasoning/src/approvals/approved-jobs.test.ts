import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { jobsOf, stateOfTheAttempt } from '../index.ts';
import {
  answerBy,
  askingPriya,
  pay,
  priya,
  search,
  wentOnAfter,
  type ApprovalSteps,
} from '../testing/approving-steps.ts';
import { askingNobody, stepsOf } from '../testing/step-runs.ts';

const prompt = { kind: 'prompt', message: 'Find acme.' } as const;

async function wentOnOnce() {
  const { second, before, content } = await wentOnAfter(answerBy({ approved: true }));
  const viaJobs = (approvals: ApprovalSteps) => {
    const steps = stepsOf({ tools: [pay, search], content, approvals, before });
    return Effect.runPromise(
      Effect.flatMap(stateOfTheAttempt(steps.run, prompt, before), (state) => jobsOf(steps.run, state)),
    );
  };
  return { second, before, content, viaJobs };
}

describe('an answered approval, with steps made as jobs', () => {
  it('is a job of the call sent again with the approval, or, where the call cannot be sent, the model’s next call', async () => {
    const { viaJobs } = await wentOnOnce();

    const signed = await viaJobs(askingPriya);
    const unsigned = await viaJobs({ ...askingPriya, signed: askingNobody.signed });

    expect(signed.jobs).toMatchObject([
      { type: 'tool_call', job: { tool: 'shop__pay', approval: `signed by ${priya} for call-1` } },
    ]);
    expect(unsigned.jobs).toMatchObject([{ type: 'model_call' }]);
  });
});

describe('an approval the run has acted on', () => {
  it('is acted on no more by a run that goes on from what it recorded after it', async () => {
    const { second, before, content } = await wentOnOnce();
    const again = stepsOf({
      tools: [pay, search],
      content,
      approvals: askingPriya,
      before: { ...before, calls: [...before.calls, ...second.journal.calls()] },
    });

    const stepped = await Effect.runPromise(again.stepping);

    expect(again.sends()).toEqual([]);
    expect(stepped.ending.type).not.toBe('approval');
  });
});
