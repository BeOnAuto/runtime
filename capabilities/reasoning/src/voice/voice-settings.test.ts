import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readModelSettings, type ModelSettings, type ModelSettingsInvalid } from '../settings/model-settings.ts';
import { modelVariables } from '../settings/model-variables.ts';
import type { Environment } from '../settings/setting-values.ts';

const gateways = JSON.stringify([{ name: 'relay', base_url: 'https://relay.example.com/v1' }]);

const refusal =
  'The model settings are invalid. VOICE_MODEL: Expected openai/<model> or <gateway>/<model> for a gateway of model_gateways';

function settingsOf(environment: Environment): Promise<ModelSettings> {
  return Effect.runPromise(readModelSettings(environment));
}

function refusedWith(environment: Environment): Promise<ModelSettingsInvalid> {
  return Effect.runPromise(Effect.flip(readModelSettings(environment)));
}

describe('the voice model of the model settings', () => {
  it('is read from VOICE_MODEL, one of the model variables', () => {
    expect(modelVariables).toContain('VOICE_MODEL');
  });

  it('is left out where VOICE_MODEL is not set', async () => {
    expect(await settingsOf({ MODEL_GATEWAYS: gateways })).not.toHaveProperty('voice');
  });

  it('names a model of a gateway entry, everything after the first slash its model', async () => {
    const settings = await settingsOf({ MODEL_GATEWAYS: gateways, VOICE_MODEL: 'relay/xai/scribe_v2' });

    expect(settings.voice).toEqual({ reference: 'relay/xai/scribe_v2', provider: 'relay', model: 'xai/scribe_v2' });
  });

  it('names a model of openai where OPENAI_API_KEY is set', async () => {
    const settings = await settingsOf({ OPENAI_API_KEY: 'sk-key', VOICE_MODEL: 'openai/whisper-1' });

    expect(settings.voice).toEqual({ reference: 'openai/whisper-1', provider: 'openai', model: 'whisper-1' });
  });
});

describe('a voice model the settings refuse', () => {
  it.each([
    ['openai without OPENAI_API_KEY', { VOICE_MODEL: 'openai/whisper-1' }],
    ['a provider that is neither openai nor a gateway', { ANTHROPIC_API_KEY: 'key', VOICE_MODEL: 'anthropic/claude' }],
    ['a gateway that is not an entry', { MODEL_GATEWAYS: gateways, VOICE_MODEL: 'other/whisper-1' }],
    ['a value that is not provider/model', { MODEL_GATEWAYS: gateways, VOICE_MODEL: 'whisper-1' }],
    ['a reference without its model', { MODEL_GATEWAYS: gateways, VOICE_MODEL: 'relay/' }],
    ['a reference with a space in it', { MODEL_GATEWAYS: gateways, VOICE_MODEL: 'relay/whisper large' }],
  ] as const)(
    'stops the start for %s, in words that name the setting and what it expects',
    async (_case, environment) => {
      const invalid = await refusedWith(environment);

      expect(invalid.message).toBe(refusal);
      expect(invalid.problems).toEqual([
        {
          setting: 'VOICE_MODEL',
          detail: 'Expected openai/<model> or <gateway>/<model> for a gateway of model_gateways',
        },
      ]);
    },
  );

  it('is not an alias, nor held to the allowed models', async () => {
    const settings = await settingsOf({
      MODEL_GATEWAYS: gateways,
      MODEL_ALIASES: JSON.stringify({ 'voice/*': 'relay/*' }),
      ALLOWED_MODELS: JSON.stringify(['relay/llama-3.3-70b']),
      VOICE_MODEL: 'relay/whisper-1',
    });

    expect(settings.voice?.reference).toBe('relay/whisper-1');
  });
});
