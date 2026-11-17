import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { jsonResponse } from '../provider-testing/recording-fetch.ts';
import { heard, relayed, voiceOf } from '../provider-testing/voice-calls.ts';
import { answeredWith, asked, reader, recorded, transcribed, voiceAsked } from '../provider-testing/voice-dispatch.ts';
import { type ModelSettings, type ModelSettingsInvalid, readModelSettings } from '../settings/model-settings.ts';
import { modelVariables } from '../settings/model-variables.ts';
import type { Environment } from '../settings/setting-values.ts';
import { defineGetVoice } from './get-voice.ts';
import { defineTranscribe } from './transcribe.ts';

describe('get_voice', () => {
  it('is a query of the org at GET /voice, over HTTP alone, for a reader of playbooks', () => {
    expect(defineGetVoice(null).registration).toMatchObject({
      scope: 'org',
      kind: 'query',
      name: 'get_voice',
      route: { method: 'GET', path: '/voice' },
      servedOverHttpAlone: { kind: 'none' },
      permissions: ['playbook:read'],
    });
  });

  it('answers the voice model as the settings name it', async () => {
    expect(await voiceAsked('openai/whisper-1')).toEqual({
      status: 'succeeded',
      output: { model: 'openai/whisper-1' },
    });
  });

  it('answers null where none is set', async () => {
    expect(await voiceAsked(null)).toEqual({ status: 'succeeded', output: { model: null } });
  });
});

const outOfCredits = {
  type: 'credits_exhausted',
  code: 'credits_exhausted',
  message: 'This organization has no credits left',
  resolve_at: 'https://studio.example.com/billing',
  because: 'none_left',
};

describe('a transcription the account refuses', () => {
  it('fails as the account said, once, with where it is resolved and why, and tells the operator nothing', async () => {
    const { voice, sent, reports } = await voiceOf(relayed, () => jsonResponse({ error: outOfCredits }, 402));

    expect(await heard(voice)).toMatchObject({
      failure: {
        _tag: 'account_refused',
        kind: 'credits_exhausted',
        detail: 'This organization has no credits left',
        resolve_at: 'https://studio.example.com/billing',
        because: 'none_left',
      },
    });
    expect(sent()).toHaveLength(1);
    expect(reports()).toEqual([]);
  });

  it('keeps no why it does not know, nor a place where it names none', async () => {
    const { voice } = await voiceOf(relayed, () =>
      jsonResponse({ error: { type: 'meter_unavailable', message: 'Try again shortly', because: 'whim' } }, 402),
    );

    const result = await heard(voice);

    expect(result).toMatchObject({
      failure: { _tag: 'account_refused', kind: 'meter_unavailable', detail: 'Try again shortly' },
    });
    expect(result).not.toHaveProperty('failure.because');
    expect(result).not.toHaveProperty('failure.resolve_at');
  });

  it('is the gateway unable to serve it, tried once, where a 402 names no refusal of the account', async () => {
    const { voice, sent } = await voiceOf(relayed, () => jsonResponse({ error: { message: 'Out of funds' } }, 402));

    expect(await heard(voice)).toMatchObject({
      failure: { _tag: 'provider_unavailable', status: 402, detail: 'relay could not serve the request (HTTP 402)' },
    });
    expect(sent()).toHaveLength(1);
  });
});

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

const said = { text: '  Flag any entry over ten thousand dollars for Priya.\n', cost_usd: 0.000167 };

