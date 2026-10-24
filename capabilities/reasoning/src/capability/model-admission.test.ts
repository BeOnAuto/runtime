import { Unavailable } from '@on.auto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { LanguageModel, ModelNotAllowed, ProviderNotConfigured } from '../index.ts';
import { documentOf } from '../testing/definition-documents.ts';
import { reasoningAdapter, runContext, type Run } from '../testing/reasoning-runs.ts';

const jsonDefinition = documentOf(
  'model: openai/gpt-5\nconfig: {max_output_tokens: 200}\noutput:\n  format: json\n  schema: {type: object}',
);

function admittingOnly(admit: LanguageModel['Service']['admit']): Promise<Run> {
  const capability = reasoningAdapter({ languageModel: LanguageModel.of({ admit, generate: () => Effect.never }) });
  return Effect.runPromiseExit(Effect.runSync(capability.prepare(jsonDefinition)).run({ text: 'x' }, runContext()));
}

describe('a model of a provider the server does not have', () => {
  it('is unavailable as such when the server has no other provider either', async () => {
    const failure = new ProviderNotConfigured({
      detail: 'openai is not configured; it needs OPENAI_API_KEY',
      provider: 'openai',
      configured: [],
      missing: ['OPENAI_API_KEY'],
    });

    expect(await admittingOnly(() => Effect.fail(failure))).toEqual(
      Exit.fail(new Unavailable({ detail: 'openai is not configured; it needs OPENAI_API_KEY' })),
    );
  });
});

describe('a model of a provider the server does not have, while it has others', () => {
  it('is unavailable of the kind model_not_offered, because its provider is not set up, so that the definition can be switched', async () => {
    const failure = new ProviderNotConfigured({
      detail: 'openai is not configured. Configured providers: anthropic, gateway',
      provider: 'openai',
      configured: ['anthropic', 'gateway'],
      missing: ['OPENAI_API_KEY'],
    });

    expect(await admittingOnly(() => Effect.fail(failure))).toEqual(
      Exit.fail(
        new Unavailable({
          detail: 'openai is not configured. Configured providers: anthropic, gateway',
          kind: 'model_not_offered',
          because: 'provider_not_configured',
        }),
      ),
    );
  });
});

describe('a model outside those its operator allows', () => {
  it('is unavailable of the kind model_not_offered at its admission, before any call', async () => {
    const failure = new ModelNotAllowed({
      detail: 'openai/gpt-5 is not one of the models this server offers',
      provider: 'openai',
    });

    expect(await admittingOnly(() => Effect.fail(failure))).toEqual(
      Exit.fail(
        new Unavailable({
          detail: 'openai/gpt-5 is not one of the models this server offers',
          kind: 'model_not_offered',
          because: 'model_not_allowed',
        }),
      ),
    );
  });
});
