import { describe, expect, it } from 'vitest';

import { jsonResponse } from '../provider-testing/recording-fetch.ts';
import { heard, relay, relayKey, relayed, voiceOf } from '../provider-testing/voice-calls.ts';

const message = `model whisper-x is not served for ${relayKey}`;

const notFound = () => jsonResponse({ error: { message, code: 'model_not_found' } }, 404);

describe('a transcription the gateway refuses', () => {
  it('fails as a model call refused for the request, once, without the gateway words', async () => {
    const { voice, sent } = await voiceOf(relayed, notFound);

    expect(await heard(voice)).toMatchObject({
      failure: {
        _tag: 'definition_invalid',
        detail: 'relay answered HTTP 404: the model was not found, with the error code model_not_found',
        provider_message: null,
      },
    });
    expect(sent()).toHaveLength(1);
  });

  it('carries the gateway words where its entry exposes them, its secrets redacted', async () => {
    const exposing = { ...relayed, MODEL_GATEWAYS: JSON.stringify([{ ...relay, expose_provider_messages: true }]) };
    const { voice } = await voiceOf(exposing, notFound);

    expect(await heard(voice)).toMatchObject({
      failure: { provider_message: 'model whisper-x is not served for [redacted]' },
    });
  });

  it('tells the operator the gateway words, naming the voice model and no run', async () => {
    const { voice, reports } = await voiceOf(relayed, notFound);

    await heard(voice);

    expect(reports()).toEqual([
      {
        provider: 'relay',
        model: 'relay/xai/scribe_v2',
        status: 404,
        message: 'model whisper-x is not served for [redacted]',
        run_id: null,
      },
    ]);
  });
});

describe('a transcription the gateway refuses in words that echo a secret only the composer knows', () => {
  it('keeps it from the caller and the operator, and the secrets of the settings stay redacted', async () => {
    const secretOfTheComposer = 'fake-secret-of-the-composer-0003';
    const exposing = { ...relayed, MODEL_GATEWAYS: JSON.stringify([{ ...relay, expose_provider_messages: true }]) };
    const echoing = () =>
      jsonResponse({ error: { message: `${relayKey} and ${secretOfTheComposer} may not transcribe` } }, 404);
    const { voice, reports } = await voiceOf(exposing, echoing, {
      scrubProviderText: (text) => text.replaceAll(secretOfTheComposer, '[scrubbed]'),
    });
    const said = '[redacted] and [scrubbed] may not transcribe';

    expect(await heard(voice)).toMatchObject({ failure: { provider_message: said } });
    expect(reports()).toMatchObject([{ status: 404, message: said }]);
  });
});

describe('what the operator is told of a refusal', () => {
  it.each([
    ['a body that is not JSON', 'nope'],
    ['an error without a message', JSON.stringify({ error: { code: 'bad' } })],
    ['an error whose message is not text', JSON.stringify({ error: { message: 7 } })],
  ])('tells the operator the status text for %s', async (_case, body) => {
    const { voice, reports } = await voiceOf(
      relayed,
      () => new Response(body, { status: 400, statusText: 'Bad Request' }),
    );

    expect(await heard(voice)).toMatchObject({ failure: { _tag: 'definition_invalid', status: 400 } });
    expect(reports()).toMatchObject([{ status: 400, message: 'Bad Request' }]);
  });

  it('tells the operator nothing where the answer says nothing', async () => {
    const { voice, reports } = await voiceOf(relayed, () => new Response('', { status: 400 }));

    await heard(voice);

    expect(reports()).toEqual([]);
  });
});

describe('a transcription whose credentials the gateway rejects', () => {
  it('fails as rejected credentials on a 401', async () => {
    const { voice } = await voiceOf(relayed, () => jsonResponse({ error: { message: 'no' } }, 401));

    expect(await heard(voice)).toMatchObject({ failure: { _tag: 'credentials_rejected', status: 401 } });
  });
});

describe('a transcription whose answer cannot be read', () => {
  it.each([
    ['not JSON', () => new Response('<html>ok</html>', { status: 200 })],
    ['JSON without text', () => jsonResponse({ transcript: 'hi' })],
  ])('fails as the provider unavailable, once, where the answer is %s', async (_case, answer) => {
    const { voice, sent } = await voiceOf(relayed, answer);

    expect(await heard(voice)).toMatchObject({
      failure: { _tag: 'provider_unavailable', detail: 'The response of relay could not be read', status: 200 },
    });
    expect(sent()).toHaveLength(1);
  });
});
