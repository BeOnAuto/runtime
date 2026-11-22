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
  toolsThat,
  turnOver,
  type Answered,
  type Answering,
  type Model,
  type Tools,
} from '../testing/index.ts';
import { MOST_MODEL_CALL_MS, MOST_TOOL_CALL_MS } from './call-bounds.ts';
import { TIMED_OUT, turnOf } from './conversation-turn.ts';
import { TOOL_TIMED_OUT } from './tool-calls.ts';
import { MOST_TURN_MS } from './turn-bounds.ts';

const twoCalls = () =>
  asking({ id: 'c1', tool: 'list_playbooks', input: {} }, { id: 'c2', tool: 'list_playbooks', input: {} });

function signalsSeen() {
  const seen: Readonly<AbortSignal>[] = [];
  const keep = (signal: Readonly<AbortSignal> | undefined): void => {
    if (signal !== undefined) seen.push(signal);
  };
  return { seen, keep };
}

function modelStalling(neverAnswering: () => Promise<Answered>, first?: Answering) {
  const requests: ModelRequest[] = [];
  const { seen, keep } = signalsSeen();
  const model: Model = {
    name: MODEL,
    generate: (request, signal) => {
      requests.push(request);
      keep(signal);
      return first !== undefined && requests.length === 1 ? Promise.resolve(first) : neverAnswering();
    },
  };
  return { model, requests, seen };
}

function toolsStalling(neverAnswering: () => Promise<never>, answeringTheFirst?: () => void) {
  const calls: string[] = [];
  const { seen, keep } = signalsSeen();
  const tools: Tools = {
    call: (name, _input, signal) => {
      calls.push(name);
      keep(signal);
      if (answeringTheFirst === undefined || calls.length > 1) return neverAnswering();
      answeringTheFirst();
      return Promise.resolve(listed());
    },
  };
  return { tools, calls, seen };
}

describe('a turn whose model call stalls', () => {
  it('ends a model call that never answers at its cap, as model_unavailable, with one ending and no wait left', async () => {
    const clock = manualClock();
    const { stalled, neverAnswering } = stalling();
    const { model, requests } = modelStalling(neverAnswering);
    const { tools } = toolsThat(listed);
    const running = turnOf({ ...turnOver(model, tools), now: clock.now, waits: clock.waits });
    await stalled();
    expect(requests[0]?.timeout_ms).toBe(MOST_MODEL_CALL_MS);
    clock.advance(MOST_MODEL_CALL_MS - 1);
    expect(clock.pending.size).toBe(1);
    clock.advance(1);
    expect(await running).toEqual({ refused: 'model_unavailable', failure: TIMED_OUT, modelCalls: 1, toolCalls: 0 });
    expect(clock.pending.size).toBe(0);
  });

  it('ends a model call that never answers at the deadline, as bound_reached, where the deadline is nearer than its cap', async () => {
    const clock = manualClock();
    const { stalled, neverAnswering } = stalling();
    const { model, requests } = modelStalling(neverAnswering, asking({ id: 'c1', tool: 'list_playbooks', input: {} }));
    const { tools } = toolsThat(() => {
      clock.advance(MOST_TURN_MS - 10_000);
      return listed();
    });
    const running = turnOf({ ...turnOver(model, tools), now: clock.now, waits: clock.waits });
    await stalled();
    expect(requests[1]?.timeout_ms).toBe(10_000);
    clock.advance(10_000);
    expect(await running).toEqual({ refused: 'bound_reached', modelCalls: 2, toolCalls: 1 });
    expect(clock.pending.size).toBe(0);
  });
});

describe('a turn whose model call stalls when its client disconnects', () => {
  it('aborts and abandons a model call that stalls when the client disconnects, and starts nothing further', async () => {
    const clock = manualClock();
    const disconnect = new AbortController();
    const { stalled, neverAnswering } = stalling();
    const { model, requests, seen } = modelStalling(neverAnswering);
    const { tools, calls } = toolsThat(listed);
    const running = turnOf({
      ...turnOver(model, tools),
      now: clock.now,
      waits: clock.waits,
      signal: disconnect.signal,
      closed: () => disconnect.signal.aborted,
    });
    await stalled();
    disconnect.abort();
    expect(await running).toEqual({ closed: true, modelCalls: 1, toolCalls: 0 });
    expect(seen[0]?.aborted).toBe(true);
    expect(requests).toHaveLength(1);
    expect(calls).toEqual([]);
    expect(clock.pending.size).toBe(0);
  });
});

