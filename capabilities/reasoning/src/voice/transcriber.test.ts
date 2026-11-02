import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  answered,
  answeringFetch,
  heard,
  relayKey,
  relayed,
  spoken,
  voiceOf,
} from '../provider-testing/voice-calls.ts';
import { readModelSettings } from '../settings/model-settings.ts';
import { transcriberOf } from './transcriber.ts';

const costed = answered(' Flag it for Priya. ', { 'x-litellm-response-cost': '0.0021' });

describe('the transcriber of a gateway entry', () => {
  it('posts the recording and the model to the entry with its key, headers and query parameters', async () => {
    const { voice, sent } = await voiceOf(relayed, costed);

    await heard(voice);

    expect(sent()).toMatchObject([
      {
        url: 'https://relay.example.com/v1/audio/transcriptions?api-version=2026-01',
        method: 'POST',
        headers: { authorization: `Bearer ${relayKey}`, 'x-tenant': 'acme' },
        files: [{ name: 'recording.webm', type: 'audio/webm', bytes: [26, 69, 223, 163, 1, 2] }],
        model: 'xai/scribe_v2',
      },
    ]);
    expect(sent()[0]?.headers).not.toHaveProperty('content-type');
  });

  it('answers the text as the model gave it and the cost the gateway answered in the header the entry names', async () => {
    const { voice } = await voiceOf(relayed, costed);

    expect(voice?.model).toBe('relay/xai/scribe_v2');
    expect(await heard(voice)).toEqual(Result.succeed({ text: ' Flag it for Priya. ', cost_usd: 0.0021 }));
  });

  it.each([
    ['audio/ogg', 'recording.ogg'],
    ['audio/mp4', 'recording.mp4'],
    ['audio/wav', 'recording.wav'],
  ] as const)('names a recording of %s %s', async (type, name) => {
    const { voice, sent } = await voiceOf(relayed, answered('ok'));

    await heard(voice, { ...spoken, type });

    expect(sent()[0]?.files).toMatchObject([{ name, type }]);
  });
});

describe('the transcriber of a gateway entry that names less', () => {
  const bare = {
    MODEL_GATEWAYS: JSON.stringify([{ name: 'relay', base_url: 'https://relay.example.com/v1' }]),
    VOICE_MODEL: 'relay/whisper-1',
  };

  it('sends no key where the entry names none, and keeps no cost where it names no header', async () => {
    const { voice, sent } = await voiceOf(bare, answered('hello', { 'x-cost': '1' }));

    expect(await heard(voice)).toEqual(Result.succeed({ text: 'hello', cost_usd: null }));
    expect(sent()[0]?.url).toBe('https://relay.example.com/v1/audio/transcriptions');
    expect(sent()[0]?.headers).not.toHaveProperty('authorization');
  });

  it('keeps no cost where the gateway answers none', async () => {
    const { voice } = await voiceOf(relayed, answered('hello'));

    expect(await heard(voice)).toEqual(Result.succeed({ text: 'hello', cost_usd: null }));
  });
});

describe('the transcriber of openai', () => {
  const openai = { OPENAI_API_KEY: 'sk-openai-key', VOICE_MODEL: 'openai/whisper-1' };

  it("posts to OpenAI's own route with OPENAI_API_KEY", async () => {
    const { voice, sent } = await voiceOf(openai, answered('hi'));

    expect(await heard(voice)).toEqual(Result.succeed({ text: 'hi', cost_usd: null }));
    expect(sent()).toMatchObject([
      {
        url: 'https://api.openai.com/v1/audio/transcriptions',
        headers: { authorization: 'Bearer sk-openai-key' },
        model: 'whisper-1',
      },
    ]);
  });

  it('posts to OPENAI_BASE_URL where it is set', async () => {
    const { voice, sent } = await voiceOf(
      { ...openai, OPENAI_BASE_URL: 'https://llm.example.com/openai/' },
      answered('hi'),
    );

    await heard(voice);

    expect(sent()[0]?.url).toBe('https://llm.example.com/openai/audio/transcriptions');
  });
});

describe('a model access without a voice model', () => {
  it('has no transcriber', async () => {
    expect((await voiceOf({ OPENAI_API_KEY: 'sk-openai-key' }, answered('hi'))).voice).toBeNull();
  });

  it('has none where the settings name a provider the access does not hold', async () => {
    const settings = await Effect.runPromise(readModelSettings({}));
    const options = { fetch: answeringFetch(answered('hi')).fetch };
    const openai = { reference: 'openai/whisper-1', provider: 'openai', model: 'whisper-1' };
    const gateway = { reference: 'relay/whisper-1', provider: 'relay', model: 'whisper-1' };

    expect(transcriberOf({ ...settings, voice: openai }, options)).toBeNull();
    expect(transcriberOf({ ...settings, voice: gateway }, options)).toBeNull();
  });
});
