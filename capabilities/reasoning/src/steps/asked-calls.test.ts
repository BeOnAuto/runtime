import { setTimeout } from 'node:timers/promises';

import { actingCallsCount } from '@on.auto/tool-servers/policy';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { anthropicMessage, chatCompletion } from '../provider-testing/provider-replies.ts';
import { abortedWith, jsonResponse, recordingFetch, type Responder } from '../provider-testing/recording-fetch.ts';
import { anthropicToolCall } from '../provider-testing/tool-call-replies.ts';
import { accessFor, promptText } from '../testing/adapter-harness.ts';
import { budgetOf } from '../testing/input-budgets.ts';
import { type ScriptedCall, textResult, toolCallsResult } from '../testing/model-results.ts';
import { answers } from '../testing/scripted-language-model.ts';
import { answeredWith, defaultBounds, foundRows, stepsOf, stepToolBytes, toolOf } from '../testing/step-runs.ts';
import { noAsking, notAnObject } from './asked-calls.ts';
import { admittedAgain } from './call-admission.ts';
import type { StepTool } from './step-run.ts';

const search = toolOf('graph', 'search');

const echo = toolOf('graph', 'echo', false);

function firstThen(reply: object, last: object): Responder {
  return (_request, attempt) => jsonResponse(attempt === 1 ? reply : last);
}

function askingFor(...calls: readonly (readonly [string, string, unknown])[]): object {
  const reply = anthropicToolCall('graph__search', {});
  return { ...reply, content: calls.map(([id, name, input]) => ({ type: 'tool_use', id, name, input })) };
}

async function stepsThrough(model: string, environment: Readonly<Record<string, string>>, respond: Responder) {
  const recording = recordingFetch(respond);
  const { languageModel } = await accessFor(environment, { fetch: recording.fetch });
  const steps = stepsOf({ languageModel, tools: [search], model });
  await Effect.runPromise(steps.stepping);
  return { steps, second: JSON.stringify(recording.requests()[1]?.body) };
}

function searchingThen(then: Responder): Responder {
  return (request, attempt) =>
    attempt === 1 ? jsonResponse(anthropicToolCall('graph__search', { query: 'acme' })) : then(request, attempt);
}

const slowly = () => Effect.promise(() => setTimeout(300, answeredWith(foundRows)));

const searchSharedRoom: StepTool = {
  name: 'graph__search',
  description: 'Finds the rows of the graph that match a query.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  reference: { server: 'graph', tool: 'search' },
  readOnly: true,
  mostBytes: 16_777_216,
  start: ({ callId }) =>
    Promise.resolve({ call_id: callId, server: 'graph', tool: 'search', arguments_bytes: 2, read_only: true }),
};

function calling(reply: object) {
  return (_request: unknown, attempt: number) => jsonResponse(attempt === 1 ? reply : anthropicMessage('Acme.'));
}

async function roomsGiven(contextWindow: number | undefined, reply: object) {
  const { languageModel } = await accessFor(
    { ANTHROPIC_API_KEY: 'k' },
    { fetch: recordingFetch(calling(reply)).fetch },
  );
  const steps = stepsOf({
    languageModel,
    tools: [searchSharedRoom],
    prompt: { kind: 'prompt', instructions: 'Answer briefly', message: promptText },
    bounds: { ...defaultBounds, limits: { contextWindow, budget: budgetOf(2_000_000) } },
  });
  await Effect.runPromise(steps.stepping);
  return steps.sends().map(({ room }) => room);
}

function threeCalls(): object {
  const reply = anthropicToolCall('graph__search', { query: 'acme' });
  const content = [1, 2, 3].map((call) => ({
    type: 'tool_use',
    id: `toolu_call_${call}`,
    name: 'graph__search',
    input: { query: `acme ${call}` },
  }));
  return { ...reply, content };
}

