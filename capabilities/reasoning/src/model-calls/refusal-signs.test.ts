import { describe, expect, it } from 'vitest';

import { answeredWith, enforcingGateway, gatewayModel, respondedInTurn } from '../provider-testing/answers-in-turn.ts';
import { openAiResponse } from '../provider-testing/provider-replies.ts';
import { jsonResponse, type Responder } from '../provider-testing/recording-fetch.ts';
import type { Environment } from '../settings/setting-values.ts';
import { failed, jsonRequest, succeeded } from '../testing/adapter-harness.ts';

function refusedWith(body: object): Responder {
  return () => jsonResponse(body, 400);
}

function throughTheGateway(message: string): object {
  return { error: { message, type: null, param: null, code: '400' } };
}

function openAiSaid(message: string, param: string | null, code: string | null): object {
  return { error: { message, type: 'invalid_request_error', param, code } };
}

const openAi: Environment = { OPENAI_API_KEY: 'k' };

const anthropic: Environment = { ANTHROPIC_API_KEY: 'k' };

const google: Environment = { GOOGLE_GENERATIVE_AI_API_KEY: 'g-key' };

const approvedThroughTheGateway = answeredWith('{"verdict":"approve"}');

const approvedByOpenAi: Responder = () => jsonResponse(openAiResponse('{"verdict":"approve"}'));

interface Sign {
  readonly sign: string;
  readonly environment: Environment;
  readonly model: string;
  readonly body: object;
}

const schemaRefusals: readonly (Sign & { readonly answered: Responder })[] = [
  {
    sign: "OpenAI's error code invalid_json_schema",
    environment: openAi,
    model: 'openai/gpt-5',
    body: openAiSaid(
      "Invalid schema for response_format 'response': In context=('properties', 'values', 'items'), 'required' is required to be supplied and to be an array including every key in properties. Missing 'low'.",
      'text.format.schema',
      'invalid_json_schema',
    ),
    answered: approvedByOpenAi,
  },
  {
    sign: "OpenAI's param response_format",
    environment: openAi,
    model: 'openai/gpt-5',
    body: openAiSaid('Invalid value.', 'response_format', null),
    answered: approvedByOpenAi,
  },
  {
    sign: "Anthropic's words about its schemas, through a gateway",
    environment: enforcingGateway,
    model: gatewayModel,
    body: throughTheGateway(
      'litellm.BadRequestError: AnthropicException - {"type":"error","error":{"type":"invalid_request_error","message":"Schemas contains too many parameters with union types (20 parameters with type arrays or anyOf)"}}',
    ),
    answered: approvedThroughTheGateway,
  },
  {
    sign: "Gemini's invalid argument that names none, through a gateway",
    environment: enforcingGateway,
    model: gatewayModel,
    body: throughTheGateway(
      'litellm.BadRequestError: Vertex_aiException BadRequestError - { "error": { "code": 400, "message": "Request contains an invalid argument.", "status": "INVALID_ARGUMENT" } }',
    ),
    answered: approvedThroughTheGateway,
  },
];

const otherRefusals: readonly (Sign & { readonly failure: object })[] = [
  {
    sign: "LiteLLM's ContextWindowExceededError",
    environment: enforcingGateway,
    model: gatewayModel,
    body: throughTheGateway(
      "litellm.ContextWindowExceededError: litellm.BadRequestError: This model's maximum context length is 128000 tokens",
    ),
    failure: { _tag: 'request_too_long', signal: 'its error message' },
  },
  {
    sign: "Anthropic's prompt is too long",
    environment: anthropic,
    model: 'anthropic/claude-sonnet-4-5',
    body: {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'prompt is too long: 213456 tokens > 200000 maximum' },
    },
    failure: { _tag: 'request_too_long', signal: 'its error message' },
  },
  {
    sign: "OpenAI's string_above_max_length",
    environment: openAi,
    model: 'openai/gpt-5',
    body: openAiSaid('string too long', 'input[0].content', 'string_above_max_length'),
    failure: { _tag: 'request_too_long', signal: 'the error code string_above_max_length' },
  },
  {
    sign: "Gemini's API key not valid",
    environment: google,
    model: 'google/gemini-2.5-flash',
    body: {
      error: {
        code: 400,
        message: 'API key not valid. Please pass a valid API key.',
        status: 'INVALID_ARGUMENT',
        details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }],
      },
    },
    failure: { _tag: 'credentials_rejected', detail: 'google rejected the credentials (HTTP 400)' },
  },
  {
    sign: "OpenAI's unsupported temperature",
    environment: openAi,
    model: 'openai/gpt-5',
    body: openAiSaid(
      "Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported.",
      'temperature',
      'unsupported_value',
    ),
    failure: {
      _tag: 'definition_invalid',
      detail: 'openai answered HTTP 400: the request was rejected as invalid, with the error code unsupported_value',
    },
  },
  {
    sign: "Vertex's model not in the region, through a gateway",
    environment: enforcingGateway,
    model: gatewayModel,
    body: throughTheGateway(
      `litellm.BadRequestError: Vertex_aiException BadRequestError - { "error": { "code": 400, "message": "Publisher model 'deepseek-ai/deepseek-v3.1-maas' is not available in region 'us-central1'." } }`,
    ),
    failure: {
      _tag: 'definition_invalid',
      detail: 'internal answered HTTP 400: the request was rejected as invalid, with the error code 400',
    },
  },
];

describe('a refusal that points at the answer schema', () => {
  it.each(schemaRefusals)(
    'is asked again with the schema in the instructions, by $sign',
    async ({ environment, model, body, answered }) => {
      const { access, requests } = await respondedInTurn(environment, refusedWith(body), answered);

      const result = await succeeded(access, jsonRequest(model));

      expect(requests()).toHaveLength(2);
      expect(result).toMatchObject({
        json: { verdict: 'approve' },
        schema_refusal: { outcome: 'described', status: 400 },
      });
    },
  );
});

describe('a refusal with HTTP 400 for something other than the answer schema', () => {
  it.each(otherRefusals)(
    'is not asked for again when it is $sign, and fails as what it is',
    async ({ environment, model, body, failure }) => {
      const { access, requests } = await respondedInTurn(environment, refusedWith(body), approvedByOpenAi);

      const refused = await failed(access, jsonRequest(model));

      expect(requests()).toHaveLength(1);
      expect(refused).toMatchObject(failure);
      expect(refused).not.toHaveProperty('schema_refusal');
    },
  );
});
