import { TimedOut, type ModelRequest } from '@on.auto/reasoning';
import { describe, expect, it } from 'vitest';

import {
  asking,
  LISTING,
  listed,
  MESSAGES,
  MODEL,
  REFUSED,
  resultOf,
  scripted,
  textsOf,
  toolsThat,
  turnOver,
  type Model,
  type Tools,
} from '../testing/index.ts';
import { MOST_MODEL_CALL_MS } from './call-bounds.ts';
import { turnOf } from './conversation-turn.ts';
import { retoldMessages, TOOLS_WITHDRAWN } from './retold-turn.ts';
import { NOT_AN_OBJECT, NOT_CALLED, OVER_THE_BOUND } from './tool-calls.ts';
import { MOST_TOOL_CALLS } from './turn-bounds.ts';

const requestAt = (requests: readonly ModelRequest[], index: number): ModelRequest => {
  const request = requests[index];
  if (request === undefined) throw new Error(`No request ${index} was sent`);
  return request;
};

const conversationOf = (request: ModelRequest | undefined): string => JSON.stringify(request?.conversation);

const askingEach = (length: number) =>
  Array.from({ length }, (_, index) => asking({ id: `c${index}`, tool: 'list_playbooks', input: {} }));

describe('a turn whose model asks for no tool', () => {
  it('answers the text of a model that asks for no tool, in one model call', async () => {
    const { model, requests } = scripted(resultOf('You have no playbooks'));
    const { tools } = toolsThat(listed);
    const ended = await turnOf(turnOver(model, tools));
    expect(ended).toEqual({ answer: 'You have no playbooks', bounded: false, modelCalls: 1, toolCalls: 0 });
    expect(requests).toEqual([
      {
        model: MODEL,
        instructions: 'You act for Pat',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'Hi, what can I do?' }] },
          { role: 'user', content: [{ type: 'text', text: 'List my playbooks' }] },
        ],
        tools: LISTING,
        output: { type: 'text' },
        settings: { max_output_tokens: 16_000 },
        timeout_ms: MOST_MODEL_CALL_MS,
        run_id: 'turn-1',
      },
    ]);
  });

  it('sends no tools where none is offered', async () => {
    const { model, requests } = scripted(resultOf('Done'));
    const { tools } = toolsThat(listed);
    await turnOf(turnOver(model, tools, []));
    expect(requests[0]).not.toHaveProperty('tools');
  });

  it('answers the text of a response it cannot read as one that asked for no tool', async () => {
    const { model } = scripted(resultOf('Plain words', [], 'not json'));
    const { tools } = toolsThat(listed);
    expect(await turnOf(turnOver(model, tools))).toMatchObject({ answer: 'Plain words', toolCalls: 0 });
  });
});

describe('a turn whose model asks for tools', () => {
  it('calls each tool the model asks for in turn and gives the model its results', async () => {
    const { model, requests } = scripted(
      asking(
        { id: 'c1', tool: 'list_playbooks', input: {} },
        { id: 'c2', tool: 'list_playbooks', input: { limit: 1 } },
      ),
      resultOf('Both are empty'),
    );
    const { tools, calls } = toolsThat(listed);
    const ended = await turnOf(turnOver(model, tools));
    expect(ended).toEqual({ answer: 'Both are empty', bounded: false, modelCalls: 2, toolCalls: 2 });
    expect(calls).toEqual([
      { name: 'list_playbooks', input: {} },
      { name: 'list_playbooks', input: { limit: 1 } },
    ]);
    expect(requests[1]?.conversation).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'c1', toolName: 'list_playbooks', input: {} },
          { type: 'tool-call', toolCallId: 'c2', toolName: 'list_playbooks', input: { limit: 1 } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'list_playbooks',
            output: { type: 'text', value: '{"playbooks":[]}' },
          },
          {
            type: 'tool-result',
            toolCallId: 'c2',
            toolName: 'list_playbooks',
            output: { type: 'text', value: '{"playbooks":[]}' },
          },
        ],
      },
    ]);
    expect(requests[1]?.tools).toEqual(LISTING);
  });
});

