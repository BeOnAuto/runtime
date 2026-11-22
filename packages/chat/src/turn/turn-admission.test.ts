import { TimedOut } from '@on.auto/reasoning';
import { describe, expect, it } from 'vitest';

import { asking, listed, resultOf, scripted, toolsThat, turnOver } from '../testing/index.ts';
import { turnOf } from './conversation-turn.ts';
import { MOST_TURN_MS } from './turn-bounds.ts';

const twoCalls = () =>
  asking({ id: 'c1', tool: 'list_playbooks', input: {} }, { id: 'c2', tool: 'list_playbooks', input: {} });

const throwing = (): boolean => {
  throw new Error('the words of a failure');
};

function admittedOnce() {
  const admissions = { asked: 0 };
  const admitted = () => {
    admissions.asked += 1;
    return Promise.resolve(admissions.asked < 2);
  };
  return { admitted, admissions };
}

describe('the time of a turn', () => {
  it('starts no model call and no tool call past 10 minutes from the first model call', async () => {
    const clock = { at: 1_000 };
    const { model, requests } = scripted(
      asking({ id: 'c1', tool: 'list_playbooks', input: {} }),
      asking({ id: 'c2', tool: 'list_playbooks', input: {} }),
      resultOf('Never asked'),
    );
    const { tools, calls } = toolsThat(() => {
      clock.at += MOST_TURN_MS;
      return listed();
    });
    const ended = await turnOf({ ...turnOver(model, tools), now: () => clock.at });
    expect(ended).toEqual({ refused: 'bound_reached', modelCalls: 1, toolCalls: 1 });
    expect(calls).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('ends as bound_reached where the model answers that it timed out at the deadline of the turn', async () => {
    const clock = { at: 0 };
    const failure = new TimedOut({ detail: 'The model did not answer in time', provider: 'auto', timeout_ms: 10_000 });
    const { model } = scripted(asking({ id: 'c1', tool: 'list_playbooks', input: {} }), () => ({ failed: failure }));
    const { tools } = toolsThat(() => {
      clock.at += MOST_TURN_MS - 10_000;
      return listed();
    });
    const ended = await turnOf({ ...turnOver(model, tools), now: () => clock.at });
    expect(ended).toEqual({ refused: 'bound_reached', modelCalls: 2, toolCalls: 1 });
  });

  it('keeps going one millisecond before the deadline', async () => {
    const clock = { at: 0 };
    const { model } = scripted(asking({ id: 'c1', tool: 'list_playbooks', input: {} }), resultOf('Done'));
    const { tools } = toolsThat(() => {
      clock.at += MOST_TURN_MS - 1;
      return listed();
    });
    expect(await turnOf({ ...turnOver(model, tools), now: () => clock.at })).toMatchObject({ answer: 'Done' });
  });
});

describe('the deadline of a turn between its tool calls', () => {
  it('sends no tool call of an answer once the deadline passed between two of its calls', async () => {
    const clock = { at: 0 };
    const { model } = scripted(twoCalls());
    const { tools, calls } = toolsThat(() => {
      clock.at += MOST_TURN_MS;
      return listed();
    });
    const ended = await turnOf({ ...turnOver(model, tools), now: () => clock.at });
    expect(ended).toEqual({ refused: 'bound_reached', modelCalls: 1, toolCalls: 1 });
    expect(calls).toHaveLength(1);
  });

  it('starts no further call once its client closed', async () => {
    const state = { closed: false };
    const { model, requests } = scripted(twoCalls());
    const { tools, calls } = toolsThat(() => {
      state.closed = true;
      return listed();
    });
    const ended = await turnOf({ ...turnOver(model, tools), closed: () => state.closed });
    expect(ended).toEqual({ closed: true, modelCalls: 1, toolCalls: 1 });
    expect(calls).toHaveLength(1);
    expect(requests).toHaveLength(1);
    const before = scripted(resultOf('Never'));
    expect(await turnOf({ ...turnOver(before.model, tools), closed: () => true })).toEqual({
      closed: true,
      modelCalls: 0,
      toolCalls: 0,
    });
    expect(before.requests).toEqual([]);
  });
});

describe('the admission of a turn before each tool call', () => {
  it('asks the admission before each tool call, and ends as not_admitted with no further call where it refuses', async () => {
    const { model, requests } = scripted(twoCalls(), resultOf('Never asked'));
    const { tools, calls } = toolsThat(listed);
    const { admitted, admissions } = admittedOnce();
    const ended = await turnOf({ ...turnOver(model, tools), admitted });
    expect(ended).toEqual({ refused: 'not_admitted', modelCalls: 1, toolCalls: 1 });
    expect(admissions.asked).toBe(2);
    expect(calls).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('ends as credential_expired, with no tool call, where the admission says the credential ran out', async () => {
    const { model, requests } = scripted(asking({ id: 'c1', tool: 'list_playbooks', input: {} }), resultOf('Never'));
    const { tools, calls } = toolsThat(listed);
    const ended = await turnOf({ ...turnOver(model, tools), admitted: () => Promise.resolve('credential_expired') });
    expect(ended).toEqual({ refused: 'credential_expired', modelCalls: 1, toolCalls: 0 });
    expect(calls).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it('ends as not_admitted where the admission cannot be asked', async () => {
    const { model } = scripted(asking({ id: 'c1', tool: 'list_playbooks', input: {} }));
    const { tools, calls } = toolsThat(listed);
    expect(
      await turnOf({ ...turnOver(model, tools), admitted: () => Promise.reject(new Error('the words of a failure')) }),
    ).toEqual({ refused: 'not_admitted', modelCalls: 1, toolCalls: 0 });
    expect(calls).toEqual([]);
  });
});

describe('a turn whose own parts throw', () => {
  it('ends as model_unavailable, with nothing spent, where a part it is handed throws before its first model call', async () => {
    const { model, requests } = scripted(resultOf('Never'));
    const { tools } = toolsThat(listed);
    expect(await turnOf({ ...turnOver(model, tools), closed: throwing })).toEqual({
      refused: 'model_unavailable',
      failure: 'thrown',
      modelCalls: 0,
      toolCalls: 0,
    });
    expect(requests).toEqual([]);
  });
});
