import { describe, expect, it } from 'vitest';

import type { ModelFailure } from '../failure/model-failure.ts';
import { RateLimited } from '../failure/rate-limited.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { accessFor, failed, promptText, textRequest } from '../testing/adapter-harness.ts';
import { exposedText } from '../testing/exposure.ts';

const apiKey = 'sk-openai-SECRET-5d2f';

function openAiError(message: string, code: string | null = null): object {
  return { error: { message, type: 'invalid_request_error', param: null, code } };
}

async function failureFor(
  response: () => Response,
  environment: Readonly<Record<string, string>> = {},
): Promise<ModelFailure> {
  const recording = recordingFetch(response);
  const access = await accessFor({ OPENAI_API_KEY: apiKey, ...environment }, { fetch: recording.fetch });
  const failure = await failed(access, textRequest('openai/gpt-5'));
  expect(exposedText(failure)).not.toContain(promptText);
  expect(exposedText(failure)).not.toContain(apiKey);
  expect(recording.requests()).toHaveLength(1);
  return failure;
}

function staticAwsCredentials() {
  return Promise.resolve({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' });
}

function retryAfterOf(failure: unknown): number | null {
  return failure instanceof RateLimited ? failure.retry_after_ms : null;
}

describe('a provider that rejects the request', () => {
  it.each([
    [400, 'the request was rejected as invalid'],
    [404, 'the model was not found'],
    [422, 'the request was rejected as invalid'],
    [418, 'the request was not accepted'],
  ])(
    'fails as definition_invalid on HTTP %i, saying what the status means and quoting the provider',
    async (status, reading) => {
      const failure = await failureFor(() => jsonResponse(openAiError('Unsupported parameter: temperature'), status));

      expect(failure).toMatchObject({
        _tag: 'definition_invalid',
        provider: 'openai',
        status,
        provider_message: 'Unsupported parameter: temperature',
        detail: `openai answered HTTP ${status}: ${reading}`,
      });
    },
  );
});

describe('a provider that signals the request too long', () => {
  it.each([
    ['HTTP 413', 413, openAiError('Request Entity Too Large')],
    ['the error code context_length_exceeded', 400, openAiError('Too many tokens', 'context_length_exceeded')],
    [
      'the error type request_too_large',
      400,
      { error: { message: 'Too many tokens', type: 'request_too_large', param: null, code: null } },
    ],
  ])('fails as request_too_long by %s', async (signal, status, body) => {
    const failure = await failureFor(() => jsonResponse(body, status));

    expect(failure).toMatchObject({
      _tag: 'request_too_long',
      provider: 'openai',
      status,
      signal,
      detail: `openai refused the request as longer than the model takes, by ${signal}`,
      last_input_tokens: null,
    });
  });

  it('claims no length for a message that says too long without a signal, and names the code the body carries', async () => {
    const failure = await failureFor(() =>
      jsonResponse(openAiError('string too long', 'string_above_max_length'), 400),
    );

    expect(failure).toMatchObject({
      _tag: 'definition_invalid',
      provider_message: 'string too long',
      detail:
        'openai answered HTTP 400: the request was rejected as invalid, with the error code string_above_max_length',
    });
  });
});

describe('the error code of a rejected request', () => {
  it('is cut at a code point past 64 characters, with the mark of a cut', async () => {
    const code = `${'x'.repeat(63)}😀${'y'.repeat(40)}`;

    const failure = await failureFor(() => jsonResponse(openAiError('Unsupported parameter', code), 400));

    expect(failure.detail).toBe(
      `openai answered HTTP 400: the request was rejected as invalid, with the error code ${'x'.repeat(63)}😀…`,
    );
  });

  it("is scrubbed of a configured key, also where the provider's message is hidden", async () => {
    const hidden = { OPENAI_BASE_URL: 'https://proxy.example.com/v1' };

    const failure = await failureFor(
      () => jsonResponse(openAiError('Unsupported parameter', `key_${apiKey}_refused`), 400),
      hidden,
    );

    expect(failure).toMatchObject({
      _tag: 'definition_invalid',
      provider_message: null,
      detail:
        'openai answered HTTP 400: the request was rejected as invalid, with the error code key_[redacted]_refused',
    });
  });
});

describe('the provider message of a rejected request', () => {
  it('never quotes a raw response body', async () => {
    const failure = await failureFor(() => new Response('upstream said no', { status: 400 }));

    expect(failure).toMatchObject({ _tag: 'definition_invalid', provider_message: null });
  });

  it('never quotes a body that the SDK passes on as the message', async () => {
    const body = JSON.stringify({ upstream: { echoed: promptText } });
    const recording = recordingFetch(() => new Response(body, { status: 400 }));
    const access = await accessFor(
      { AWS_REGION: 'us-east-1' },
      { fetch: recording.fetch, credentials: { aws: staticAwsCredentials } },
    );

    const failure = await failed(access, textRequest('bedrock-anthropic/us.anthropic.claude-sonnet-4-5-20250929-v1:0'));

    expect(failure).toMatchObject({
      _tag: 'definition_invalid',
      provider: 'bedrock-anthropic',
      provider_message: null,
    });
    expect(exposedText(failure)).not.toContain(promptText);
  });
});

describe('a provider that refuses or will not authorise the request', () => {
  it('fails as content_refused when the request breaks the content policy', async () => {
    const failure = await failureFor(() => jsonResponse(openAiError('The prompt was filtered', 'content_filter'), 400));

    expect(failure).toMatchObject({ _tag: 'content_refused', provider: 'openai', status: 400, usage: null });
  });

  it.each([401, 403])('fails as credentials_rejected on HTTP %i', async (status) => {
    const failure = await failureFor(() => jsonResponse(openAiError('Incorrect API key provided'), status));

    expect(failure).toMatchObject({ _tag: 'credentials_rejected', provider: 'openai', status });
  });

  it.each([408, 409, 500, 503, 529])('fails as provider_unavailable on HTTP %i', async (status) => {
    const failure = await failureFor(() => jsonResponse(openAiError('Overloaded'), status));

    expect(failure).toMatchObject({ _tag: 'provider_unavailable', provider: 'openai', status });
  });
});

const retryHints: readonly (readonly [string, Readonly<Record<string, string>>, number | null])[] = [
  ['no hint', {}, null],
  ['retry-after in seconds', { 'retry-after': '30' }, 30_000],
  ['retry-after-ms', { 'retry-after-ms': '1500.2' }, 1501],
  ['an unreadable retry-after', { 'retry-after': 'soon' }, null],
  ['a retry-after date in the past', { 'retry-after': new Date(Date.now() - 60_000).toUTCString() }, 0],
];

describe('a provider that limits the rate', () => {
  it.each(retryHints)('fails as rate_limited with %s', async (_, headers, retryAfter) => {
    const failure = await failureFor(() => jsonResponse(openAiError('Rate limit reached'), 429, headers));

    expect(failure).toMatchObject({ _tag: 'rate_limited', provider: 'openai', retry_after_ms: retryAfter });
  });

  it('reads a retry-after date', async () => {
    const later = new Date(Date.now() + 120_000).toUTCString();

    const failure = await failureFor(() =>
      jsonResponse(openAiError('Rate limit reached'), 429, { 'retry-after': later }),
    );

    expect(retryAfterOf(failure)).toBeGreaterThan(100_000);
  });
});
