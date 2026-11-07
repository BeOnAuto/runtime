import { describe, expect, it } from 'vitest';

import { enforcingGateway } from '../provider-testing/answers-in-turn.ts';
import {
  anthropicMessage,
  chatCompletion,
  converseMessage,
  geminiContent,
  openAiResponse,
} from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import type { Environment } from '../settings/setting-values.ts';
import { accessFor, jsonRequest, succeeded } from '../testing/adapter-harness.ts';

const howToAnswer = 'Answer with only a JSON value that matches this JSON Schema';

const aws = () => Promise.resolve({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' });

interface Provider {
  readonly environment: Environment;
  readonly model: string;
  readonly refusal: object;
  readonly answer: (text: string) => object;
}

const providers: readonly (readonly [string, Provider])[] = [
  [
    'anthropic',
    {
      environment: { ANTHROPIC_API_KEY: 'k' },
      model: 'anthropic/claude-sonnet-4-5',
      refusal: { type: 'error', error: { type: 'invalid_request_error', message: 'Schema is too complex.' } },
      answer: (text) => anthropicMessage(text),
    },
  ],
  [
    'bedrock',
    {
      environment: { AWS_REGION: 'us-east-1' },
      model: 'bedrock/eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
      refusal: { message: 'Schema is too complex.' },
      answer: (text) => converseMessage(text),
    },
  ],
  [
    'google',
    {
      environment: { GOOGLE_GENERATIVE_AI_API_KEY: 'g-key' },
      model: 'google/gemini-2.5-flash',
      refusal: { error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' } },
      answer: (text) => geminiContent(text),
    },
  ],
  [
    'openai',
    {
      environment: { OPENAI_API_KEY: 'k' },
      model: 'openai/gpt-5',
      refusal: {
        error: {
          message: "Invalid schema for response_format 'verdict'",
          type: 'invalid_request_error',
          param: 'text.format.schema',
          code: 'invalid_json_schema',
        },
      },
      answer: (text) => openAiResponse(text),
    },
  ],
  [
    'a gateway with structured outputs',
    {
      environment: enforcingGateway,
      model: 'internal/llama-3.3-70b',
      refusal: { error: { message: 'Invalid schema', type: null, param: null, code: '400' } },
      answer: (text) => chatCompletion(text),
    },
  ],
];

function refusedThenAnswered(refusal: object, answer: Provider['answer']) {
  return recordingFetch((_request, attempt) =>
    attempt === 1 ? jsonResponse(refusal, 400) : jsonResponse(answer('{"verdict":"approve"}')),
  );
}

describe('a JSON answer whose schema a provider refuses with HTTP 400', () => {
  it.each(providers)(
    'is asked of %s once more with the schema in the instructions instead, and answers',
    async (_provider, { environment, model, refusal, answer }) => {
      const recording = refusedThenAnswered(refusal, answer);
      const access = await accessFor(environment, { fetch: recording.fetch, credentials: { aws } });

      const result = await succeeded(access, jsonRequest(model));

      const [enforced, described] = recording.requests().map(({ body }) => JSON.stringify(body));
      expect([enforced?.includes(howToAnswer), described?.includes(howToAnswer)]).toEqual([false, true]);
      expect(result).toMatchObject({
        json: { verdict: 'approve' },
        output_mode: 'described',
        schema_refusal: { outcome: 'described', status: 400 },
      });
    },
  );
});