describe('a call the model asks for of a tool the run does not offer', () => {
  it('is answered once, by the result of the model library, and never sent', async () => {
    const asked = askingFor(
      ['toolu_1', 'graph__nothing', { query: 'acme' }],
      ['toolu_2', 'graph__search', { query: 'acme' }],
    );
    const { steps, second } = await stepsThrough(
      'anthropic/claude-sonnet-4-5',
      { ANTHROPIC_API_KEY: 'k' },
      firstThen(asked, anthropicMessage('Acme has 2 rows.')),
    );

    expect(second.match(/"tool_use_id":"toolu_1"/gu)).toHaveLength(1);
    expect(second.match(/"tool_use_id":"toolu_2"/gu)).toHaveLength(1);
    expect(steps.sends().map(({ callId }) => callId)).toEqual(['toolu_2']);
    expect(steps.journal.recorded().find(({ type }) => type === 'model_call_answered')?.data).toMatchObject({
      tool_calls: [
        { call_id: 'toolu_1', tool: 'graph__nothing', server: '', arguments_sha256: 'digest of {"query":"acme"}' },
        { call_id: 'toolu_2', tool: 'search', server: 'graph', arguments_sha256: 'digest of {"query":"acme"}' },
      ],
    });
  });
});

describe('a call whose arguments do not parse', () => {
  it('is answered once, by the result of the model library, and never sent', async () => {
    const unparsed = {
      ...chatCompletion(''),
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'graph__search', arguments: '{"query":' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const { steps, second } = await stepsThrough(
      'openai/gpt-4o',
      { OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'https://proxy.example.com/v1', OPENAI_API: 'chat_completions' },
      firstThen(unparsed, chatCompletion('No rows.')),
    );

    expect(second.match(/"tool_call_id":"call_1"/gu)).toHaveLength(1);
    expect(steps.sends()).toEqual([]);
  });
});

describe('a call whose arguments are not an object', () => {
  it('is refused once in words, without calling the tool', async () => {
    const steps = stepsOf({
      tools: [search],
      replies: [answers(toolCallsResult([['graph__search', ['acme']]])), answers(textResult('No rows.'))],
    });
    await Effect.runPromise(steps.stepping);

    expect(steps.sends()).toEqual([]);
    expect(steps.requests()[1]?.conversation?.at(-1)).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'graph__search',
          output: { type: 'error-text', value: notAnObject },
        },
      ],
    });
  });
});

describe('the calls a run may make', () => {
  it('are refused past the twenty-fifth of a tool not marked reads when its function says continue, and once the same arguments were sent twice, in words and unsent', async () => {
    const many = Array.from({ length: 26 }, (_, call): ScriptedCall => ['graph__echo', { query: `acme ${call}` }]);
    const repeated: readonly ScriptedCall[] = [1, 2, 3].map(() => ['graph__search', { query: 'acme' }]);
    const tooMany = stepsOf({
      tools: [search, echo],
      replies: [answers(toolCallsResult(many)), answers(textResult('Done.'))],
      bounds: { ...defaultBounds, exitBehavior: 'continue' },
    });
    const again = stepsOf({
      tools: [search],
      replies: [answers(toolCallsResult(repeated)), answers(textResult('Done.'))],
    });
    await Effect.runPromise(Effect.all([tooMany.stepping, again.stepping]));

    expect([tooMany.sends().length, again.sends().length]).toEqual([25, 2]);
    expect(JSON.stringify(tooMany.requests().at(-1))).toContain(
      'This run has made all the 25 calls it may make of tools that can change things',
    );
    expect(JSON.stringify(again.requests().at(-1))).toContain('use the answer to the call call-2 instead');
  });

  it('send as many bytes of arguments as JSON as their tool server may be sent, and refuse one byte more in words that say to send less in one call', async () => {
    const fits = { query: 'x'.repeat(stepToolBytes - JSON.stringify({ query: '' }).length) };
    const steps = stepsOf({
      tools: [search],
      replies: [
        answers(toolCallsResult([['graph__search', fits]])),
        answers(toolCallsResult([['graph__search', { query: `${fits.query}x` }]])),
        answers(textResult('Done.')),
      ],
    });
    await Effect.runPromise(steps.stepping);

    expect(steps.sends().map(({ input }) => input)).toEqual([fits]);
    expect(steps.requests()[2]?.conversation?.at(-1)).toMatchObject({
      content: [
        {
          output: {
            type: 'error-text',
            value:
              'The arguments of this call take 1048577 bytes, more than the 1 MiB a call may send to a tool server; send less in one call, in parts where the tool takes them.',
          },
        },
      ],
    });
  });
});

