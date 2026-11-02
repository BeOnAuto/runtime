import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ModelNotAllowed } from '../failure/model-not-allowed.ts';
import { OutputInvalid } from '../failure/output-invalid.ts';
import { ProviderUnavailable } from '../failure/provider-unavailable.ts';
import { RateLimited } from '../failure/rate-limited.ts';
import { TimedOut } from '../failure/timed-out.ts';
import { connectionFailure, jsonResponse } from '../provider-testing/recording-fetch.ts';
import { relayed, unreportedVoiceOf, voiceOf } from '../provider-testing/voice-calls.ts';
import { answeredWith, transcribed } from '../provider-testing/voice-dispatch.ts';

const provider = 'gateway';

const unreadable = { provider, finish_reason: 'other', raw_finish_reason: null, usage: null, issues: [] } as const;

const requestRefusals = [
  [
    'definition_invalid',
    () => jsonResponse({ error: { message: 'no such model' } }, 404),
    { reason: 'conflict', kind: 'unworkable', detail: 'relay answered HTTP 404: the model was not found' },
  ],
  [
    'request_too_long',
    () => jsonResponse({ error: { message: 'too large' } }, 413),
    {
      reason: 'conflict',
      kind: 'unworkable',
      detail: 'relay refused the request as longer than the model takes, by HTTP 413',
    },
  ],
  [
    'content_refused',
    () => jsonResponse({ error: { message: 'flagged', code: 'content_filter' } }, 400),
    {
      reason: 'invalid_input',
      detail: 'relay refused the request under its content policy',
      issues: [{ pointer: '/audio', detail: 'The model refused this recording under its content policy' }],
    },
  ],
  [
    'credentials_rejected',
    () => jsonResponse({ error: { message: 'bad key' } }, 401),
    { reason: 'unavailable', detail: 'relay rejected the credentials (HTTP 401)' },
  ],
  [
    'provider_not_configured',
    () => connectionFailure('SELF_SIGNED_CERT_IN_CHAIN'),
    {
      reason: 'unavailable',
      detail:
        'The TLS certificate of relay is not trusted by this server; its operator must add the certificate authority',
    },
  ],
] as const;

describe('a transcription the model refuses for its request', () => {
  it.each(requestRefusals)(
    'answers %s as a model call refused, and records voice_refused with it',
    async (because, answer, refused) => {
      const { voice } = await unreportedVoiceOf(relayed, answer);
      const { outcome, facts } = await transcribed(voice);

      expect(outcome).toEqual({ status: 'rejected', ...refused });
      expect(facts).toMatchObject([
        {
          type: 'voice_refused',
          data: { model: 'relay/xai/scribe_v2', type: 'audio/webm', audio_bytes: 6, seconds: 6, because },
          context: { by: 'person:user_2ada' },
        },
      ]);
    },
  );

  it('answers the gateway words where its entry exposes them', async () => {
    const exposing = {
      ...relayed,
      MODEL_GATEWAYS: JSON.stringify([
        { name: 'relay', base_url: 'https://r.example.com', expose_provider_messages: true },
      ]),
    };
    const { voice } = await voiceOf(exposing, () => jsonResponse({ error: { message: 'no such model' } }, 404));

    expect((await transcribed(voice)).outcome).toMatchObject({
      detail: 'relay answered HTTP 404: the model was not found. The provider said: no such model',
    });
  });
});

describe('a transcription the model cannot serve', () => {
  it.each([
    [
      'rate_limited',
      () => new RateLimited({ detail: 'gateway is limiting the rate of requests', provider, retry_after_ms: 3000 }),
      'gateway is limiting the rate of requests; try again in 3 seconds',
    ],
    [
      'rate_limited',
      () => new RateLimited({ detail: 'gateway is limiting the rate of requests', provider, retry_after_ms: null }),
      'gateway is limiting the rate of requests; try again later',
    ],
    [
      'provider_unavailable',
      () =>
        new ProviderUnavailable({ detail: 'gateway could not serve the request (HTTP 503)', provider, status: 503 }),
      'gateway could not serve the request (HTTP 503); try again later',
    ],
    [
      'timed_out',
      () => new TimedOut({ detail: 'gateway did not answer within 60000 ms', provider, timeout_ms: 60_000 }),
      'gateway did not answer within 60000 ms; try again later',
    ],
    [
      'output_invalid',
      () => new OutputInvalid({ detail: 'The answer could not be read', ...unreadable }),
      'The answer could not be read; try again',
    ],
    [
      'model_not_allowed',
      () => new ModelNotAllowed({ detail: 'gateway/xai/scribe_v2 is not allowed', provider }),
      'gateway/xai/scribe_v2 is not allowed',
    ],
  ] as const)('answers %s as unavailable, and records voice_refused with it', async (because, failure, detail) => {
    const { outcome, facts } = await answeredWith(Effect.fail(failure()));

    expect(outcome).toEqual({ status: 'rejected', reason: 'unavailable', detail });
    expect(facts).toMatchObject([{ type: 'voice_refused', data: { because } }]);
  });
});

async function refusedAs(error: Readonly<Record<string, string>>) {
  const { voice } = await voiceOf(relayed, () => jsonResponse({ error }, 402));
  return transcribed(voice);
}

describe('a transcription the account refuses', () => {
  it('answers no credits as a conflict, with where it is resolved and why, and records nothing', async () => {
    const { outcome, streams } = await refusedAs({
      type: 'credits_exhausted',
      message: 'This organization has no credits left',
      resolve_at: 'https://studio.example.com/billing',
      because: 'none_left',
    });

    expect(outcome).toEqual({
      status: 'rejected',
      reason: 'conflict',
      kind: 'credits_exhausted',
      detail: 'This organization has no credits left',
      resolve_at: 'https://studio.example.com/billing',
      because: 'none_left',
    });
    expect(streams).toEqual([]);
  });

  it.each([
    ['account_closed', 'conflict'],
    ['meter_unavailable', 'unavailable'],
    ['model_not_offered', 'unavailable'],
  ] as const)('answers %s as %s, and records nothing', async (kind, reason) => {
    const { outcome, streams } = await refusedAs({ type: kind, message: 'Refused' });

    expect(outcome).toEqual({ status: 'rejected', reason, kind, detail: 'Refused' });
    expect(streams).toEqual([]);
  });

  it('answers a 402 that names no refusal of the account as the gateway unavailable, and records voice_refused with it', async () => {
    const { outcome, facts } = await refusedAs({ type: 'insufficient_funds', message: 'Out of funds' });

    expect(outcome).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'relay could not serve the request (HTTP 402); try again later',
    });
    expect(facts).toMatchObject([{ type: 'voice_refused', data: { because: 'provider_unavailable' } }]);
  });
});
