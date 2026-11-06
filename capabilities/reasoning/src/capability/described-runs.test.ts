import { recordingJournal } from '@on.auto/definitions/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { chatCompletion } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { accessFor } from '../testing/adapter-harness.ts';
import { documentOf } from '../testing/definition-documents.ts';
import { reasoningAdapter, runContextWith } from '../testing/reasoning-runs.ts';

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

async function runAnswered(text: string) {
  const recording = recordingFetch(() => jsonResponse(chatCompletion(text)));
  const { languageModel } = await accessFor(withoutStructuredOutputs, { fetch: recording.fetch });
  const capability = reasoningAdapter({ languageModel, offered: { providers: ['internal'], aliases: [] } });
  const journal = recordingJournal();
  const prepared = Effect.runSync(capability.prepare(deciding));
  const exit = await Effect.runPromiseExit(prepared.run({ text: 'the renewal' }, runContextWith(journal)));
  return { exit, facts: journal.recorded() };
}

describe('a run whose model a gateway without structured outputs serves', () => {
  it('answers the JSON the model wrote inside a code fence, and records that the call described the schema', async () => {
    const { exit, facts } = await runAnswered('```json\n{"verdict":"approve"}\n```');

    expect(exit).toMatchObject(Exit.succeed({ output: { verdict: 'approve' } }));
    expect(facts.find(({ type }) => type === 'model_call_answered')?.data).toMatchObject({
      finish_reason: 'stop',
      output_mode: 'described',
    });
  });

  it('is refused when the model answers in prose when asked once more too, and records the failed call as described', async () => {
    const { exit, facts } = await runAnswered('I would approve the renewal.');

    expect(exit).toMatchObject(
      Exit.fail({ _tag: 'unavailable', detail: 'The answer is not JSON after one correction; try again' }),
    );
    expect(facts.find(({ type }) => type === 'model_call_failed')?.data).toMatchObject({
      because: 'output_invalid',
      provider: 'internal',
      detail: 'The answer is not JSON',
      issues: [],
      output_mode: 'described',
      repair: { outcome: 'invalid', issues: [] },
    });
  });
});
