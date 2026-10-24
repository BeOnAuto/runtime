import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { LanguageModel } from '../model/language-model.ts';
import { anthropicMessage } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { readModelSettings } from '../settings/model-settings.ts';
import { textRequest } from '../testing/adapter-harness.ts';
import { loadEntraIdentity } from './installed-packages.ts';
import { languageModelLayer } from './language-model-layer.ts';
import { makeModelAccess } from './model-access.ts';

describe('languageModelLayer', () => {
  it('provides a language model built from the environment', async () => {
    const recording = recordingFetch(() => jsonResponse(anthropicMessage('Hello')));
    const program = Effect.gen(function* () {
      const model = yield* LanguageModel;
      return yield* model.generate(textRequest('anthropic/claude-sonnet-4-5'));
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(languageModelLayer({ ANTHROPIC_API_KEY: 'k' }, { fetch: recording.fetch }))),
    );

    expect(result.text).toBe('Hello');
  });

  it('fails to build when the settings are invalid', async () => {
    const program = Effect.gen(function* () {
      return yield* LanguageModel;
    });

    const failure = await Effect.runPromise(
      Effect.flip(program.pipe(Effect.provide(languageModelLayer({ OPENAI_API: 'assistants' })))),
    );

    expect(failure).toMatchObject({ _tag: 'model_settings_invalid' });
  });
});

describe('makeModelAccess with its defaults', () => {
  it('builds every provider from the default fetch and credential chains without contacting anyone, and one provider without a key only given the loader of its identity library', async () => {
    const settings = await Effect.runPromise(
      readModelSettings({
        AWS_REGION: 'us-east-1',
        GOOGLE_VERTEX_PROJECT: 'acme-ai',
        GOOGLE_VERTEX_LOCATION: 'us-central1',
        AZURE_RESOURCE_NAME: 'acme',
      }),
    );

    const access = await Effect.runPromise(makeModelAccess(settings));
    const withTheLibrary = await Effect.runPromise(makeModelAccess(settings, { loadEntraIdentity }));

    expect(access.status.configured).toEqual(['bedrock', 'bedrock-anthropic', 'vertex', 'vertex-anthropic']);
    expect(withTheLibrary.status.configured).toEqual([
      'bedrock',
      'bedrock-anthropic',
      'azure',
      'vertex',
      'vertex-anthropic',
    ]);
  });
});
