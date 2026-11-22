import type { ModelRequest } from '@on.auto/reasoning';
import { describe, expect, it } from 'vitest';

import {
  asking,
  listed,
  manualClock,
  MODEL,
  resultOf,
  scripted,
  stalling,
  textsOf,
  toolsThat,
  turnOver,
  type Model,
  type Tools,
} from '../testing/index.ts';
import { modelCallMsFor } from './call-bounds.ts';
import { TIMED_OUT, turnOf } from './conversation-turn.ts';
import { overTheBound, TOOL_TIMED_OUT } from './tool-calls.ts';
import { TURN_BOUNDS, type TurnBounds } from './turn-bounds.ts';

const requestAt = (requests: readonly ModelRequest[], index: number): ModelRequest => {
  const request = requests[index];
  if (request === undefined) throw new Error(`No request ${index} was sent`);
  return request;
};

describe('the bounds of a turn', () => {
  it('ship with the figures of the cloud today', () => {
    expect(TURN_BOUNDS).toEqual({
      toolCalls: 25,
      turnMs: 600_000,
      modelCallMs: 460_000,
      toolCallMs: 30_000,
      turnInputTokens: 2_000_000,
      requestInputTokens: 180_000,
      outputTokens: 16_000,
    });
  });

  it('ask once more with no tools after the tool calls they are given, and refuse the calls past them', async () => {
    const { model, requests } = scripted(
      asking({ id: 'c1', tool: 'list_playbooks', input: {} }),
      asking({ id: 'c2', tool: 'list_playbooks', input: {} }, { id: 'c3', tool: 'list_playbooks', input: {} }),
      resultOf('Stopped'),
    );
    const { tools, calls } = toolsThat(listed);
    const ended = await turnOf({ ...turnOver(model, tools), bounds: { toolCalls: 2 } });
    expect(ended).toEqual({ answer: 'Stopped', bounded: true, modelCalls: 3, toolCalls: 2 });
    expect(calls).toHaveLength(2);
    expect(requests[2]).not.toHaveProperty('tools');
    expect(textsOf(requestAt(requests, 2)).at(-1)).toContain(overTheBound(2));
  });

  it('ask for the output tokens they are given, and give a model call the time those tokens take', async () => {
    const { model, requests } = scripted(resultOf('Done'));
    const { tools } = toolsThat(listed);
    await turnOf({ ...turnOver(model, tools), bounds: { outputTokens: 1_000 } });
    expect(requests[0]?.settings.max_output_tokens).toBe(1_000);
    expect(requests[0]?.timeout_ms).toBe(modelCallMsFor(1_000));
  });
});

describe('the caps of the calls of a turn', () => {
  it('end a model call at the cap they are given', async () => {
    const clock = manualClock();
    const { stalled, neverAnswering } = stalling();
    const model: Model = { name: MODEL, generate: neverAnswering };
    const { tools } = toolsThat(listed);
    const bounds = { modelCallMs: 3 };
    const running = turnOf({ ...turnOver(model, tools), now: clock.now, waits: clock.waits, bounds });
    await stalled();
    clock.advance(3);
    expect(await running).toEqual({ refused: 'model_unavailable', failure: TIMED_OUT, modelCalls: 1, toolCalls: 0 });
  });

  it('give up a tool call at the cap they are given', async () => {
    const clock = manualClock();
    const { stalled, neverAnswering } = stalling();
    const { model, requests } = scripted(asking({ id: 'c1', tool: 'list_playbooks', input: {} }), resultOf('Done'));
    const tools: Tools = { call: neverAnswering };
    const bounds = { toolCallMs: 3 };
    const running = turnOf({ ...turnOver(model, tools), now: clock.now, waits: clock.waits, bounds });
    await stalled();
    clock.advance(3);
    expect(await running).toMatchObject({ answer: 'Done' });
    expect(JSON.stringify(requests[1]?.conversation)).toContain(TOOL_TIMED_OUT);
  });

  it('start no call past the time of a turn they are given', async () => {
    const clock = { at: 0 };
    const { model, requests } = scripted(asking({ id: 'c1', tool: 'list_playbooks', input: {} }), resultOf('Never'));
    const { tools } = toolsThat(() => {
      clock.at += 3;
      return listed();
    });
    const ended = await turnOf({ ...turnOver(model, tools), now: () => clock.at, bounds: { turnMs: 3 } });
    expect(ended).toEqual({ refused: 'bound_reached', modelCalls: 1, toolCalls: 1 });
    expect(requests).toHaveLength(1);
  });
});

describe('the input bounds of a turn', () => {
  it.each<readonly [string, Partial<TurnBounds>]>([
    ['the input tokens of a call', { requestInputTokens: 3 }],
    ['the input tokens of a turn', { turnInputTokens: 3 }],
  ])('end it as bound_reached past %s they are given', async (_bound, bounds) => {
    const { model, requests } = scripted(resultOf('Never'));
    const { tools } = toolsThat(listed);
    expect(await turnOf({ ...turnOver(model, tools), bounds })).toEqual({
      refused: 'bound_reached',
      modelCalls: 0,
      toolCalls: 0,
    });
    expect(requests).toEqual([]);
  });
});
