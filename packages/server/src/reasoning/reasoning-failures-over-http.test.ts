import {
  ContentRefused,
  CredentialsRejected,
  OutputInvalid,
  ProviderUnavailable,
  RateLimited,
  DefinitionInvalid,
  TimedOut,
  type ModelFailure,
} from '@on.auto/reasoning';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const verdict = [
  '---',
  'model: openai/gpt-5',
  'config: {max_output_tokens: 300}',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const aDinner = { expense: 'a dinner' };

function rejectedDefinition(): ModelFailure {
  return new DefinitionInvalid({
    detail: 'openai answered HTTP 400: the request was rejected as invalid',
    provider: 'openai',
    status: 400,
    provider_message: "Unsupported parameter: 'temperature'",
    issues: [],
  });
}

function cutOffAnswer(): ModelFailure {
  return new OutputInvalid({
    detail: 'openai stopped the answer at max_output_tokens',
    provider: 'openai',
    finish_reason: 'length',
    raw_finish_reason: 'max_output_tokens',
    usage: null,
    issues: [],
  });
}

function refusedContent(): ModelFailure {
  return new ContentRefused({
    detail: 'openai refused the request under its content policy',
    provider: 'openai',
    status: 400,
    raw_finish_reason: null,
    usage: null,
  });
}

function neverCalled(): ModelFailure {
  return new ProviderUnavailable({ detail: 'never called', provider: 'openai', status: null });
}

let server: ReasoningServer;

async function failingWith(failure: () => ModelFailure, input: object) {
  server = await servingReasoning([() => Effect.fail(failure())]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'verdict', source: verdict } });
  return server.call('POST', `${alpha}/definitions/reasoning/verdict/run`, {
    body: { input, run_id: runId },
  });
}

afterEach(async () => {
  await server.stop();
});

const unavailable: readonly (readonly [string, () => ModelFailure, string])[] = [
  [
    'credentials rejected',
    () =>
      new CredentialsRejected({
        detail: 'openai rejected the credentials (HTTP 401)',
        provider: 'openai',
        status: 401,
      }),
    'openai rejected the credentials (HTTP 401)',
  ],
  [
    'rate limited',
    () =>
      new RateLimited({
        detail: 'openai is limiting the rate of requests',
        provider: 'openai',
        retry_after_ms: 30_000,
      }),
    'openai is limiting the rate of requests; try again in 30 seconds',
  ],
  [
    'unavailable',
    () => new ProviderUnavailable({ detail: 'openai could not be reached', provider: 'openai', status: null }),
    'openai could not be reached; try again later',
  ],
  [
    'timed out',
    () => new TimedOut({ detail: 'openai did not answer within 67500 ms', provider: 'openai', timeout_ms: 67_500 }),
    'openai did not answer within 67500 ms; try again later',
  ],
  [
    'a JSON answer that does not match the schema',
    () =>
      new OutputInvalid({
        detail: 'The answer of openai does not match the output schema',
        provider: 'openai',
        finish_reason: 'stop',
        raw_finish_reason: 'stop',
        usage: null,
        issues: [{ pointer: '/approve', detail: 'Expected boolean' }],
      }),
    'The answer of openai does not match the output schema (/approve: Expected boolean); try again',
  ],
];

describe('a run the provider cannot serve now', () => {
  it.each(unavailable)('answers 503, saying which: %s', async (_case, failure, detail) => {
    expect(await failingWith(failure, aDinner)).toMatchObject({
      status: 503,
      body: { reason: 'unavailable', detail },
    });
  });
});

describe('a run of a definition the provider rejects', () => {
  it('answers 409 with the message of the provider, and records the conflict', async () => {
    const response = await failingWith(rejectedDefinition, aDinner);
    const detail =
      "openai answered HTTP 400: the request was rejected as invalid; update the reasoning function definition. The provider said: Unsupported parameter: 'temperature'";

    expect(response).toMatchObject({ status: 409, body: { reason: 'conflict', detail } });
    expect(await server.call('GET', `${alpha}/runs/${runId}`)).toMatchObject({
      body: { status: 'rejected', rejection: { reason: 'conflict', detail } },
    });
  });

  it('answers 409 when the JSON answer was cut off at the token limit', async () => {
    expect(await failingWith(cutOffAnswer, aDinner)).toMatchObject({
      status: 409,
      body: {
        reason: 'conflict',
        detail:
          'openai stopped the answer at max_output_tokens (300) before the JSON was complete; raise config.max_output_tokens in the reasoning function definition',
      },
    });
  });
});

describe('a run whose input cannot be used', () => {
  it('answers 422 under /input when the model refuses the content', async () => {
    expect(await failingWith(refusedContent, aDinner)).toMatchObject({
      status: 422,
      body: {
        reason: 'invalid_input',
        detail: 'openai refused the request under its content policy',
        errors: [{ pointer: '/input', detail: 'The model refused this input under its content policy' }],
      },
    });
  });

  it('answers 422 naming the field the template reads and the input lacks', async () => {
    const response = await failingWith(neverCalled, { amount: 12 });

    expect(response).toMatchObject({
      status: 422,
      body: {
        reason: 'invalid_input',
        errors: [
          {
            pointer: '/input/expense',
            detail: 'Line 8: the template reads input.expense, which this input does not have',
          },
        ],
      },
    });
    expect(server.modelCalls()).toBe(0);
  });
});
