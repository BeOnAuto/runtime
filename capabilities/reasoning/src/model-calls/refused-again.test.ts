import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  enforcingGateway,
  gatewayModel,
  refusedByTheGateway,
  respondedInTurn,
} from '../provider-testing/answers-in-turn.ts';
import { mockGeneration } from '../provider-testing/mock-models.ts';
import { abortedWith, connectionFailure, jsonResponse, type Responder } from '../provider-testing/recording-fetch.ts';
import { failed, jsonRequest } from '../testing/adapter-harness.ts';
import { exposedText } from '../testing/exposure.ts';

function openAiSaid(message: string): Responder {
  return () => jsonResponse({ error: { message, type: 'invalid_request_error', param: null, code: null } }, 400);
}

const pastTheDeadline: Responder = ({ signal }) => abortedWith(signal);

const untrusted: Responder = () => connectionFailure('SELF_SIGNED_CERT_IN_CHAIN');

const schemaRefused = new APICallError({
  message: 'Invalid schema for response_format',
  url: 'https://api.example.com/v1/chat/completions',
  requestBodyValues: {},
  statusCode: 400,
});

function refusedThenThrowing(error: Readonly<Error>): MockLanguageModelV4 {
  const calls = { made: 0 };
  return new MockLanguageModelV4({
    doGenerate: () => {
      calls.made += 1;
      return Promise.reject(calls.made === 1 ? schemaRefused : error);
    },
  });
}

describe('a JSON answer whose schema the provider refuses, asked for once more by a request it refuses too', () => {
  it('fails as definition_invalid, in words that drop the error code, recording that the schema was not the cause', async () => {
    const { access, requests } = await respondedInTurn(
      enforcingGateway,
      refusedByTheGateway(400),
      refusedByTheGateway(422),
    );

    const failure = await failed(access, jsonRequest(gatewayModel));

    expect(requests()).toHaveLength(2);
    expect(failure).toMatchObject({
      _tag: 'definition_invalid',
      detail: 'internal refused the request (HTTP 422): the request was rejected as invalid',
      provider: 'internal',
      status: 422,
      provider_message: null,
      issues: [],
      schema_refusal: { outcome: 'refused_again', status: 400 },
    });
    expect(failure).not.toHaveProperty('output_mode');
  });

  it("carries the provider's words for the second request, and tells the operator its words for both", async () => {
    const { access, reports } = await respondedInTurn(
      { OPENAI_API_KEY: 'sk-openai-SECRET-5d2f' },
      openAiSaid('Invalid schema for response_format'),
      openAiSaid('Unsupported parameter: temperature'),
    );

    const failure = await failed(access, jsonRequest('openai/gpt-5'));

    expect(failure).toMatchObject({
      detail: 'openai refused the request (HTTP 400): the request was rejected as invalid',
      provider_message: 'Unsupported parameter: temperature',
      schema_refusal: { outcome: 'refused_again', status: 400 },
    });
    expect(reports().map(({ status, message }) => ({ status, message }))).toEqual([
      { status: 400, message: 'Invalid schema for response_format' },
      { status: 400, message: 'Unsupported parameter: temperature' },
    ]);
  });
});

describe('a JSON answer whose schema the provider refuses, asked for once more by a request that fails otherwise', () => {
  it.each([
    ['answers HTTP 429', 'rate_limited', refusedByTheGateway(429), {}],
    ['answers HTTP 503', 'provider_unavailable', refusedByTheGateway(503), {}],
    ['answers HTTP 401', 'credentials_rejected', refusedByTheGateway(401), {}],
    ['answers HTTP 413', 'request_too_long', refusedByTheGateway(413), {}],
    ['answers HTTP 404', 'definition_invalid', refusedByTheGateway(404), {}],
    ['meets a certificate this server does not trust', 'provider_not_configured', untrusted, {}],
    ['runs past the deadline', 'timed_out', pastTheDeadline, { timeout_ms: 300 }],
  ] as const)(
    'fails as that request did when it %s, recording that the schema was refused and the answer asked for again',
    async (_what, because, second, more) => {
      const { access, requests } = await respondedInTurn(enforcingGateway, refusedByTheGateway(400), second);

      const failure = await failed(access, jsonRequest(gatewayModel, more));

      expect(requests()).toHaveLength(2);
      expect(failure).toMatchObject({ _tag: because, schema_refusal: { outcome: 'described', status: 400 } });
      expect(failure).not.toHaveProperty('output_mode');
    },
  );

  it('dies, as an error this package does not know, naming only its kind', async () => {
    const mock = refusedThenThrowing(new TypeError('not a provider'));

    const exit = await mockGeneration(() => mock).exit(jsonRequest('mock/model'));

    expect(mock.doGenerateCalls).toHaveLength(2);
    expect(Exit.hasDies(exit)).toBe(true);
    expect(exposedText(exit)).toContain('The call to mock failed with TypeError');
  });
});
