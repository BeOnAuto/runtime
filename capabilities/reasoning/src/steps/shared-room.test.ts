import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { anthropicMessage } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { anthropicToolCall } from '../provider-testing/tool-call-replies.ts';
import { accessFor, promptText } from '../testing/adapter-harness.ts';
import { defaultBounds, stepsOf } from '../testing/step-runs.ts';
import type { StepTool } from './step-run.ts';

const search: StepTool = {
  name: 'graph__search',
  description: 'Finds the rows of the graph that match a query.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  reference: { server: 'graph', tool: 'search' },
  readOnly: true,
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
    tools: [search],
    prompt: { kind: 'prompt', instructions: 'Answer briefly', message: promptText },
    bounds: { ...defaultBounds, limits: { contextWindow, mostInputTokens: 2_000_000 } },
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
