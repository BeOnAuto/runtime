import { setTimeout } from 'node:timers/promises';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { anthropicMessage } from '../provider-testing/provider-replies.ts';
import { abortedWith, jsonResponse, recordingFetch, type Responder } from '../provider-testing/recording-fetch.ts';
import { anthropicToolCall } from '../provider-testing/tool-call-replies.ts';
import { accessFor } from '../testing/adapter-harness.ts';
import { answeredWith, foundRows, stepsOf, toolOf } from '../testing/step-runs.ts';

const search = toolOf('graph', 'search');

function searchingThen(then: Responder): Responder {
  return (request, attempt) =>
    attempt === 1 ? jsonResponse(anthropicToolCall('graph__search', { query: 'acme' })) : then(request, attempt);
}

const slowly = () => Effect.promise(() => setTimeout(300, answeredWith(foundRows)));

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
