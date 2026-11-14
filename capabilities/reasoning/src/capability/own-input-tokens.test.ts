import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentOf } from '../testing/definition-documents.ts';
import { readingOf } from '../testing/input-budgets.ts';
import { textResult, toolCallsResult, type ScriptedCall } from '../testing/model-results.ts';
import { reasoningOf, type Reasoning } from '../testing/reasoning-runs.ts';
import { aGraph, graphAccessTo, withGraphTools } from '../testing/resumed-attempts.ts';
import { answers, type ScriptedReply } from '../testing/scripted-language-model.ts';

const ownBudgetOf = (tokens: number) =>
  documentOf(`model: anthropic/claude-sonnet-4-5\ntools: [graph/*]\nmax_input_tokens: ${tokens}`, 'Summarize acme.');

const sixThousandRead = {
  usage: {
    input: { total: 6000, uncached: 6000, cache_read: null, cache_write: null },
    output: { total: 20, text: 20, reasoning: null },
    total: null,
  },
  request_bytes: 24_000,
};

function searchFor(query: string, read = {}): ScriptedReply {
  const call: ScriptedCall = ['graph__search', { query }];
  return answers(toolCallsResult([call], read));
}

const readingThenAsking = [searchFor('acme', sixThousandRead), searchFor('acme again')];

const answered = answers(textResult('Acme has 2 rows.'));

async function ranWith(
  source: string,
  reading: NonNullable<Reasoning['reading']>,
  ...replies: readonly ScriptedReply[]
) {
  const fake = await aGraph();
  const run = reasoningOf({ tools: graphAccessTo(fake.url), reading }, ...replies);
  const exit = await run.running(source);
  return { exit, sent: fake.received().length };
}

function stoppedAt(detail: string) {
  return Exit.fail(expect.objectContaining({ _tag: 'conflict', because: 'max_input_tokens', detail }));
}

const calledTheSearch = 'after the run called the search tool of graph';

const answerFromWhatItHas =
  'to have it answer from what it has instead, where an answer from part of the work will do, set exit_behavior: continue in the reasoning function definition';

const askForLess = `Ask each tool for less, such as one page of what it holds, or run the function once for each item from a workflow; ${answerFromWhatItHas}`;

const raiseItOrAskForLess = `Raise max_input_tokens in the reasoning function definition, to at most 9,999,999, ask each tool for less, such as one page of what it holds, or run the function once for each item from a workflow; ${answerFromWhatItHas}`;

const tenThousandByDefault = readingOf(10_000, 9_999_999);

describe('a run of a function that sets no max_input_tokens, where its runtime allows more than its default', () => {
  it('stops at the default, saying the function may raise it and to what', async () => {
    expect(await ranWith(withGraphTools, tenThousandByDefault, ...readingThenAsking)).toMatchObject({
      exit: stoppedAt(
        `The run needed more than the 10,000 input tokens a run may read by default, ${calledTheSearch}. ${raiseItOrAskForLess}`,
      ),
      sent: 1,
    });
  });
});

describe('a run of a function that sets its own max_input_tokens', () => {
  it('reads past the default up to its own number, and answers', async () => {
    expect(await ranWith(ownBudgetOf(20_000), tenThousandByDefault, ...readingThenAsking, answered)).toMatchObject({
      exit: Exit.succeed(expect.objectContaining({ output: 'Acme has 2 rows.' })),
      sent: 2,
    });
  });

  it('stops at its own number below the default, saying it may be raised to the most', async () => {
    expect(await ranWith(ownBudgetOf(10_000), readingOf(50_000, 9_999_999), ...readingThenAsking)).toMatchObject({
      exit: stoppedAt(
        `The run needed more than the 10,000 input tokens its function's max_input_tokens lets a run read, ${calledTheSearch}. ${raiseItOrAskForLess}`,
      ),
      sent: 1,
    });
  });

  it('stops at its own number where it is the most the runtime allows, with no advice to raise it', async () => {
    expect(await ranWith(ownBudgetOf(10_000), readingOf(10_000, 10_000), ...readingThenAsking)).toMatchObject({
      exit: stoppedAt(
        `The run needed more than the 10,000 input tokens its function's max_input_tokens lets a run read, ${calledTheSearch}. ${askForLess}`,
      ),
    });
  });

  it('reads only what its runtime allows where it asks for more, saying both numbers and whose the lower is', async () => {
    expect(await ranWith(ownBudgetOf(50_000), readingOf(10_000, 10_000), ...readingThenAsking)).toMatchObject({
      exit: stoppedAt(
        `The run needed more than the 10,000 input tokens this runtime lets a run read (REASONING_MAX_INPUT_TOKENS), less than the 50,000 its function's max_input_tokens asks for, ${calledTheSearch}. ${askForLess}`,
      ),
      sent: 1,
    });
  });
});

describe('a function without tools that sets max_input_tokens', () => {
  it('sends its one model call with the room of its own number', async () => {
    const run = reasoningOf({ reading: tenThousandByDefault }, answers(textResult('Acme has 2 rows.')));

    await run.running(documentOf('model: anthropic/claude-sonnet-4-5\nmax_input_tokens: 30000', 'Summarize acme.'));

    expect(run.requests().map(({ room }) => room)).toEqual([{ input_tokens: 30_000 }]);
  });
});
