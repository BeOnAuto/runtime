import type { RecordedCall } from '@on.auto/definitions';
import { callCountOf } from '@on.auto/tool-servers/policy';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { textResult, toolCallsResult, type ScriptedCall } from '../testing/model-results.ts';
import { stopping } from '../testing/resumed-attempts.ts';
import { answers, type ScriptedReply } from '../testing/scripted-language-model.ts';
import { defaultBounds, stepsOf, toolOf, type StepsOptions } from '../testing/step-runs.ts';
import { answeredAtALimit } from '../tools/tool-endings.ts';

const search = toolOf('graph', 'search');

const echo = toolOf('graph', 'echo', false);

function calls(tool: string, count: number, from = 0): readonly ScriptedCall[] {
  return Array.from({ length: count }, (_, call): ScriptedCall => [`graph__${tool}`, { query: `acme ${from + call}` }]);
}

function asking(...steps: readonly (readonly ScriptedCall[])[]): readonly ScriptedReply[] {
  return steps.map((each) => answers(toolCallsResult(each)));
}

const answered = answers(textResult('Acme has 2 rows.'));

const continuing = { ...defaultBounds, exitBehavior: 'continue' as const };

async function stepped(options: StepsOptions) {
  const steps = stepsOf({ tools: [search, echo], ...options });
  const { state, ending } = await Effect.runPromise(steps.stepping);
  return {
    ending: ending.type,
    counted: state.tally.counted,
    sent: steps.sends().length,
    offered: steps.requests().map(({ tools = [] }) => tools.length > 0),
    lastRequest: JSON.stringify(steps.requests().at(-1)),
    steps,
  };
}

const actingCallsMade =
  'This run has made all the 25 calls it may make of tools that can change things; answer from what you have.';

describe('the count of a run that sets no max_tool_calls', () => {
  it('counts no call of a tool marked reads, however many the run makes', async () => {
    const ran = await stepped({ replies: [...asking(calls('search', 120), calls('search', 80, 120)), answered] });

    expect([ran.ending, ran.counted, ran.sent]).toEqual(['answered', 0, 200]);
  });

  it('counts each call of a tool not marked reads as its fact records it, and goes on reading once it made 25', async () => {
    const ran = await stepped({
      replies: [...asking([...calls('echo', 25), ...calls('search', 5)], calls('search', 10, 5)), answered],
    });

    expect([ran.ending, ran.counted, ran.sent, ran.offered]).toEqual(['answered', 25, 40, [true, true, true]]);
  });

  it('ends at the step that asks for the twenty-sixth, sending none of its calls, reads among them', async () => {
    const ran = await stepped({ replies: asking(calls('echo', 20), [...calls('search', 3), ...calls('echo', 6, 20)]) });

    expect([ran.ending, ran.counted, ran.sent]).toEqual(['limit_reached', 26, 20]);
  });
});

describe('the count of a run that sets no max_tool_calls, under continue', () => {
  it('sends the calls within the count and every read, refuses the rest in words, and answers without tools', async () => {
    const ran = await stepped({
      bounds: continuing,
      replies: [...asking(calls('echo', 20), [...calls('echo', 7, 20), ...calls('search', 3)]), answered],
    });

    expect([ran.ending, ran.counted, ran.sent, ran.offered]).toEqual(['answered', 27, 28, [true, true, false]]);
    expect(ran.lastRequest.split(actingCallsMade)).toHaveLength(3);
  });

  it('offers the tools again after a step that made exactly the last call the count allows', async () => {
    const ran = await stepped({ bounds: continuing, replies: [...asking(calls('echo', 25)), answered] });

    expect([ran.ending, ran.counted, ran.offered]).toEqual(['answered', 25, [true, true]]);
  });
});

describe('the count of a run that sets no max_tool_calls, of calls that fail or repeat', () => {
  it('counts a call that fails, since it was started, and none refused as a repeat', async () => {
    const repeated: ScriptedCall = ['graph__echo', { query: 'acme' }];
    const ran = await stepped({
      replies: [...asking([repeated, repeated, repeated, ...calls('echo', 22)]), answered],
      send: () =>
        Effect.succeed({
          ended: {
            type: 'tool_call_failed',
            data: { because: 'arguments_refused', detail: 'No.', duration_ms: 1, jsonrpc_id: 1 },
          },
          reply: { text: 'No.', isError: true },
        }),
    });

    expect([ran.ending, ran.counted, ran.sent]).toEqual(['answered', 24, 24]);
  });
});

describe('the count of a run whose function sets max_tool_calls', () => {
  it('counts every call the model asks for, reads and refused repeats included', async () => {
    const repeated: ScriptedCall = ['graph__search', { query: 'acme' }];
    const ran = await stepped({
      bounds: { ...defaultBounds, count: callCountOf(5) },
      replies: [...asking([repeated, repeated, repeated], calls('search', 3)), answered],
    });

    expect([ran.ending, ran.counted, ran.sent]).toEqual(['limit_reached', 6, 2]);
  });

  it('takes one call and the answer after it, and ends at a second', async () => {
    const one = { ...defaultBounds, count: callCountOf(1) };
    const [within, past] = await Promise.all([
      stepped({ bounds: one, replies: [...asking(calls('search', 1)), answered] }),
      stepped({ bounds: one, replies: asking(calls('search', 1), calls('search', 1, 1)) }),
    ]);

    expect([within.ending, within.sent, past.ending, past.sent]).toEqual(['answered', 1, 'limit_reached', 1]);
  });

  it('takes a thousand calls, and refuses the thousand and first under continue', async () => {
    const thousand = { ...continuing, count: callCountOf(1000) };
    const ran = await stepped({
      bounds: thousand,
      replies: [...asking(calls('search', 600), calls('search', 401, 600)), answered],
    });

    expect([ran.ending, ran.counted, ran.sent, ran.offered]).toEqual(['answered', 1001, 1000, [true, true, false]]);
    expect(ran.lastRequest).toContain('This run has made all the 1000 tool calls it may; answer from what you have.');
  });
});

