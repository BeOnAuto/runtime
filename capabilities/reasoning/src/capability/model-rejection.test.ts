import { Conflict, InvalidInput, Unavailable } from '@on.auto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ContentRefused,
  CredentialsRejected,
  ModelNotAllowed,
  OutputInvalid,
  ProviderNotConfigured,
  ProviderUnavailable,
  RateLimited,
  DefinitionInvalid,
  RequestTooLong,
  TimedOut,
  type ModelFailure,
} from '../index.ts';
import { documentOf } from '../testing/definition-documents.ts';
import { reasoningWith, type Run } from '../testing/reasoning-runs.ts';

const jsonDefinition = documentOf(
  'model: openai/gpt-5\nconfig: {max_output_tokens: 200}\noutput:\n  format: json\n  schema: {type: object}',
);

function failingWith(failure: () => ModelFailure): Promise<Run> {
  return reasoningWith(() => Effect.fail(failure())).running(jsonDefinition, { text: 'x' });
}

const unknownTokens = { total: null, uncached: null, cache_read: null, cache_write: null };

const spentOnTheCall = {
  record: {
    usage: { input: unknownTokens, output: { total: null, text: null, reasoning: null }, total: null },
    duration_ms: 0,
  },
};

describe('a provider that signals the request of a run without tools too long', () => {
  it('is unworkable, saying the request was too long by its signal, and advising a shorter prompt', async () => {
    const failure = new RequestTooLong({
      detail: 'openai refused the request as longer than the model takes, by the error code context_length_exceeded',
      provider: 'openai',
      status: 400,
      signal: 'the error code context_length_exceeded',
      provider_message: null,
      last_input_tokens: null,
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            'openai refused the request as longer than the model takes, by the error code context_length_exceeded; shorten the prompt or the input of the reasoning function',
          kind: 'unworkable',
          ...spentOnTheCall,
        }),
      ),
    );
  });
});

describe('a provider that rejects the definition', () => {
  it('is a conflict that carries the bounded message of the provider', async () => {
    const failure = new DefinitionInvalid({
      detail: 'openai answered HTTP 404: the model was not found',
      provider: 'openai',
      status: 404,
      provider_message: 'The model gpt-6 does not exist',
      issues: [],
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            'openai answered HTTP 404: the model was not found; update the reasoning function definition. The provider said: The model gpt-6 does not exist',
          kind: 'unworkable',
          ...spentOnTheCall,
        }),
      ),
    );
  });

  it('lists what the request checks found, without a message the provider did not give', async () => {
    const failure = new DefinitionInvalid({
      detail: 'The request is not valid',
      provider: null,
      status: null,
      provider_message: null,
      issues: [{ pointer: '/settings/temperature', detail: 'Expected a finite number' }],
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            'The request is not valid (/settings/temperature: Expected a finite number); update the reasoning function definition',
          kind: 'unworkable',
          ...spentOnTheCall,
        }),
      ),
    );
  });
});

describe('a JSON answer that is not usable', () => {
  it('is a conflict when it was cut off at the token limit', async () => {
    const failure = new OutputInvalid({
      detail: 'openai stopped the answer at max_output_tokens',
      provider: 'openai',
      finish_reason: 'length',
      raw_finish_reason: 'max_output_tokens',
      usage: null,
      issues: [],
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            'openai stopped the answer at max_output_tokens (200) before the JSON was complete; raise config.max_output_tokens in the reasoning function definition',
          kind: 'unworkable',
          ...spentOnTheCall,
        }),
      ),
    );
  });

  it('is unavailable when it did not match the schema', async () => {
    const failure = new OutputInvalid({
      detail: 'The answer of openai does not match the output schema',
      provider: 'openai',
      finish_reason: 'stop',
      raw_finish_reason: 'stop',
      usage: null,
      issues: [{ pointer: '/summary', detail: 'Expected string' }],
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Unavailable({
          detail: 'The answer of openai does not match the output schema (/summary: Expected string); try again',
          ...spentOnTheCall,
        }),
      ),
    );
  });
});

const cannotServe: readonly (readonly [string, () => ModelFailure, string])[] = [
  [
    'provider_not_configured',
    () =>
      new ProviderNotConfigured({
        detail: 'openai is not configured; it needs OPENAI_API_KEY',
        provider: 'openai',
        configured: [],
        missing: ['OPENAI_API_KEY'],
      }),
    'openai is not configured; it needs OPENAI_API_KEY',
  ],
  [
    'provider_not_configured, for a provider it has, such as one whose certificate it does not trust',
    () =>
      new ProviderNotConfigured({
        detail:
          'The TLS certificate of openai is not trusted by this server; its operator must add the certificate authority',
        provider: 'openai',
        configured: ['openai', 'anthropic'],
        missing: ['NODE_EXTRA_CA_CERTS'],
      }),
    'The TLS certificate of openai is not trusted by this server; its operator must add the certificate authority',
  ],
  [
    'credentials_rejected',
    () =>
      new CredentialsRejected({
        detail: 'openai rejected the credentials (HTTP 401)',
        provider: 'openai',
        status: 401,
      }),
    'openai rejected the credentials (HTTP 401)',
  ],
  [
    'rate_limited for 1.5 seconds',
    () =>
      new RateLimited({
        detail: 'openai is limiting the rate of requests',
        provider: 'openai',
        retry_after_ms: 1500,
      }),
    'openai is limiting the rate of requests; try again in 2 seconds',
  ],
  [
    'rate_limited for 20 milliseconds',
    () =>
      new RateLimited({ detail: 'openai is limiting the rate of requests', provider: 'openai', retry_after_ms: 20 }),
    'openai is limiting the rate of requests; try again in 1 second',
  ],
  [
    'rate_limited without a hint',
    () =>
      new RateLimited({
        detail: 'openai is limiting the rate of requests',
        provider: 'openai',
        retry_after_ms: null,
      }),
    'openai is limiting the rate of requests; try again later',
  ],
  [
    'provider_unavailable',
    () =>
      new ProviderUnavailable({
        detail: 'openai could not serve the request (HTTP 503)',
        provider: 'openai',
        status: 503,
      }),
    'openai could not serve the request (HTTP 503); try again later',
  ],
  [
    'timed_out',
    () => new TimedOut({ detail: 'openai did not answer within 65000 ms', provider: 'openai', timeout_ms: 65_000 }),
    'openai did not answer within 65000 ms; try again later',
  ],
];

describe('a provider that cannot serve now', () => {
  it.each(cannotServe)('is unavailable, saying which and when to try again: %s', async (_name, failure, detail) => {
    expect(await failingWith(failure)).toEqual(Exit.fail(new Unavailable({ detail, ...spentOnTheCall })));
  });
});

describe('a model outside those its operator allows', () => {
  it('is unavailable of the kind model_not_offered, because it is not allowed', async () => {
    const failure = new ModelNotAllowed({
      detail: 'openai/gpt-5 is not one of the models this server offers',
      provider: 'openai',
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Unavailable({
          detail: 'openai/gpt-5 is not one of the models this server offers',
          kind: 'model_not_offered',
          because: 'model_not_allowed',
          ...spentOnTheCall,
        }),
      ),
    );
  });
});

describe('an input the model refuses', () => {
  it('is invalid input', async () => {
    const failure = new ContentRefused({
      detail: 'openai refused the request under its content policy',
      provider: 'openai',
      status: 400,
      raw_finish_reason: null,
      usage: null,
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'openai refused the request under its content policy',
          issues: [{ pointer: '', detail: 'The model refused this input under its content policy' }],
          ...spentOnTheCall,
        }),
      ),
    );
  });
});
