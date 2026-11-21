import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  answeredWith,
  describingGateway,
  enforcingGateway,
  gatewayModel,
  refusedByTheGateway,
  respondedInTurn,
  usageOfOneAnswer,
} from '../provider-testing/answers-in-turn.ts';
import { mockGeneration } from '../provider-testing/mock-models.ts';
import {
  answeredPastTheDeadline,
  connectionFailure,
  jsonResponse,
  type Responder,
} from '../provider-testing/recording-fetch.ts';
import { failed, jsonRequest, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { exposedText } from '../testing/exposure.ts';

const howToAnswer = 'Answer with only a JSON value that matches this JSON Schema';

const approve = answeredWith('{"verdict":"approve"}');

describe('a JSON answer whose schema the provider refuses', () => {
  it.each([400, 422])(
    'is asked for once more with the schema in the instructions when the provider answers HTTP %i, and answers',
    async (status) => {
      const { access, requests } = await respondedInTurn(enforcingGateway, refusedByTheGateway(status), approve);

      const result = await succeeded(access, jsonRequest(gatewayModel));

      const [enforced, described] = requests().map(({ body }) => body);
      expect(enforced).toMatchObject({ response_format: { type: 'json_schema' } });
      expect(described).not.toHaveProperty('response_format');
      expect(JSON.stringify(described)).toContain(howToAnswer);
      expect(result).toMatchObject({
        json: { verdict: 'approve' },
        usage: usageOfOneAnswer,
        cost_usd: 0.25,
        output_mode: 'described',
        schema_refusal: { outcome: 'described', status },
      });
      expect(result).toHaveProperty(['schema_refusal', 'duration_ms'], expect.any(Number));
    },
  );
});

describe('a JSON answer whose request the provider refuses for something other than its schema', () => {
  it.each([
    [401, 'credentials_rejected'],
    [403, 'credentials_rejected'],
    [404, 'definition_invalid'],
    [429, 'rate_limited'],
    [500, 'provider_unavailable'],
    [503, 'provider_unavailable'],
  ])('is not asked for again when the provider answers HTTP %i, failing as %s', async (status, because) => {
    const { access, requests } = await respondedInTurn(enforcingGateway, refusedByTheGateway(status), approve);

    const failure = await failed(access, jsonRequest(gatewayModel));

    expect(requests()).toHaveLength(1);
    expect(failure).toMatchObject({ _tag: because });
    expect(failure).not.toHaveProperty('schema_refusal');
  });

  it.each([
    ['too long', 'context_length_exceeded', 'request_too_long'],
    ['against its content policy', 'content_filter', 'content_refused'],
  ])('is not asked for again when the provider refuses the request as %s', async (_what, code, because) => {
    const refused = refusedByTheGateway(400, code);
    const { access, requests } = await respondedInTurn(enforcingGateway, refused, approve);

    const failure = await failed(access, jsonRequest(gatewayModel));

    expect(requests()).toHaveLength(1);
    expect(failure).toMatchObject({ _tag: because });
  });

  it.each([
    ['a text answer', enforcingGateway, textRequest(gatewayModel)],
    ['a JSON answer whose schema was in the instructions already', describingGateway, jsonRequest(gatewayModel)],
  ])('is not asked for again for %s, and keeps the words of a refused request', async (_what, environment, request) => {
    const { access, requests } = await respondedInTurn(environment, refusedByTheGateway(400), approve);

    const failure = await failed(access, request);

    expect(requests()).toHaveLength(1);
    expect(failure).toMatchObject({
      _tag: 'definition_invalid',
      detail: 'internal answered HTTP 400: the request was rejected as invalid, with the error code 400',
    });
    expect(failure).not.toHaveProperty('schema_refusal');
  });
});

function openAiSaid(message: string): Responder {
  return () => jsonResponse({ error: { message, type: 'invalid_request_error', param: null, code: null } }, 400);
}

const pastTheDeadline: Responder = ({ signal }) => answeredPastTheDeadline(signal);

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
