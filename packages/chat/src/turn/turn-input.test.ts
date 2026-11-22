import type { ModelRequest } from '@on.auto/reasoning';
import { describe, expect, it } from 'vitest';

import {
  asking,
  LISTING,
  listed,
  resultOf,
  scripted,
  toolsThat,
  turnOver,
  usedTokens,
  withRequestBytes,
  withUnreportedOutput,
} from '../testing/index.ts';
import { turnOf } from './conversation-turn.ts';
import { RESULT_LEFT_OUT } from './request-fit.ts';
import { MOST_REQUEST_INPUT_TOKENS, MOST_TURN_INPUT_TOKENS } from './turn-input.ts';

const askingFor = (id: string) => asking({ id, tool: 'list_playbooks', input: {} });

const resultsOf = (request: ModelRequest): readonly string[] =>
  (request.conversation ?? []).flatMap((message) => {
    const content: unknown = message['content'];
    if (message['role'] !== 'tool' || !Array.isArray(content)) return [];
    return content.flatMap((part: unknown) => {
      const output = typeof part === 'object' && part !== null && 'output' in part ? part.output : undefined;
      const value = typeof output === 'object' && output !== null && 'value' in output ? output.value : undefined;
      return typeof value === 'string' ? [value] : [];
    });
  });

const rolesOf = (request: ModelRequest): readonly unknown[] =>
  (request.conversation ?? []).map((message) => message['role']);

const requestAt = (requests: readonly ModelRequest[], index: number): ModelRequest => {
  const request = requests[index];
  if (request === undefined) throw new Error(`No request ${index} was sent`);
  return request;
};

const tagged = (text: string) => ({ text, isError: false });

const repliesOf = (replies: readonly string[]) => {
  const left = [...replies];
  return () => tagged(left.shift() ?? '');
};

const longAnswer = (): string =>
  JSON.stringify([
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'x'.repeat(150_000) },
        { type: 'tool-call', toolCallId: 'c1', toolName: 'list_playbooks', input: {} },
      ],
    },
  ]);

describe('the input tokens of a turn, counted as the answers report them', () => {
  it('ends as bound_reached where the next call would pass the input tokens of a turn, counted as the answers report', async () => {
    const half = MOST_TURN_INPUT_TOKENS / 2 + 1;
    const { model, requests } = scripted(usedTokens(askingFor('c1'), half, 10, half));
    const { tools } = toolsThat(listed);
    const ended = await turnOf(turnOver(model, tools));
    expect(ended).toEqual({ refused: 'bound_reached', modelCalls: 1, toolCalls: 1 });
    expect(requests).toHaveLength(1);
  });

  it('asks again where the next call would stay within the input tokens of a turn', async () => {
    const { model } = scripted(usedTokens(askingFor('c1'), 1_000, 10, 2_000), resultOf('Done'));
    const { tools } = toolsThat(listed);
    expect(await turnOf(turnOver(model, tools))).toMatchObject({ answer: 'Done', modelCalls: 2 });
  });

  it('counts the bytes of the tool results into the next call', async () => {
    const heavy = 'x'.repeat(80_000);
    const { model, requests } = scripted(
      usedTokens(askingFor('c1'), 100, 10, 100),
      usedTokens(askingFor('c2'), 1_000_000, 10, 1_000_000),
      resultOf('Never'),
    );
    const { tools } = toolsThat(() => ({ text: heavy, isError: false }));
    expect(await turnOf(turnOver(model, tools))).toMatchObject({ refused: 'bound_reached', modelCalls: 2 });
    expect(requests).toHaveLength(2);
  });

  it('estimates the tokens of an answer that reports none from the bytes it was sent', async () => {
    const unreported = withRequestBytes(askingFor('c1'), MOST_TURN_INPUT_TOKENS * 2);
    const { model } = scripted(unreported, resultOf('Never'));
    const { tools } = toolsThat(listed);
    expect(await turnOf(turnOver(model, tools))).toMatchObject({ refused: 'bound_reached', modelCalls: 1 });
  });
});

describe('the token bound of a turn before its first call', () => {
  it('ends as bound_reached before the first model call where what is sent passes the bound of a call at a byte a token', async () => {
    const { model, requests } = scripted(resultOf('Never asked'));
    const { tools } = toolsThat(listed);
    const heavy = [{ role: 'user', text: 'x'.repeat(MOST_REQUEST_INPUT_TOKENS + 1) }] as const;
    const ended = await turnOf({ ...turnOver(model, tools), messages: heavy });
    expect(ended).toEqual({ refused: 'bound_reached', modelCalls: 0, toolCalls: 0 });
    expect(requests).toEqual([]);
  });

  it('sends the first model call where what is sent stays within the bound', async () => {
    const { model, requests } = scripted(resultOf('Fits'));
    const { tools } = toolsThat(listed);
    const lighter = [{ role: 'user', text: 'x'.repeat(MOST_REQUEST_INPUT_TOKENS - 20_000) }] as const;
    expect(await turnOf({ ...turnOver(model, tools), messages: lighter })).toMatchObject({ answer: 'Fits' });
    expect(requests).toHaveLength(1);
  });
});

