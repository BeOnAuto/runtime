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

function echoes(count: number, from = 0): readonly ScriptedCall[] {
  return Array.from({ length: count }, (_, call): ScriptedCall => ['graph__echo', { said: `acme ${from + call}` }]);
}

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

function countingAll(most: number, exitBehavior = 'error'): string {
  return documentOf(
    `model: anthropic/claude-sonnet-4-5\ntools: [graph/*]\nmax_tool_calls: ${most}\nexit_behavior: ${exitBehavior}`,
    'Summarize acme.',
  );
}

async function ranWith(source: string, reasoning: Omit<Reasoning, 'tools'>, ...replies: readonly ScriptedReply[]) {
  const fake = await aGraph();
  const run = reasoningOf({ ...reasoning, tools: graphAccessTo(fake.url) }, ...replies);
  const exit = await run.running(source);
  const offered = run.requests().map(({ tools = [] }) => tools.length > 0);
  return { exit, sent: fake.received().length, offered, lastRequest: JSON.stringify(run.requests().at(-1)) };
}

function stoppedAt(because: string, kind: string, detail: unknown) {
  return Exit.fail(expect.objectContaining({ _tag: 'conflict', kind, because, detail }));
}

const answerFromWhatItHas =
  'to have it answer from what it has instead, where an answer from part of the work will do, set exit_behavior: continue in the reasoning function definition';

const ownCount = `Set max_tool_calls in the reasoning function definition to give the run a count of its own, of all its calls, to at most 1,000, or run the function once for each item from a workflow; ${answerFromWhatItHas}`;

const askForLess = `Ask each tool for less, such as one page of what it holds, or run the function once for each item from a workflow; ${answerFromWhatItHas}`;

const pastTheActingCalls = 'The run needed more than the 25 calls a run may make of tools not marked reads';

describe('a run whose step asks for a twenty-sixth call of a tool not marked reads, by default', () => {
  it('sends none of that step’s calls and is unworkable when it had called no tool, with no further model call', async () => {
    expect(await ranWith(withGraphTools, {}, asking(echoes(26)))).toMatchObject({
      exit: stoppedAt('max_tool_calls', 'unworkable', `${pastTheActingCalls}. ${ownCount}`),
      sent: 0,
      offered: [true],
    });
  });

  it('is unworkable after it called only tools marked reads, however many', async () => {
    expect(await ranWith(withGraphTools, {}, asking(searches(30)), asking(echoes(26)))).toMatchObject({
      exit: stoppedAt(
        'max_tool_calls',
        'unworkable',
        `${pastTheActingCalls}, after the run called the search tool of graph. ${ownCount}`,
      ),
      sent: 30,
    });
  });

  it('is effect_unknown after it called a tool that declares nothing, sending none of the reads of that step', async () => {
    expect(
      await ranWith(withGraphTools, {}, asking(echoes(25)), asking([...searches(2), ...echoes(1, 25)])),
    ).toMatchObject({
      exit: stoppedAt(
        'max_tool_calls',
        'effect_unknown',
        `${pastTheActingCalls}, after the run called the echo tool of graph. ${ownCount}`,
      ),
      sent: 25,
    });
  });
});

describe('a run that sets no max_tool_calls and asks for no call past its count', () => {
  it('answers as any run does when its twenty-fifth call of a tool not marked reads is its last, its next step still offered the tools', async () => {
    const ran = await ranWith(withGraphTools, {}, asking(echoes(25)), answered);

    expect(ran).toMatchObject({
      exit: Exit.succeed(expect.objectContaining({ output: 'Acme has 2 rows.' })),
      sent: 25,
      offered: [true, true],
    });
    expect(ran.exit).not.toMatchObject(Exit.succeed({ incomplete_details: anyLimit }));
  });

  it('counts no call of a tool marked reads', async () => {
    const ran = await ranWith(withGraphTools, {}, asking(searches(30)), asking(searches(10, 30)), answered);

    expect(ran).toMatchObject({
      exit: Exit.succeed(expect.objectContaining({ output: 'Acme has 2 rows.' })),
      sent: 40,
    });
    expect(ran.exit).not.toMatchObject(Exit.succeed({ incomplete_details: anyLimit }));
  });
});