describe('a call its run sent of a tool it no longer offers, admitted again', () => {
  it('keeps the answer its facts gave it, and counts it once by the mark its fact records', () => {
    const asked = [{ callId: 'call-1', tool: 'graph__search', input: { query: 'acme' } }];
    const answer = { type: 'tool-result', toolCallId: 'call-1', toolName: 'graph__search', output: 'Found 2 rows.' };
    const again = admittedAgain(
      { ...noAsking, asked, started: new Map([['call-1', false]]), results: new Map([['call-1', answer]]) },
      { offered: new Map(), count: actingCallsCount },
    );

    expect([again.tally.counted, again.asking.results.get('call-1'), again.asking.refused.size]).toEqual([
      1,
      answer,
      0,
    ]);
  });
});

describe('the model calls of a run that calls tools', () => {
  it('have each their own deadline, which the time of the tools does not count against', async () => {
    const recording = recordingFetch(searchingThen(() => jsonResponse(anthropicMessage('Done.'))));
    const { languageModel } = await accessFor({ ANTHROPIC_API_KEY: 'k' }, { fetch: recording.fetch });
    const steps = stepsOf({ languageModel, tools: [search], send: slowly, timeoutMs: 200 });

    expect(await Effect.runPromise(steps.stepping)).toMatchObject({ ending: { type: 'answered' } });
  });

  it('end one that misses its deadline as timed out, and give the provider up', async () => {
    const recording = recordingFetch(searchingThen(({ signal }) => abortedWith(signal)));
    const { languageModel } = await accessFor({ ANTHROPIC_API_KEY: 'k' }, { fetch: recording.fetch });
    const steps = stepsOf({ languageModel, tools: [search], timeoutMs: 100 });

    expect(await Effect.runPromise(steps.stepping)).toMatchObject({
      ending: { type: 'failed', data: { because: 'timed_out', number: 2 } },
    });
    expect(recording.requests().map(({ signal }) => signal.aborted)).toEqual([false, true]);
  });
});

describe('a call of a run whose model has a known context window', () => {
  it('gives the tool the room the window holds past the turn the provider counted, at the ratio the request measured, as before', async () => {
    expect(await roomsGiven(10_000, anthropicToolCall('graph__search', { query: 'acme' }))).toEqual([112_857]);
    expect(await roomsGiven(5021, anthropicToolCall('graph__search', { query: 'acme' }))).toEqual([56_428]);
  });

  it('gives a tool no room when the provider counted no input tokens of the turn, or the window is unknown', async () => {
    const uncounted = {
      ...anthropicToolCall('graph__search', { query: 'acme' }),
      usage: { input_tokens: 0, output_tokens: 0 },
    };

    expect(await roomsGiven(10_000, uncounted)).toEqual([undefined]);
    expect(await roomsGiven(undefined, anthropicToolCall('graph__search', { query: 'acme' }))).toEqual([undefined]);
  });
});

describe('the calls of one turn', () => {
  it('share the room of the turn equally, each given a third of it when there are three', async () => {
    expect(await roomsGiven(10_000, threeCalls())).toEqual([1, 2, 3].map(() => Math.floor(112_857 / 3)));
  });
});