describe('a turn whose tool calls fail', () => {
  it('gives the model the error text of a tool that failed or was refused, and goes on', async () => {
    const { model, requests } = scripted(
      asking({ id: 'c1', tool: 'create_playbook', input: { playbook: 'sales' } }),
      resultOf('I could not create it'),
    );
    const { tools } = toolsThat(() => ({ text: 'The caller may not create playbooks', isError: true }));
    const ended = await turnOf(turnOver(model, tools));
    expect(ended).toMatchObject({ answer: 'I could not create it', toolCalls: 1 });
    expect(requests[1]?.conversation?.[1]).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'create_playbook',
          output: { type: 'error-text', value: 'The caller may not create playbooks' },
        },
      ],
    });
  });

  it('gives the model an error text where the call of a tool throws', async () => {
    const { model, requests } = scripted(asking({ id: 'c1', tool: 'list_playbooks', input: {} }), resultOf('Sorry'));
    const tools: Tools = { call: () => Promise.reject(new Error('the secret words of a failure')) };
    await turnOf(turnOver(model, tools));
    expect(conversationOf(requests[1])).toContain(NOT_CALLED);
    expect(conversationOf(requests[1])).not.toContain('secret');
  });

  it('sends no tool call whose arguments are no object, and counts it', async () => {
    const { model, requests } = scripted(asking({ id: 'c1', tool: 'list_playbooks', input: 'all' }), resultOf('Sorry'));
    const { tools, calls } = toolsThat(listed);
    const ended = await turnOf(turnOver(model, tools));
    expect(calls).toEqual([]);
    expect(ended).toMatchObject({ toolCalls: 1 });
    expect(conversationOf(requests[1])).toContain(NOT_AN_OBJECT);
  });
});

describe('a turn at the bound of its tool calls', () => {
  it(`asks once more with no tools after ${MOST_TOOL_CALLS} tool calls, retelling what the tools said`, async () => {
    const { model, requests } = scripted(...askingEach(MOST_TOOL_CALLS), resultOf('I stopped after listing'));
    const { tools, calls } = toolsThat(listed);
    const ended = await turnOf(turnOver(model, tools));
    expect(ended).toEqual({
      answer: 'I stopped after listing',
      bounded: true,
      modelCalls: MOST_TOOL_CALLS + 1,
      toolCalls: MOST_TOOL_CALLS,
    });
    expect(calls).toHaveLength(MOST_TOOL_CALLS);
    expect(requests.slice(0, MOST_TOOL_CALLS).every((request) => request.tools !== undefined)).toBe(true);
    const last = requestAt(requests, MOST_TOOL_CALLS);
    expect(last).not.toHaveProperty('tools');
    expect(last).not.toHaveProperty('conversation');
    expect(last.messages.map(({ role }) => role)).toEqual([
      'user',
      'assistant',
      'user',
      ...Array.from({ length: MOST_TOOL_CALLS }, () => ['assistant', 'user']).flat(),
    ]);
    const texts = textsOf(last);
    expect(texts[2]).toBe('List my playbooks');
    expect(texts.at(-1)?.endsWith(TOOLS_WITHDRAWN)).toBe(true);
    expect(texts.join('\n').split('{"playbooks":[]}')).toHaveLength(MOST_TOOL_CALLS + 1);
  });
});

describe('a turn past the bound of its tool calls', () => {
  it('retells what the model said beside the calls it made, and what a call that failed said', async () => {
    const asks = Array.from({ length: MOST_TOOL_CALLS }, (_, index) =>
      resultOf('', [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: `Step ${index}` },
            { type: 'tool-call', toolCallId: `c${index}`, toolName: 'create_playbook', input: { playbook: 'sales' } },
          ],
        },
      ]),
    );
    const { model, requests } = scripted(...asks, resultOf('Stopped'));
    const { tools } = toolsThat(() => ({ text: 'Refused', isError: true }));
    await turnOf(turnOver(model, tools));
    const told = textsOf(requestAt(requests, MOST_TOOL_CALLS)).join('\n');
    expect(told).toContain('Step 0\n');
    expect(told).toContain('{"playbook":"sales"}');
    expect(told).toContain('Refused');
  });

  it('refuses, unsent, the calls of one answer that go past the bound, and counts none of them', async () => {
    const { model, requests } = scripted(
      ...askingEach(MOST_TOOL_CALLS - 1),
      asking(
        { id: 'last', tool: 'list_playbooks', input: {} },
        { id: 'over', tool: 'list_playbooks', input: {} },
        { id: 'further', tool: 'list_playbooks', input: {} },
      ),
      resultOf('Stopped'),
    );
    const { tools, calls } = toolsThat(listed);
    const ended = await turnOf(turnOver(model, tools));
    expect(calls).toHaveLength(MOST_TOOL_CALLS);
    expect(ended).toMatchObject({ bounded: true, toolCalls: MOST_TOOL_CALLS, modelCalls: MOST_TOOL_CALLS + 1 });
    const told = textsOf(requestAt(requests, MOST_TOOL_CALLS)).at(-1);
    expect(told?.match(new RegExp(OVER_THE_BOUND.replaceAll('.', '\\.'), 'gu'))).toHaveLength(2);
  });
});