describe('a run whose step asks past its count, when its function says continue', () => {
  it('sends the 25 and the reads, refuses the rest, answers from what it has without tools, and is marked max_tool_calls', async () => {
    const ran = await ranWith(answeringAtItsLimit, {}, asking([...echoes(26), ...searches(2)]), answered);

    expect(ran).toMatchObject({
      exit: Exit.succeed(
        expect.objectContaining({ output: 'Acme has 2 rows.', incomplete_details: { reason: 'max_tool_calls' } }),
      ),
      sent: 27,
      offered: [true, false],
    });
    expect(ran.lastRequest).toContain(
      'This run has made all the 25 calls it may make of tools that can change things; answer from what you have.',
    );
  });

  it('answers unmarked when its twenty-fifth such call was its last, its next step still offered the tools', async () => {
    const ran = await ranWith(answeringAtItsLimit, {}, asking(echoes(25)), answered);

    expect(ran).toMatchObject({ exit: Exit.succeed(expect.anything()), offered: [true, true] });
    expect(ran.exit).not.toMatchObject(Exit.succeed({ incomplete_details: anyLimit }));
  });
});

describe('a run whose function sets max_tool_calls', () => {
  it('counts reads too, and ends at the step that asks past it, sending none of its calls', async () => {
    expect(await ranWith(countingAll(3), {}, asking(searches(4)))).toMatchObject({
      exit: stoppedAt(
        'max_tool_calls',
        'unworkable',
        `The run needed more than the 3 tool calls its function's max_tool_calls lets a run make. Raise max_tool_calls in the reasoning function definition, to at most 1,000, or run the function once for each item from a workflow; ${answerFromWhatItHas}`,
      ),
      sent: 0,
    });
  });

  it('is effect_unknown after it called a tool not marked reads', async () => {
    expect(await ranWith(countingAll(3), {}, asking(echoes(1)), asking(searches(3)))).toMatchObject({
      exit: stoppedAt(
        'max_tool_calls',
        'effect_unknown',
        expect.stringContaining('after the run called the echo tool'),
      ),
      sent: 1,
    });
  });

  it('at a thousand, says only to run the function once for each item', async () => {
    expect(await ranWith(countingAll(1000), {}, asking(searches(1001)))).toMatchObject({
      exit: stoppedAt(
        'max_tool_calls',
        'unworkable',
        `The run needed more than the 1,000 tool calls its function's max_tool_calls lets a run make. Run the function once for each item from a workflow, so each run makes the calls of one item; ${answerFromWhatItHas}`,
      ),
      sent: 0,
    });
  });

  it('under continue, sends the calls within it, refuses the rest, and is marked max_tool_calls', async () => {
    const ran = await ranWith(countingAll(3, 'continue'), {}, asking(searches(4)), answered);

    expect(ran).toMatchObject({
      exit: Exit.succeed(expect.objectContaining({ incomplete_details: { reason: 'max_tool_calls' } })),
      sent: 3,
      offered: [true, false],
    });
    expect(ran.lastRequest).toContain('This run has made all the 3 tool calls it may; answer from what you have.');
  });
});

const tenThousand = { reading: { mostInputTokens: 10_000, contextWindowOf: () => Effect.undefined } };

describe('a run whose last step its input tokens cover asks for a tool, by default', () => {
  it('makes that step with the tools, sends none of its calls, and is unworkable when it called only tools marked reads', async () => {
    expect(
      await ranWith(withGraphTools, tenThousand, asking(searches(1), sixThousandRead), asking(searches(1, 1))),
    ).toMatchObject({
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
      await ranWith(withGraphTools, tenThousand, asking(echoes(1), sixThousandRead), asking(searches(1))),
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

    expect(ran).toMatchObject({
      exit: Exit.succeed(expect.objectContaining({ output: 'Acme has 2 rows.' })),
      sent: 1,
      offered: [true, true],
    });
    expect(ran.exit).not.toMatchObject(Exit.succeed({ incomplete_details: anyLimit }));
  });
});

describe('a run whose input tokens would not cover a step after the next, when its function says continue', () => {
  it('makes the next step without tools, and is marked max_input_tokens', async () => {
    expect(
      await ranWith(answeringAtItsLimit, tenThousand, asking(searches(1), sixThousandRead), answered),
    ).toMatchObject({
      exit: Exit.succeed(
        expect.objectContaining({ output: 'Acme has 2 rows.', incomplete_details: { reason: 'max_input_tokens' } }),
      ),
      sent: 1,
      offered: [true, false],
    });
  });
});
