import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { anthropicMessage, chatCompletion } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch, type Responder } from '../provider-testing/recording-fetch.ts';
import { anthropicToolCall } from '../provider-testing/tool-call-replies.ts';
import { accessFor } from '../testing/adapter-harness.ts';
import { textResult, toolCallsResult, type ScriptedCall } from '../testing/model-results.ts';
import { answers } from '../testing/scripted-language-model.ts';
import { stepsOf, toolOf } from '../testing/step-runs.ts';
import { notAnObject } from './asked-calls.ts';

const search = toolOf('graph', 'search');

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
  it('are refused past the twenty-fifth, and once the same arguments were sent twice, in words and unsent', async () => {
    const many = Array.from({ length: 26 }, (_, call): ScriptedCall => ['graph__search', { query: `acme ${call}` }]);
    const repeated: readonly ScriptedCall[] = [1, 2, 3].map(() => ['graph__search', { query: 'acme' }]);
    const tooMany = stepsOf({
      tools: [search],
      replies: [answers(toolCallsResult(many)), answers(textResult('Done.'))],
    });
    const again = stepsOf({
      tools: [search],
      replies: [answers(toolCallsResult(repeated)), answers(textResult('Done.'))],
    });
    await Effect.runPromise(Effect.all([tooMany.stepping, again.stepping]));

    expect([tooMany.sends().length, again.sends().length]).toEqual([25, 2]);
    expect(JSON.stringify(tooMany.requests().at(-1))).toContain('This run has made all the 25 tool calls it may');
    expect(JSON.stringify(again.requests().at(-1))).toContain('use the answer to the call call-2 instead');
  });
});
