import { recordingJournal } from '@on.auto/definitions/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { describingGateway } from '../provider-testing/answers-in-turn.ts';
import { chatCompletion } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { accessFor } from '../testing/adapter-harness.ts';
import { documentOf } from '../testing/definition-documents.ts';
import { reasoningAdapter, runContextWith } from '../testing/reasoning-runs.ts';
import type { ModelReading } from './definition-request.ts';

const withoutStructuredOutputs = {
  MODEL_GATEWAYS: JSON.stringify([{ name: 'internal', base_url: 'https://llm.internal.example/v1' }]),
};

const deciding = documentOf(
  [
    'model: internal/llama-3.3-70b',
    'output:',
    '  format: json',
    '  schema: {type: object, properties: {verdict: {type: string}}, required: [verdict], additionalProperties: false}',
  ].join('\n'),
);

const usageOfBoth = {
  input: { total: 38, uncached: 32, cache_read: 6, cache_write: null },
  output: { total: 20, text: 20, reasoning: 0 },
  total: 58,
};

async function runAnswered(texts: readonly string[], reading?: ModelReading) {
  const recording = recordingFetch((_request, attempt) => jsonResponse(chatCompletion(texts[attempt - 1] ?? '')));
  const { languageModel } = await accessFor(withoutStructuredOutputs, { fetch: recording.fetch });
  const capability = reasoningAdapter({
    languageModel,
    offered: { providers: ['internal'], aliases: [] },
    ...(reading === undefined ? {} : { reading }),
  });
  const journal = recordingJournal();
  const prepared = Effect.runSync(capability.prepare(deciding));
  const exit = await Effect.runPromiseExit(prepared.run({ text: 'the renewal' }, runContextWith(journal)));
  return { exit, facts: journal.recorded(), requests: recording.requests() };
}

describe('a run whose model answers JSON that misses its schema, and then JSON that meets it', () => {
  it('answers the corrected JSON, recording one model call, answered with the correction and the usage of both requests', async () => {
    const { exit, facts } = await runAnswered(['{"verdict":true}', '{"verdict":"approve"}']);

    expect(exit).toMatchObject(Exit.succeed({ output: { verdict: 'approve' }, record: { usage: usageOfBoth } }));
    expect(facts.map(({ type }) => type)).toEqual(['model_call_started', 'model_call_answered']);
    expect(facts[1]?.data).toMatchObject({
      usage: usageOfBoth,
      output_mode: 'described',
      repair: { outcome: 'repaired', issues: [{ pointer: '/verdict', detail: 'Expected string' }] },
    });
  });
});

describe('a run with too few input tokens left to ask its model again', () => {
  it('is refused with the issues of the answer, saying no correction was attempted, and records why', async () => {
    const reading = { mostInputTokens: 30, contextWindowOf: () => Effect.undefined };

    const { exit, facts, requests } = await runAnswered(['{"verdict":true}', '{"verdict":"approve"}'], reading);

    expect(requests).toHaveLength(1);
    expect(exit).toMatchObject(
      Exit.fail({
        _tag: 'unavailable',
        detail:
          'The answer does not match the output schema (/verdict: Expected string); no correction was attempted, as the run had too few input tokens left; try again',
      }),
    );
    expect(facts.find(({ type }) => type === 'model_call_failed')?.data).toMatchObject({
      because: 'output_invalid',
      repair: { outcome: 'skipped', because: 'input_tokens' },
    });
  });
});

function answeredThenDown(_request: unknown, attempt: number): Response {
  return attempt === 1
    ? jsonResponse(chatCompletion('{"verdict":true}'), 200, { 'x-call-cost': '0.25' })
    : jsonResponse({ error: { message: 'down' } }, 500);
}

describe('a run whose model is asked once more for JSON that missed its schema, by a request that fails', () => {
  it('is refused with the issues of the answer, saying the request failed, and records the cost of the answer', async () => {
    const recording = recordingFetch(answeredThenDown);
    const { languageModel } = await accessFor(describingGateway, { fetch: recording.fetch });
    const capability = reasoningAdapter({ languageModel, offered: { providers: ['internal'], aliases: [] } });
    const journal = recordingJournal();

    const exit = await Effect.runPromiseExit(
      Effect.runSync(capability.prepare(deciding)).run({ text: 'the renewal' }, runContextWith(journal)),
    );

    expect(exit).toMatchObject(
      Exit.fail({
        _tag: 'unavailable',
        detail:
          'The answer does not match the output schema (/verdict: Expected string); the request for a correction failed (provider_unavailable); try again',
      }),
    );
    expect(journal.recorded().find(({ type }) => type === 'model_call_failed')?.data).toMatchObject({
      because: 'output_invalid',
      cost_usd: 0.25,
      repair: { outcome: 'failed', because: 'provider_unavailable' },
    });
  });
});