describe('the token bound of a turn, estimated where an answer reports none', () => {
  it('estimates the input tokens of an answer that reports none at a byte a token', async () => {
    const asked = withRequestBytes(askingFor('c1'), Math.floor(MOST_TURN_INPUT_TOKENS * 0.6));
    const { model, requests } = scripted(asked, resultOf('Never'));
    const { tools } = toolsThat(listed);
    expect(await turnOf(turnOver(model, tools))).toMatchObject({ refused: 'bound_reached', modelCalls: 1 });
    expect(requests).toHaveLength(1);
  });

  it('keeps the input tokens an answer reports, however many bytes it was sent in', async () => {
    const reported = withRequestBytes(
      usedTokens(askingFor('c1'), 100_000, 10),
      Math.floor(MOST_TURN_INPUT_TOKENS * 0.6),
    );
    const { model } = scripted(reported, resultOf('Done'));
    const { tools } = toolsThat(listed);
    expect(await turnOf(turnOver(model, tools))).toMatchObject({ answer: 'Done', modelCalls: 2 });
  });

  it('estimates the output tokens of an answer that reports none from the bytes of the answer, at a byte a token', async () => {
    const answered = withUnreportedOutput(usedTokens(resultOf('', [], longAnswer()), 950_000, 0, 950_000));
    const { model } = scripted(answered, resultOf('Never'));
    const { tools } = toolsThat(listed);
    expect(await turnOf(turnOver(model, tools))).toMatchObject({ refused: 'bound_reached', modelCalls: 1 });
  });

  it('keeps the output tokens an answer reports', async () => {
    const { model } = scripted(usedTokens(resultOf('', [], longAnswer()), 950_000, 50, 950_000), resultOf('Done'));
    const { tools } = toolsThat(listed);
    expect(await turnOf(turnOver(model, tools))).toMatchObject({ answer: 'Done', modelCalls: 2 });
  });
});

describe('the input bound of a turn against the bound of a call', () => {
  it('continues a turn of six calls that each read about 50,000 input tokens', async () => {
    const asks = [1, 2, 3, 4, 5].map((index) => usedTokens(askingFor(`c${index}`), 50_000, 10, 150_000));
    const { model, requests } = scripted(...asks, usedTokens(resultOf('Done'), 50_000, 10, 150_000));
    const { tools } = toolsThat(listed);
    expect(await turnOf(turnOver(model, tools))).toMatchObject({ answer: 'Done', modelCalls: 6, toolCalls: 5 });
    expect(requests).toHaveLength(6);
  });

  it('ends as bound_reached where the next call would pass the 2,000,000 input tokens of a turn', async () => {
    const asks = Array.from({ length: 12 }, (_, index) => usedTokens(askingFor(`c${index}`), 190_000, 10, 190_000));
    const { model, requests } = scripted(...asks);
    const { tools } = toolsThat(listed);
    expect(await turnOf(turnOver(model, tools))).toEqual({ refused: 'bound_reached', modelCalls: 10, toolCalls: 10 });
    expect(requests).toHaveLength(10);
  });

  it('ends as bound_reached where the request still passes the bound of a call with only the newest result left', async () => {
    const { model, requests } = scripted(askingFor('c1'), askingFor('c2'), resultOf('Never'));
    const { tools } = toolsThat(repliesOf(['small', 'z'.repeat(MOST_REQUEST_INPUT_TOKENS + 1)]));
    expect(await turnOf(turnOver(model, tools))).toEqual({ refused: 'bound_reached', modelCalls: 2, toolCalls: 2 });
    expect(requests).toHaveLength(2);
  });
});

describe('the results a request leaves out to fit the bound of a call', () => {
  it('leaves out the oldest tool results of a request that passes the bound of a call, and keeps the newest', async () => {
    const results = ['a', 'b', 'c', 'd'].map((letter) => letter.repeat(70_000));
    const asks = [askingFor('c1'), askingFor('c2'), askingFor('c3'), askingFor('c4')];
    const { model, requests } = scripted(...asks, resultOf('Done'));
    const { tools } = toolsThat(repliesOf(results));
    expect(await turnOf(turnOver(model, tools))).toMatchObject({ answer: 'Done', modelCalls: 5, toolCalls: 4 });
    expect(resultsOf(requestAt(requests, 2))).toEqual(results.slice(0, 2));
    expect(resultsOf(requestAt(requests, 3))).toEqual([RESULT_LEFT_OUT, results[1], results[2]]);
    expect(resultsOf(requestAt(requests, 4))).toEqual([RESULT_LEFT_OUT, RESULT_LEFT_OUT, results[2], results[3]]);
  });

  it('leaves out the oldest result of a step that called two tools, and keeps the other', async () => {
    const both = asking(
      { id: 'c1', tool: 'list_playbooks', input: {} },
      { id: 'c2', tool: 'list_playbooks', input: {} },
    );
    const { model, requests } = scripted(both, resultOf('Done'));
    const { tools } = toolsThat(repliesOf(['a'.repeat(95_000), 'b'.repeat(95_000)]));
    expect(await turnOf(turnOver(model, tools))).toMatchObject({ answer: 'Done', modelCalls: 2, toolCalls: 2 });
    expect(resultsOf(requestAt(requests, 1))).toEqual([RESULT_LEFT_OUT, 'b'.repeat(95_000)]);
  });

  it('keeps every message of the conversation, the instructions and the order of the steps where it leaves results out', async () => {
    const asks = [askingFor('c1'), askingFor('c2'), askingFor('c3'), askingFor('c4')];
    const { model, requests } = scripted(...asks, resultOf('Done'));
    const { tools } = toolsThat(() => tagged('y'.repeat(70_000)));
    await turnOf(turnOver(model, tools));
    const last = requestAt(requests, requests.length - 1);
    expect(last.messages).toEqual(requestAt(requests, 0).messages);
    expect(last.instructions).toBe('You act for Pat');
    expect(last.tools).toEqual(LISTING);
    expect(rolesOf(last)).toEqual(['assistant', 'tool', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'tool']);
  });
});