describe('a turn whose tool call stalls', () => {
  it('tells the model a tool call that never answered failed at its cap, and goes on', async () => {
    const clock = manualClock();
    const { stalled, neverAnswering } = stalling();
    const { model, requests } = scripted(
      asking({ id: 'c1', tool: 'list_playbooks', input: {} }),
      resultOf('Went on without it'),
    );
    const tools: Tools = { call: neverAnswering };
    const running = turnOf({ ...turnOver(model, tools), now: clock.now, waits: clock.waits });
    await stalled();
    clock.advance(MOST_TOOL_CALL_MS);
    expect(await running).toEqual({ answer: 'Went on without it', bounded: false, modelCalls: 2, toolCalls: 1 });
    expect(requests[1]?.conversation?.at(-1)).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'list_playbooks',
          output: { type: 'error-text', value: TOOL_TIMED_OUT },
        },
      ],
    });
  });

  it('ends a tool call that never answers at the deadline as bound_reached where the deadline is nearer than its cap', async () => {
    const clock = manualClock();
    const { stalled, neverAnswering } = stalling();
    const { model, requests } = scripted(twoCalls());
    const { tools } = toolsStalling(neverAnswering, () => {
      clock.advance(MOST_TURN_MS - 5_000);
    });
    const running = turnOf({ ...turnOver(model, tools), now: clock.now, waits: clock.waits });
    await stalled();
    clock.advance(5_000);
    expect(await running).toEqual({ refused: 'bound_reached', modelCalls: 1, toolCalls: 2 });
    expect(requests).toHaveLength(1);
    expect(clock.pending.size).toBe(0);
  });
});

describe('a turn whose tool call stalls when its client disconnects', () => {
  it('aborts and abandons a tool call that stalls when the client disconnects, and starts nothing further', async () => {
    const clock = manualClock();
    const disconnect = new AbortController();
    const { stalled, neverAnswering } = stalling();
    const { model, requests } = scripted(twoCalls());
    const { tools, calls, seen } = toolsStalling(neverAnswering);
    const running = turnOf({
      ...turnOver(model, tools),
      now: clock.now,
      waits: clock.waits,
      signal: disconnect.signal,
      closed: () => disconnect.signal.aborted,
    });
    await stalled();
    disconnect.abort();
    expect(await running).toEqual({ closed: true, modelCalls: 1, toolCalls: 1 });
    expect(seen[0]?.aborted).toBe(true);
    expect(calls).toEqual(['list_playbooks']);
    expect(requests).toHaveLength(1);
    expect(clock.pending.size).toBe(0);
  });
});

describe('a turn whose tool call or admission passes its cap', () => {
  it('gives up a tool call at its cap by aborting it', async () => {
    const clock = manualClock();
    const { stalled, neverAnswering } = stalling();
    const { model } = scripted(asking({ id: 'c1', tool: 'list_playbooks', input: {} }), resultOf('Done'));
    const { tools, seen } = toolsStalling(neverAnswering);
    const running = turnOf({ ...turnOver(model, tools), now: clock.now, waits: clock.waits });
    await stalled();
    expect(seen[0]?.aborted).toBe(false);
    clock.advance(MOST_TOOL_CALL_MS);
    await running;
    expect(seen[0]?.aborted).toBe(true);
  });

  it('ends as not_admitted where the admission never answers within its cap', async () => {
    const clock = manualClock();
    const { stalled, neverAnswering } = stalling();
    const { model } = scripted(asking({ id: 'c1', tool: 'list_playbooks', input: {} }));
    const { tools, calls } = toolsThat(listed);
    const running = turnOf({ ...turnOver(model, tools), admitted: neverAnswering, now: clock.now, waits: clock.waits });
    await stalled();
    clock.advance(MOST_TOOL_CALL_MS);
    expect(await running).toEqual({ refused: 'not_admitted', modelCalls: 1, toolCalls: 0 });
    expect(calls).toEqual([]);
  });
});

describe('a turn whose admission is asked when its client disconnects', () => {
  it('ends as closed, with no tool call, where the client disconnects while the admission is asked', async () => {
    const clock = manualClock();
    const disconnect = new AbortController();
    const { stalled, neverAnswering } = stalling();
    const { model } = scripted(asking({ id: 'c1', tool: 'list_playbooks', input: {} }));
    const { tools, calls } = toolsThat(listed);
    const running = turnOf({
      ...turnOver(model, tools),
      admitted: neverAnswering,
      now: clock.now,
      waits: clock.waits,
      signal: disconnect.signal,
      closed: () => disconnect.signal.aborted,
    });
    await stalled();
    disconnect.abort();
    expect(await running).toEqual({ closed: true, modelCalls: 1, toolCalls: 0 });
    expect(calls).toEqual([]);
  });
});
