import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentOf } from '../testing/definition-documents.ts';
import { textResult, toolCallsResult, type ScriptedCall } from '../testing/model-results.ts';
import { reasoningOf, type Reasoning } from '../testing/reasoning-runs.ts';
import { aGraph, graphAccessTo, withGraphTools } from '../testing/resumed-attempts.ts';
import { answers, type ScriptedReply } from '../testing/scripted-language-model.ts';

const answeringAtItsLimit = documentOf(
  'model: anthropic/claude-sonnet-4-5\ntools: [graph/*]\nexit_behavior: continue',
  'Summarize acme.',
);

function searches(count: number, from = 0): readonly ScriptedCall[] {
  return Array.from({ length: count }, (_, call): ScriptedCall => ['graph__search', { query: `acme ${from + call}` }]);
}

const echoed: ScriptedCall = ['graph__echo', { said: 'acme' }];

const sixThousandRead = {
  usage: {
    input: { total: 6000, uncached: 6000, cache_read: null, cache_write: null },
    output: { total: 20, text: 20, reasoning: null },
    total: null,
  },
  request_bytes: 24_000,
};

function asking(calls: readonly ScriptedCall[], read = {}): ScriptedReply {
  return answers(toolCallsResult(calls, read));
}

const answered = answers(textResult('Acme has 2 rows.'));

const anyLimit: unknown = expect.anything();

async function ranWith(source: string, reasoning: Omit<Reasoning, 'tools'>, ...replies: readonly ScriptedReply[]) {
  const fake = await aGraph();
  const run = reasoningOf({ ...reasoning, tools: graphAccessTo(fake.url) }, ...replies);
  const exit = await run.running(source);
  const offered = run.requests().map(({ tools = [] }) => tools.length > 0);
  return { exit, sent: fake.received().length, offered };
}

function stoppedAt(because: string, kind: string, detail: string) {
  return Exit.fail(expect.objectContaining({ _tag: 'conflict', kind, because, detail }));
}

const splitTheCalls =
  'Run the function once for each item from a workflow, so each run makes the calls of one item; to have it answer from what it has instead, where an answer from part of the work will do, set exit_behavior: continue in the reasoning function definition';

const askForLess =
  'Ask each tool for less, such as one page of what it holds, or run the function once for each item from a workflow; to have it answer from what it has instead, where an answer from part of the work will do, set exit_behavior: continue in the reasoning function definition';

describe('a run whose step asks for more tool calls than the 25 a run may make, by default', () => {
  it('sends none of that step’s calls and is unworkable when it had called no tool, with no further model call', async () => {
    expect(await ranWith(withGraphTools, {}, asking(searches(26)))).toEqual({
      exit: stoppedAt(
        'max_tool_calls',
        'unworkable',
        `The run needed more than the 25 tool calls a run may make. ${splitTheCalls}`,
      ),
      sent: 0,
      offered: [true],
    });
  });

  it('is unworkable after it called only tools marked reads, sending none of the calls past the 25', async () => {
    expect(await ranWith(withGraphTools, {}, asking(searches(20)), asking(searches(6, 20)))).toMatchObject({
      exit: stoppedAt(
        'max_tool_calls',
        'unworkable',
        `The run needed more than the 25 tool calls a run may make, after the run called the search tool of graph. ${splitTheCalls}`,
      ),
      sent: 20,
    });
  });

  it('is effect_unknown after it called a tool that declares nothing, which counts as one that may change something', async () => {
    expect(await ranWith(withGraphTools, {}, asking([...searches(24), echoed]), asking(searches(1, 24)))).toMatchObject(
      {
        exit: stoppedAt(
          'max_tool_calls',
          'effect_unknown',
          `The run needed more than the 25 tool calls a run may make, after the run called the search and echo tools of graph. ${splitTheCalls}`,
        ),
        sent: 25,
      },
    );
  });

  it('answers as any run does when its 25th call is its last, its next step still offered the tools', async () => {
    const ran = await ranWith(withGraphTools, {}, asking(searches(25)), answered);

    expect(ran).toEqual({
      exit: Exit.succeed(expect.objectContaining({ output: 'Acme has 2 rows.' })),
      sent: 25,
      offered: [true, true],
    });
    expect(ran.exit).not.toMatchObject(Exit.succeed({ incomplete_details: anyLimit }));
  });
});

describe('a run whose step asks for more tool calls than the 25, when its function says continue', () => {
  it('sends the 25, refuses the rest, answers from what it has without tools, and is marked max_tool_calls', async () => {
    expect(await ranWith(answeringAtItsLimit, {}, asking(searches(26)), answered)).toEqual({
      exit: Exit.succeed(
        expect.objectContaining({ output: 'Acme has 2 rows.', incomplete_details: { reason: 'max_tool_calls' } }),
      ),
      sent: 25,
      offered: [true, false],
    });
  });

  it('is marked too when its 25th call was its last and it was then made to answer without tools', async () => {
    expect(await ranWith(answeringAtItsLimit, {}, asking(searches(25)), answered)).toMatchObject({
      exit: Exit.succeed({ incomplete_details: { reason: 'max_tool_calls' } }),
      offered: [true, false],
    });
  });
});

const tenThousand = { reading: { mostInputTokens: 10_000, contextWindowOf: () => Effect.undefined } };

describe('a run whose last step its input tokens cover asks for a tool, by default', () => {
  it('makes that step with the tools, sends none of its calls, and is unworkable when it called only tools marked reads', async () => {
    expect(
      await ranWith(withGraphTools, tenThousand, asking(searches(1), sixThousandRead), asking(searches(1, 1))),
    ).toEqual({
      exit: stoppedAt(
        'max_input_tokens',
        'unworkable',
        `The run needed more than the 10,000 input tokens a run may read, after the run called the search tool of graph. ${askForLess}`,
      ),
      sent: 1,
      offered: [true, true],
    });
  });

  it('is effect_unknown when it had called a tool that declares nothing', async () => {
    expect(
      await ranWith(withGraphTools, tenThousand, asking([echoed], sixThousandRead), asking(searches(1))),
    ).toMatchObject({
      exit: stoppedAt(
        'max_input_tokens',
        'effect_unknown',
        `The run needed more than the 10,000 input tokens a run may read, after the run called the echo tool of graph. ${askForLess}`,
      ),
      sent: 1,
    });
  });

  it('succeeds, unmarked, when that step answers', async () => {
    const ran = await ranWith(withGraphTools, tenThousand, asking(searches(1), sixThousandRead), answered);

    expect(ran).toEqual({
      exit: Exit.succeed(expect.objectContaining({ output: 'Acme has 2 rows.' })),
      sent: 1,
      offered: [true, true],
    });
    expect(ran.exit).not.toMatchObject(Exit.succeed({ incomplete_details: anyLimit }));
  });
});

describe('a run whose input tokens would not cover a step after the next, when its function says continue', () => {
  it('makes the next step without tools, and is marked max_input_tokens', async () => {
    expect(await ranWith(answeringAtItsLimit, tenThousand, asking(searches(1), sixThousandRead), answered)).toEqual({
      exit: Exit.succeed(
        expect.objectContaining({ output: 'Acme has 2 rows.', incomplete_details: { reason: 'max_input_tokens' } }),
      ),
      sent: 1,
      offered: [true, false],
    });
  });
});