describe('transcribe', () => {
  it('is a command of the org at POST /voice/transcriptions, over HTTP alone, for a reader of playbooks, that reaches the voice model outside and changes nothing there', () => {
    expect(defineTranscribe(Effect.succeed(null)).registration).toMatchObject({
      scope: 'org',
      kind: 'command',
      name: 'transcribe',
      route: { method: 'POST', path: '/voice/transcriptions' },
      servedOverHttpAlone: { kind: 'json' },
      permissions: ['playbook:read'],
      successStatus: 200,
      reachesOutside: true,
      mayChangeOutside: false,
    });
  });

  it('sends the model the recording as it came, its type and its length', async () => {
    const { recordings } = await answeredWith(Effect.succeed(said));

    expect(recordings).toEqual([{ audio: recorded, type: 'audio/webm', seconds: 6 }]);
  });

  it('answers the text without the white space around it', async () => {
    const { outcome } = await answeredWith(Effect.succeed(said));

    expect(outcome).toEqual({
      status: 'succeeded',
      output: { text: 'Flag any entry over ten thousand dollars for Priya.' },
    });
  });

  it('answers an empty text where the model heard nothing', async () => {
    const { outcome, facts } = await answeredWith(Effect.succeed({ text: '  ', cost_usd: null }));

    expect(outcome).toEqual({ status: 'succeeded', output: { text: '' } });
    expect(facts[0]?.data).toMatchObject({ text_characters: 0, cost_usd: null });
  });
});

describe('the transcription on the ledger', () => {
  it('is on a stream of its own on the org ledger, named by its id', async () => {
    const { streams, facts } = await answeredWith(Effect.succeed(said));

    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatch(/^org\/acme\/voice\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    expect(streams[0]).toBe(`org/acme/voice/${String(facts[0]?.data.id)}`);
  });

  it('records the model, the recording and the cost, as and by whom it was asked, and never the text', async () => {
    const { facts } = await answeredWith(Effect.succeed(said));

    expect(facts.map(({ type }) => type)).toEqual(['voice_transcribed']);
    expect(facts[0]?.data).toEqual({
      id: facts[0]?.data.id,
      model: 'gateway/xai/scribe_v2',
      type: 'audio/webm',
      audio_bytes: 6,
      seconds: 6,
      text_characters: 51,
      cost_usd: 0.000167,
    });
    expect(facts[0]?.context).toEqual({ at: facts[0]?.context.at, by: 'person:user_2ada' });
    expect(Date.parse(String(facts[0]?.context.at))).not.toBeNaN();
    expect(JSON.stringify(facts)).not.toContain('Priya');
  });
});

describe('a transcription refused before the model is called', () => {
  it('is refused as unavailable where the runtime has no voice model, and records nothing', async () => {
    const { outcome, streams } = await transcribed(null);

    expect(outcome).toEqual({ status: 'rejected', reason: 'unavailable', detail: 'This runtime has no voice model' });
    expect(streams).toEqual([]);
  });

  it.each([
    ['/audio', 'an empty audio', { ...asked, audio: '' }],
    ['/audio', 'an audio that is not base64', { ...asked, audio: 'not base64!' }],
    ['/audio', 'an audio cut short', { ...asked, audio: 'GkXfo5' }],
    ['/type', 'a type other than the four', { ...asked, type: 'audio/mpeg' }],
    ['/seconds', 'no seconds', { audio: asked.audio, type: 'audio/webm' }],
    ['/seconds', 'no whole seconds', { ...asked, seconds: 2.5 }],
    ['/seconds', 'no seconds at all', { ...asked, seconds: 0 }],
    ['/seconds', 'more than two minutes', { ...asked, seconds: 121 }],
  ] as const)('is refused at %s for %s, and records nothing', async (pointer, _case, input) => {
    const { outcome, recordings, streams } = await answeredWith(Effect.succeed(said), input);

    expect(outcome).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer }] });
    expect(recordings).toEqual([]);
    expect(streams).toEqual([]);
  });

  it('takes a recording of two minutes', async () => {
    const { outcome } = await answeredWith(Effect.succeed(said), { ...asked, seconds: 120 });

    expect(outcome).toMatchObject({ status: 'succeeded' });
  });

  it('is refused to a caller who may not read playbooks', async () => {
    const { outcome } = await transcribed(null, asked, { ...reader, permissions: ['org:read'] });

    expect(outcome).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });
});
