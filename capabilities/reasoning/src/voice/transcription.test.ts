import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { abortedWith, connectionFailure, jsonResponse } from '../provider-testing/recording-fetch.ts';
import {
  type Answering,
  heard,
  onTheClock,
  relay,
  relayed,
  relayKey,
  voiceOf,
} from '../provider-testing/voice-calls.ts';

const anyWords: unknown = expect.any(String);

const failingFirst: Answering = (_sent, attempt) =>
  attempt === 1 ? jsonResponse({}, 408) : jsonResponse({ text: 'second time' });

describe('a transcription tried again', () => {
  it('is tried twice more after 2 and then 4 seconds where the provider is unavailable', async () => {
    const { voice, sent } = await voiceOf(relayed, () => jsonResponse({ error: { message: 'overloaded' } }, 503));

    const { sentBy, result } = await onTheClock(voice, sent, [0, 1999, 2000, 5999, 6000]);

    expect(sentBy).toEqual([
      [0, 1],
      [1999, 1],
      [2000, 2],
      [5999, 2],
      [6000, 3],
    ]);
    expect(result).toMatchObject({ failure: { _tag: 'provider_unavailable', status: 503 } });
  });

  it('answers from the attempt that succeeds', async () => {
    const { voice, sent } = await voiceOf(relayed, failingFirst);

    const { result } = await onTheClock(voice, sent, [0, 2000]);

    expect(result).toEqual(Result.succeed({ text: 'second time', cost_usd: null }));
  });
});

describe('the wait before a transcription is tried again', () => {
  it('is as long as the provider asks where that is less than a minute', async () => {
    const { voice, sent } = await voiceOf(relayed, () => jsonResponse({}, 429, { 'retry-after': '1' }));

    const { sentBy, result } = await onTheClock(voice, sent, [0, 999, 1000, 1999, 2000]);

    expect(sentBy.map(([, count]) => count)).toEqual([1, 1, 2, 2, 3]);
    expect(result).toMatchObject({ failure: { _tag: 'rate_limited', retry_after_ms: 1000 } });
  });

  it('is 2 and then 4 seconds where the provider asks for a minute or more', async () => {
    const { voice, sent } = await voiceOf(relayed, () => jsonResponse({}, 429, { 'retry-after': '120' }));

    const { sentBy } = await onTheClock(voice, sent, [0, 1999, 2000, 6000]);

    expect(sentBy.map(([, count]) => count)).toEqual([1, 1, 2, 3]);
  });

  it('is tried again where the provider cannot be reached', async () => {
    const { voice, sent } = await voiceOf(relayed, () => connectionFailure('ECONNREFUSED'));

    const { result } = await onTheClock(voice, sent, [0, 2000, 6000]);

    expect(sent()).toHaveLength(3);
    expect(result).toMatchObject({
      failure: { _tag: 'provider_unavailable', detail: 'relay could not be reached', status: null },
    });
  });
});

describe('a transcription not tried again', () => {
  it('fails where the certificate of the provider is not trusted, and the operator is told what to add', async () => {
    const { voice, sent, hints } = await voiceOf(relayed, () => connectionFailure('SELF_SIGNED_CERT_IN_CHAIN'));

    expect(await heard(voice)).toMatchObject({
      failure: {
        _tag: 'provider_not_configured',
        detail: anyWords,
      },
    });
    expect(sent()).toHaveLength(1);
    expect(hints()).toEqual([
      {
        provider: 'relay',
        model: 'relay/xai/scribe_v2',
        hint: 'The TLS certificate of relay is not trusted; add its certificate authority with NODE_EXTRA_CA_CERTS',
        run_id: null,
      },
    ]);
  });

  it('times out 60 seconds after it was first sent, every attempt included, and the call is cut off', async () => {
    const { voice, sent } = await voiceOf(relayed, ({ signal }) => abortedWith(signal));

    const { sentBy, result } = await onTheClock(voice, sent, [0, 59_999, 60_000]);

    expect(sentBy.map(([, count]) => count)).toEqual([1, 1, 1]);
    expect(result).toMatchObject({
      failure: { _tag: 'timed_out', detail: 'relay did not answer within 60000 ms', timeout_ms: 60_000 },
    });
    expect(sent()[0]?.signal.aborted).toBe(true);
  });
});

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
