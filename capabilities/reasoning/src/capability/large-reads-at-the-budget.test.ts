import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { TokenUsage } from '../model/model-result.ts';
import { documentOf } from '../testing/definition-documents.ts';
import { readingOf } from '../testing/input-budgets.ts';
import { textResult, toolCallsResult, type ScriptedCall } from '../testing/model-results.ts';
import { reasoningOf } from '../testing/reasoning-runs.ts';
import { aGraph, graphAccessTo, withGraphTools } from '../testing/resumed-attempts.ts';
import { answers, type ScriptedReply } from '../testing/scripted-language-model.ts';

const answeringAtItsLimit = documentOf(
  'model: anthropic/claude-sonnet-4-5\ntools: [graph/*]\nexit_behavior: continue',
  'Summarize acme.',
);

const readingAMillion = documentOf(
  'model: anthropic/claude-sonnet-4-5\ntools: [graph/*]\nmax_input_tokens: 1000000',
  'Summarize acme.',
);

function usageOf(input: number, output: number): TokenUsage {
  return {
    input: { total: input, uncached: input, cache_read: null, cache_write: null },
    output: { total: output, text: output, reasoning: null },
    total: null,
  };
}

const fiveLargeReads = [221, 222, 223, 224, 225].map((kib): ScriptedCall => ['graph__large', { kib }]);

const firstStep = answers(toolCallsResult(fiveLargeReads, { usage: usageOf(10_973, 300), request_bytes: 4 * 10_973 }));

const lastStepRead = { usage: usageOf(299_654, 120) };

const askedForMore = answers(toolCallsResult([['graph__large', { kib: 226 }]], lastStepRead));

const answeredFromWhatItRead = answers(textResult('The tool budget ran out; no docs update.', lastStepRead));

const threeHundredThousandByDefault = readingOf(300_000, 9_999_999);

const namesTheLimit: unknown = expect.stringMatching(
  /^The run needed more than the 300,000 input tokens a run may read by default, after the run called the large tool of graph\. Raise max_input_tokens in the reasoning function definition, to at most 9,999,999, /u,
);

const bothStepsRead: unknown = expect.objectContaining({ total: 310_627 });

const usageOfBothSteps: unknown = expect.objectContaining({ input: bothStepsRead });

const recordsAllItRead: unknown = expect.objectContaining({ usage: usageOfBothSteps });

const anyLimit: unknown = expect.anything();

async function ranAs(source: string, ...after: readonly ScriptedReply[]) {
  const fake = await aGraph();
  const run = reasoningOf(
    { tools: graphAccessTo(fake.url), reading: threeHundredThousandByDefault },
    firstStep,
    ...after,
  );
  const exit = await run.running(source);
  return { exit, sent: fake.received().length, offered: run.requests().map(({ tools = [] }) => tools.length > 0) };
}

describe('a run whose one round of five large reads leaves its input tokens no room for a step after the next', () => {
  it('is rejected at max_input_tokens when its last covered step, offered the tools, asks for more, recording all it read', async () => {
    expect(await ranAs(withGraphTools, askedForMore)).toEqual({
      exit: Exit.fail(
        expect.objectContaining({
          _tag: 'conflict',
          kind: 'unworkable',
          because: 'max_input_tokens',
          detail: namesTheLimit,
          record: recordsAllItRead,
        }),
      ),
      sent: 5,
      offered: [true, true],
    });
  });

  it('succeeds, unmarked, when that step answers instead', async () => {
    const ran = await ranAs(withGraphTools, answeredFromWhatItRead);

    expect(ran).toMatchObject({ exit: Exit.succeed({ output: 'The tool budget ran out; no docs update.' }), sent: 5 });
    expect(ran.exit).not.toMatchObject(Exit.succeed({ incomplete_details: anyLimit }));
  });

  it('answers without tools and is marked max_input_tokens when its function says continue, as every such run did before', async () => {
    expect(await ranAs(answeringAtItsLimit, answeredFromWhatItRead)).toEqual({
      exit: Exit.succeed(
        expect.objectContaining({
          output: 'The tool budget ran out; no docs update.',
          incomplete_details: { reason: 'max_input_tokens' },
        }),
      ),
      sent: 5,
      offered: [true, false],
    });
  });
});

describe('the same run, when its function sets max_input_tokens to 1,000,000', () => {
  it('makes the call its second step asks for, and goes on to its answer, unmarked', async () => {
    const ran = await ranAs(readingAMillion, askedForMore, answeredFromWhatItRead);

    expect(ran).toMatchObject({
      exit: Exit.succeed({ output: 'The tool budget ran out; no docs update.' }),
      sent: 6,
      offered: [true, true, true],
    });
    expect(ran.exit).not.toMatchObject(Exit.succeed({ incomplete_details: anyLimit }));
  });
});
