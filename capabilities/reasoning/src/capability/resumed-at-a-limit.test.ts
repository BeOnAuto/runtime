import type { RecordedCall } from '@on.auto/definitions';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentOf } from '../testing/definition-documents.ts';
import { textResult, toolCallsResult, type ScriptedCall } from '../testing/model-results.ts';
import { reasoningOf, type Reasoning } from '../testing/reasoning-runs.ts';
import { aGraph, attemptOf, graphAccessTo, recordedBy, stopping, withGraphTools } from '../testing/resumed-attempts.ts';
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

function asking(calls: readonly ScriptedCall[], read = {}): ScriptedReply {
  return answers(toolCallsResult(calls, read));
}

const sixThousandRead = {
  usage: {
    input: { total: 6000, uncached: 6000, cache_read: null, cache_write: null },
    output: { total: 20, text: 20, reasoning: null },
    total: null,
  },
  request_bytes: 24_000,
};

const tenThousand = { mostInputTokens: 10_000, contextWindowOf: () => Effect.undefined };

function upToTheLast(calls: readonly RecordedCall[], type: RecordedCall['type']): readonly RecordedCall[] {
  return calls.slice(0, calls.findLastIndex((call) => call.type === type) + 1);
}

interface Resuming {
  readonly source: string;
  readonly reasoning: Omit<Reasoning, 'tools'>;
  readonly cut: (calls: readonly RecordedCall[]) => readonly RecordedCall[];
  readonly first: readonly ScriptedReply[];
  readonly again?: readonly ScriptedReply[];
}

async function resumedAfter({ source, reasoning, cut, first, again = [] }: Resuming) {
  const fake = await aGraph();
  const tools = graphAccessTo(fake.url);
  const recorded = await recordedBy(source, { ...reasoning, tools }, ...first);
  const sentBefore = fake.received().length;
  const resumed = reasoningOf(
    { ...reasoning, tools, attempt: attemptOf(cut(recorded.calls)), content: recorded.first.content },
    ...again,
  );
  const exit = await resumed.running(source);
  return {
    first: recorded.ran,
    again: exit,
    modelCalls: resumed.requests().map(({ tools: offered = [] }) => offered.length > 0),
    sentAgain: fake.received().length - sentBefore,
  };
}

describe('a run performed again after its server stopped once a step had asked past a limit', () => {
  it('ends at the count with the rejection of the first attempt, calling neither the model nor a tool', async () => {
    const ran = await resumedAfter({
      source: withGraphTools,
      reasoning: {},
      cut: (calls) => upToTheLast(calls, 'model_call_answered'),
      first: [asking(echoes(26))],
    });

    expect(ran.again).toEqual(ran.first);
    expect(ran.again).toEqual(Exit.fail(expect.objectContaining({ kind: 'unworkable', because: 'max_tool_calls' })));
    expect([ran.modelCalls, ran.sentAgain]).toEqual([[], 0]);
  });

  it('reaches the count of the calls of tools not marked reads its facts record, and ends where the first attempt did', async () => {
    const ran = await resumedAfter({
      source: withGraphTools,
      reasoning: {},
      cut: (calls) => upToTheLast(calls, 'model_call_answered'),
      first: [asking([...echoes(20), ...searches(10)]), asking([...searches(5, 10), ...echoes(6, 20)])],
    });

    expect(ran.again).toEqual(ran.first);
    expect(ran.again).toEqual(
      Exit.fail(expect.objectContaining({ kind: 'effect_unknown', because: 'max_tool_calls' })),
    );
    expect([ran.modelCalls, ran.sentAgain]).toEqual([[], 0]);
  });

  it('ends at its input tokens with the rejection of the first attempt, from the meter its facts fold to', async () => {
    const ran = await resumedAfter({
      source: withGraphTools,
      reasoning: { reading: tenThousand },
      cut: (calls) => upToTheLast(calls, 'model_call_answered'),
      first: [asking(searches(1), sixThousandRead), asking(searches(1, 1))],
    });

    expect(ran.again).toEqual(ran.first);
    expect(ran.again).toEqual(Exit.fail(expect.objectContaining({ kind: 'unworkable', because: 'max_input_tokens' })));
    expect([ran.modelCalls, ran.sentAgain]).toEqual([[], 0]);
  });
});

describe('a run whose function says continue, performed again after its server stopped in its last step', () => {
  it('makes that step again without tools, and is marked with the limit that withheld them', async () => {
    const ran = await resumedAfter({
      source: answeringAtItsLimit,
      reasoning: {},
      cut: (calls) => calls,
      first: [asking(echoes(26)), stopping],
      again: [answers(textResult('Acme has 2 rows.'))],
    });

    expect(ran.again).toEqual(
      Exit.succeed(
        expect.objectContaining({ output: 'Acme has 2 rows.', incomplete_details: { reason: 'max_tool_calls' } }),
      ),
    );
    expect([ran.modelCalls, ran.sentAgain]).toEqual([[false], 0]);
  });

  it('is marked max_input_tokens when its input tokens withheld them', async () => {
    const ran = await resumedAfter({
      source: answeringAtItsLimit,
      reasoning: { reading: tenThousand },
      cut: (calls) => calls,
      first: [asking(searches(1), sixThousandRead), stopping],
      again: [answers(textResult('Acme has 2 rows.'))],
    });

    expect(ran.again).toMatchObject(Exit.succeed({ incomplete_details: { reason: 'max_input_tokens' } }));
    expect(ran.modelCalls).toEqual([false]);
  });
});
