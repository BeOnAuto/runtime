import {
  ContentRefused,
  CredentialsRejected,
  DefinitionInvalid,
  makeModelAccess,
  type ModelFailure,
  OutputInvalid,
  ProviderUnavailable,
  RateLimited,
  TimedOut,
} from '@on.auto/reasoning';
import { gatewayError, gatewayErrorText, gatewayInternals, recordingReporter } from '@on.auto/reasoning/testing';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startServer } from '../lifecycle/lifecycle.ts';
import type { RunningServer } from '../server-options/server-options.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { request, type TestResponse } from '../testing/servers/http-client.ts';
import { alpha, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { testComposition } from '../testing/servers/test-compositions.ts';
import { noConsentThroughAuto } from '../testing/settings/no-consent-through-auto.ts';

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
  await server.call('POST', `${alpha}/definitions/reasoning`, {
    body: { name: 'verdict', source: verdict, diagram: 'none' },
  });
  return server.call('POST', `${alpha}/definitions/reasoning/verdict/run`, {
    body: { input, run_id: runId },
  });
}

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

const alphaProviderMessages = '/v1/orgs/acme/playbooks/alpha';

const source = '---\nmodel: gateway/no-such-model-xyz\n---\nSay hello.';

const gateways = JSON.stringify([{ name: 'gateway', base_url: 'https://llm.internal.example/v1' }]);

function gatewayAnswer(): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(gatewayError), { status: 404, headers: { 'content-type': 'application/json' } }),
  );
}

const reporter = recordingReporter();

let ledger: TemporaryLedger;

let serverProviderMessages: RunningServer;

function internalsIn({ text }: TestResponse): readonly string[] {
  return gatewayInternals.filter((internal) => text.includes(internal));
}

const verdictUnconfiguredProvider = [
  '---',
  'model: openai/gpt-5',
  'output:',
  '  format: json',
  '  schema: {type: object, properties: {approve: {type: boolean}}, required: [approve], additionalProperties: false}',
  '---',
  'Should we approve {{ input.expense }}?',
].join('\n');

let serverUnconfiguredProvider: RunningServer;

function calling(method: string, path: string, body: object): Promise<TestResponse> {
  return request(serverUnconfiguredProvider.port, method, path, { body });
}

async function executedVerdict(models: Readonly<Record<string, string>>): Promise<TestResponse> {
  serverUnconfiguredProvider = await startServer(
    {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: ledger.fileName,
      ...noConsentThroughAuto,
      ...models,
    },
    testComposition({ goals: false }),
  );
  await calling('POST', '/v1/orgs/acme/playbooks', { playbook: 'alpha', name: 'Alpha' });
  await calling('POST', `${alpha}/definitions/reasoning`, {
    name: 'verdict',
    source: verdictUnconfiguredProvider,
    diagram: 'none',
  });
  return calling('POST', `${alpha}/definitions/reasoning/verdict/run`, { input: { expense: 'a dinner' } });
}

describe('reasoning failures over http', () => {
  afterEach(async () => {
    await server.stop();
  });

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
            'openai stopped the answer at max_output_tokens (300) before the JSON was complete; raise config.max_output_tokens in the reasoning function definition, or, where one answer holds several pieces of work, give each piece a function of its own',
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
});

describe('provider messages over http', () => {
  beforeEach(async () => {
    ledger = temporaryLedger();
    serverProviderMessages = await startServer(
      {
        HOST: '127.0.0.1',
        PORT: '0',
        LEDGER_FILE: ledger.fileName,
        ...noConsentThroughAuto,
        MODEL_GATEWAYS: gateways,
      },
      testComposition({
        goals: false,
        modelAccessOf: (settings) =>
          makeModelAccess(settings, { fetch: gatewayAnswer, reportProviderMessage: reporter.report }),
      }),
    );
  });

  afterEach(async () => {
    await serverProviderMessages.stop();
    ledger.remove();
  });

  describe('a run whose gateway rejects the model', () => {
    it('answers and records what the status says and the code the gateway gave, and gives the gateway text to the operator', async () => {
      await request(serverProviderMessages.port, 'POST', '/v1/orgs/acme/playbooks', {
        body: { playbook: 'alpha', name: 'Alpha' },
      });
      await request(serverProviderMessages.port, 'POST', `${alphaProviderMessages}/definitions/reasoning`, {
        body: { name: 'hello', source, diagram: 'none' },
      });
      const ran = await request(
        serverProviderMessages.port,
        'POST',
        `${alphaProviderMessages}/definitions/reasoning/hello/run`,
        {
          body: { input: {}, run_id: runId },
        },
      );
      const recorded = await request(serverProviderMessages.port, 'GET', `${alphaProviderMessages}/runs/${runId}`);
      const detail =
        'gateway answered HTTP 404: the model was not found, with the error code 404; update the reasoning function definition';

      expect(ran).toMatchObject({ status: 409, body: { reason: 'conflict', detail } });
      expect(recorded).toMatchObject({
        status: 200,
        body: { status: 'rejected', rejection: { reason: 'conflict', detail } },
      });
      expect([...internalsIn(ran), ...internalsIn(recorded)]).toEqual([]);
      expect(reporter.reports()).toEqual([
        {
          provider: 'gateway',
          model: 'gateway/no-such-model-xyz',
          status: 404,
          message: gatewayErrorText,
          run_id: runId,
        },
      ]);
    });
  });
});

describe('unconfigured provider over http', () => {
  beforeEach(() => {
    ledger = temporaryLedger();
  });

  afterEach(async () => {
    await serverUnconfiguredProvider.stop();
    ledger.remove();
  });

  describe('a run of a provider the server is not configured for', () => {
    it('answers 503 naming the provider and the providers that are configured, never a setting, without a model call', async () => {
      expect(await executedVerdict({})).toMatchObject({
        status: 503,
        body: { reason: 'unavailable', detail: 'openai is not configured. No model provider is configured' },
      });
    });

    it('names the aliases too, so an agent sees every model reference that works', async () => {
      const throughGateway = {
        MODEL_GATEWAYS: JSON.stringify([{ name: 'gateway', base_url: 'https://gateway.example.com/v1' }]),
        MODEL_ALIASES: JSON.stringify({ 'anthropic/*': 'gateway/anthropic/*' }),
      };

      expect(await executedVerdict(throughGateway)).toMatchObject({
        status: 503,
        body: {
          reason: 'unavailable',
          detail: 'openai is not configured. Configured providers: gateway. Aliases: anthropic/*',
        },
      });
    });
  });
});
