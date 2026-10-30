import { Effect, Exit, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';

import { openAiResponse } from '../provider-testing/provider-replies.ts';
import {
  abortedWith,
  connectionFailure,
  jsonResponse,
  recordingFetch,
  type Responder,
} from '../provider-testing/recording-fetch.ts';
import { accessFor, failed, generated, promptText, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { exposedText } from '../testing/exposure.ts';

const apiKey = 'sk-openai-SECRET-5d2f';

async function openAiFailure(respond: Responder) {
  const recording = recordingFetch(respond);
  const access = await accessFor({ OPENAI_API_KEY: apiKey }, { fetch: recording.fetch });
  const failure = await failed(access, textRequest('openai/gpt-5', { timeout_ms: 50 }));
  expect(exposedText(failure)).not.toContain(promptText);
  expect(exposedText(failure)).not.toContain(apiKey);
  return { failure, requests: recording.requests() };
}

function limitedOnce(_: unknown, attempt: number): Response {
  return attempt === 1
    ? jsonResponse({ error: { message: 'slow down' } }, 429, { 'retry-after-ms': '1' })
    : jsonResponse(openAiResponse('Hello'));
}

function abortedRequest(): Promise<Response> {
  const controller = new AbortController();
  controller.abort('a reason that is not an error');
  return fetch('http://127.0.0.1:9/never', { signal: controller.signal });
}

describe('a call that cannot reach the provider', () => {
  it('fails as provider_unavailable when the connection is refused', async () => {
    const { failure, requests } = await openAiFailure(() => connectionFailure('ECONNREFUSED'));

    expect(failure).toMatchObject({ _tag: 'provider_unavailable', provider: 'openai', status: null });
    expect(requests).toHaveLength(1);
  });

  it('fails as provider_not_configured, without retrying, when the certificate is not trusted', async () => {
    const recording = recordingFetch(() => connectionFailure('UNABLE_TO_VERIFY_LEAF_SIGNATURE'));
    const access = await accessFor({ OPENAI_API_KEY: apiKey }, { fetch: recording.fetch });

    const failure = await failed(access, textRequest('openai/gpt-5', { retries: 'adapter' }));

    expect(failure).toMatchObject({
      _tag: 'provider_not_configured',
      detail:
        'The TLS certificate of openai is not trusted by this server; its operator must add the certificate authority',
      provider: 'openai',
      configured: ['openai'],
      missing: ['NODE_EXTRA_CA_CERTS'],
    });
    expect(recording.requests()).toHaveLength(1);
  });

  it('fails as provider_unavailable when the response cannot be read', async () => {
    const { failure } = await openAiFailure(() => new Response('not json', { status: 200 }));

    expect(failure).toMatchObject({ _tag: 'provider_unavailable', provider: 'openai', status: 200 });
  });
});

describe('a call that is stopped', () => {
  it('fails as timed_out when the provider does not answer in time', async () => {
    const { failure } = await openAiFailure(({ signal }) => abortedWith(signal));

    expect(failure).toMatchObject({ _tag: 'timed_out', provider: 'openai', timeout_ms: 50 });
  });

  it('aborts the request to the provider when the call is interrupted', async () => {
    const asked = Promise.withResolvers<void>();
    const recording = recordingFetch(async ({ signal }) => {
      asked.resolve();
      await new Promise((aborted) => {
        signal.addEventListener('abort', aborted);
      });
      return abortedWith(signal);
    });
    const access = await accessFor({ OPENAI_API_KEY: apiKey }, { fetch: recording.fetch });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const calling = yield* Effect.forkChild(access.languageModel.generate(textRequest('openai/gpt-5')));
        yield* Effect.promise(() => asked.promise);
        yield* Fiber.interrupt(calling);
        return yield* Fiber.join(calling);
      }),
    );

    expect(Exit.hasInterrupts(exit)).toBe(true);
    expect(recording.requests().map(({ signal }) => signal.aborted)).toEqual([true]);
  });
});

describe('retries', () => {
  it('makes one attempt when the caller owns retries', async () => {
    const { requests } = await openAiFailure(() => jsonResponse({ error: { message: 'busy' } }, 503));

    expect(requests).toHaveLength(1);
  });

  it('retries a limited call after the delay the provider asks for', async () => {
    const recording = recordingFetch(limitedOnce);
    const access = await accessFor({ OPENAI_API_KEY: apiKey }, { fetch: recording.fetch });

    const result = await succeeded(access, textRequest('openai/gpt-5', { retries: 'adapter' }));

    expect(result.text).toBe('Hello');
    expect(recording.requests()).toHaveLength(2);
  });
});

describe('a call that fails in a way this package does not classify', () => {
  it('dies with a defect that names only the kind of failure', async () => {
    const recording = recordingFetch(abortedRequest);
    const access = await accessFor({ OPENAI_API_KEY: apiKey }, { fetch: recording.fetch });

    const exit = await generated(access, textRequest('openai/gpt-5'));

    expect(Exit.hasDies(exit)).toBe(true);
    expect(exposedText(exit)).toContain('failed with string, which this package does not classify');
    expect(exposedText(exit)).not.toContain(promptText);
  });
});