interface Recorded {
  readonly first: ReturnType<typeof stepsOf>;
  readonly startedAt: string;
  readonly calls: readonly RecordedCall[];
}

async function recorded(options: StepsOptions): Promise<Recorded> {
  const startedAt = new Date().toISOString();
  const first = stepsOf({ tools: [search, echo], ...options, before: { startedAt, modelCallsBefore: 0, calls: [] } });
  await Effect.runPromise(Effect.exit(first.stepping));
  return { first, startedAt, calls: first.journal.calls() };
}

function upToTheLast(all: readonly RecordedCall[], type: RecordedCall['type']): readonly RecordedCall[] {
  return all.slice(0, all.findLastIndex((call) => call.type === type) + 1);
}

function upToTheFirst(all: readonly RecordedCall[], type: RecordedCall['type']): readonly RecordedCall[] {
  return all.slice(0, all.findIndex((call) => call.type === type) + 1);
}

async function againOn(
  { first, startedAt }: Recorded,
  cut: readonly RecordedCall[],
  options: Pick<StepsOptions, 'tools' | 'replies' | 'bounds'>,
) {
  const again = stepsOf({ ...options, content: first.content, before: { startedAt, modelCallsBefore: 0, calls: cut } });
  return { again, ...(await Effect.runPromise(again.stepping)) };
}

async function resumedOn(
  first: Recorded,
  cut: readonly RecordedCall[],
  options: Pick<StepsOptions, 'tools' | 'replies' | 'bounds'>,
) {
  const { again, state, ending } = await againOn(first, cut, options);
  return { ending: ending.type, counted: state.tally.counted, sent: again.sends().length };
}

const nowActing = toolOf('graph', 'search', false);

describe('the count of a run performed again', () => {
  it('reaches the count of the attempt before from the calls its facts record, and ends at the same step', async () => {
    const first = await recorded({ replies: asking(calls('echo', 20), calls('echo', 6, 20)) });

    expect(
      await resumedOn(first, upToTheLast(first.calls, 'tool_call_answered'), {
        tools: [search, echo],
        replies: asking(calls('echo', 6, 20)),
      }),
    ).toEqual({ ending: 'limit_reached', counted: 26, sent: 0 });
  });

  it('counts a call by the mark its fact records, not the mark its tool has now', async () => {
    const first = await recorded({ replies: [...asking(calls('search', 25)), answered] });

    expect(
      await resumedOn(first, upToTheLast(first.calls, 'tool_call_answered'), {
        tools: [nowActing, echo],
        replies: [...asking(calls('echo', 25)), answered],
      }),
    ).toEqual({ ending: 'answered', counted: 25, sent: 25 });
  });

  it('counts a call not yet started by the mark its tool has now', async () => {
    const first = await recorded({ replies: [...asking(calls('search', 26)), answered] });

    expect(
      await resumedOn(first, upToTheFirst(first.calls, 'model_call_answered'), { tools: [nowActing], replies: [] }),
    ).toEqual({ ending: 'limit_reached', counted: 26, sent: 0 });
  });
});

describe('a step that asked past the count, performed again once one of its tools changed', () => {
  const pastTheCount = [...calls('search', 25), ...calls('echo', 25)];

  it('admits no call in place of one its first attempt sent, when that tool now declares it only reads', async () => {
    const first = await recorded({
      tools: [nowActing, echo],
      bounds: continuing,
      replies: [...asking(pastTheCount), answered],
    });
    const { again, state, ending } = await againOn(first, upToTheLast(first.calls, 'tool_call_answered'), {
      tools: [search, echo],
      bounds: continuing,
      replies: [answered],
    });

    expect([ending.type, state.tally.counted, again.sends()]).toEqual(['answered', 50, []]);
    expect(again.requests().map(({ tools = [] }) => tools.length)).toEqual([0]);
    expect(JSON.stringify(again.requests()).split(actingCallsMade)).toHaveLength(26);
  });

  it('admits no call in place of one its first attempt sent, when that tool is no longer offered', async () => {
    const first = await recorded({
      tools: [nowActing, echo],
      bounds: continuing,
      replies: [...asking(pastTheCount), answered],
    });

    expect(
      await resumedOn(first, upToTheLast(first.calls, 'tool_call_answered'), {
        tools: [echo],
        bounds: continuing,
        replies: [answered],
      }),
    ).toEqual({ ending: 'answered', counted: 50, sent: 0 });
  });
});

describe('a run performed again in a last step an earlier count made without tools', () => {
  it('is marked max_tool_calls, though the count it folds to now is not past, since its input tokens did not withhold the tools', async () => {
    const first = await recorded({
      bounds: { ...continuing, count: callCountOf(24) },
      replies: [...asking(calls('search', 25)), stopping],
    });
    const { state } = await againOn(first, first.calls, {
      tools: [search, echo],
      bounds: continuing,
      replies: [answered],
    });

    expect([state.lastFinal, state.tally.counted]).toEqual([true, 0]);
    expect(answeredAtALimit(state, continuing.limits)).toEqual({ reason: 'max_tool_calls' });
  });
});