describe('a turn whose model gives no answer', () => {
  it('ends as bound_reached where the last call, made with no tools, answers nothing', async () => {
    const { model } = scripted(
      ...askingEach(MOST_TOOL_CALLS),
      asking({ id: 'again', tool: 'list_playbooks', input: {} }),
    );
    const { tools, calls } = toolsThat(listed);
    const ended = await turnOf(turnOver(model, tools));
    expect(ended).toEqual({ refused: 'bound_reached', modelCalls: MOST_TOOL_CALLS + 1, toolCalls: MOST_TOOL_CALLS });
    expect(calls).toHaveLength(MOST_TOOL_CALLS);
  });

  it('ends with the failure of a model that did not answer, and what it had spent', async () => {
    const failure = new TimedOut({ detail: 'The model did not answer in time', provider: 'auto', timeout_ms: 60_000 });
    const { model } = scripted(asking({ id: 'c1', tool: 'list_playbooks', input: {} }), () => ({ failed: failure }));
    const { tools } = toolsThat(listed);
    const ended = turnOver(model, tools);
    const { _tag: tag } = failure;
    expect(await turnOf(ended)).toEqual({ refused: 'model_unavailable', failure: tag, modelCalls: 2, toolCalls: 1 });
  });

  it.each(['', '  \n '])(
    'treats an answer of no text and no tool call as the model not having answered, %j',
    async (text) => {
      const { tools } = toolsThat(listed);
      const { model } = scripted(resultOf(text));
      expect(await turnOf(turnOver(model, tools))).toEqual({
        refused: 'model_unavailable',
        modelCalls: 1,
        toolCalls: 0,
      });
    },
  );
});

describe('a turn whose model refuses or throws', () => {
  it('ends with the refusal the model hands it, untouched, at the first model call and after a tool call', async () => {
    const { tools } = toolsThat(listed);
    const refusal = { refused: REFUSED } as const;
    const first = scripted(refusal);
    expect(await turnOf(turnOver(first.model, tools))).toEqual({ refused: REFUSED, modelCalls: 1, toolCalls: 0 });
    const middle = scripted(asking({ id: 'c1', tool: 'list_playbooks', input: {} }), refusal);
    expect(await turnOf(turnOver(middle.model, tools))).toEqual({ refused: REFUSED, modelCalls: 2, toolCalls: 1 });
  });

  it('ends as model_unavailable, with what it had spent, where a model call throws', async () => {
    const { tools } = toolsThat(listed);
    const throwing: Model = { name: MODEL, generate: () => Promise.reject(new Error('the words of a failure')) };
    expect(await turnOf(turnOver(throwing, tools))).toEqual({
      refused: 'model_unavailable',
      failure: 'thrown',
      modelCalls: 1,
      toolCalls: 0,
    });
  });
});

describe('the retelling of a step', () => {
  it('retells a step that said nothing and called nothing as nothing', () => {
    const told = retoldMessages(MESSAGES, [{ assistant: [], said: '', calls: [], sent: 0 }], 'fence');
    expect(told.map(({ role }) => role)).toEqual(['user', 'assistant', 'user']);
    expect(told.at(-1)?.content[0]?.text.endsWith(TOOLS_WITHDRAWN)).toBe(true);
  });
});
