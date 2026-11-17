import { NoObjectGeneratedError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import {
  answersInTurn,
  describingGateway,
  enforcingGateway,
  gatewayModel,
} from '../provider-testing/answers-in-turn.ts';
import { mockGeneration } from '../provider-testing/mock-models.ts';
import { recordingHints } from '../provider-testing/provider-errors.ts';
import { chatCompletion, chatCompletionRefusal, openAiResponse } from '../provider-testing/provider-replies.ts';
import { connectionFailure, jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { accessFor, failed, jsonRequest, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { documentOf, parsed } from '../testing/definition-documents.ts';

describe('a provider certificate this server does not trust', () => {
  it('tells the caller that its operator must act, and the operator which setting to use', async () => {
    const recording = recordingHints();
    const fetch = recordingFetch(() => connectionFailure('SELF_SIGNED_CERT_IN_CHAIN')).fetch;
    const access = await accessFor({ OPENAI_API_KEY: 'k' }, { fetch, reportOperatorHint: recording.report });

    const failure = await failed(access, textRequest('openai/gpt-5', { run_id: 'exec-1' }));

    expect(failure.detail).toBe(
      'The TLS certificate of openai is not trusted by this server; its operator must add the certificate authority',
    );
    expect(recording.hints()).toEqual([
      {
        provider: 'openai',
        model: 'openai/gpt-5',
        hint: 'The TLS certificate of openai is not trusted; add its certificate authority with NODE_EXTRA_CA_CERTS',
        run_id: 'exec-1',
      },
    ]);
  });
});

describe('a call that fails for another reason', () => {
  it('gives the operator no hint', async () => {
    const recording = recordingHints();
    const fetch = recordingFetch(() => jsonResponse(openAiResponse('unused'), 503)).fetch;
    const access = await accessFor({ OPENAI_API_KEY: 'k' }, { fetch, reportOperatorHint: recording.report });

    await failed(access, textRequest('openai/gpt-5', { retries: 'caller' }));

    expect(recording.hints()).toEqual([]);
  });
});

const { output } = parsed(documentOf('model: openai/gpt-5\noutput: {shape: categories}'));

const request = textRequest('openai/gpt-5', { output });

async function answering(text: string) {
  const recording = recordingFetch(() => jsonResponse(openAiResponse(text)));
  const access = await accessFor({ OPENAI_API_KEY: 'k' }, { fetch: recording.fetch });
  return { access, requests: recording.requests };
}

describe('an answer asked for in a shape', () => {
  it('is asked for with the portable form of the schema of the shape, and taken when it is in the shape', async () => {
    const { access, requests } = await answering('{"unit":"hours","values":[{"name":"A","value":1,"low":0}]}');

    expect(await succeeded(access, request)).toMatchObject({
      json: { unit: 'hours', values: [{ name: 'A', value: 1, low: 0 }] },
    });
    expect(requests()[0]?.body).toMatchObject({
      text: {
        format: { schema: { required: ['unit', 'values'], properties: { unit: { type: ['string', 'null'] } } } },
      },
    });
    expect(JSON.stringify(requests()[0]?.body)).not.toContain('https://on.auto/shapes/categories');
  });

  it('fails as output_invalid with the issues of the schema and of what the shape holds beyond it', async () => {
    const { access } = await answering(
      '{"values":[{"name":"A","value":1},{"name":"A","value":2,"low":3},{"name":"","value":4}]}',
    );

    expect(await failed(access, request)).toMatchObject({
      _tag: 'output_invalid',
      detail: 'The answer does not match the output schema',
      issues: [
        { pointer: '/values/2/name', detail: 'Expected a value with a length of at least 1' },
        { pointer: '/values/1/name', detail: 'Expected a name no value before it has' },
        { pointer: '/values/1/low', detail: 'Expected a low of at most the value' },
      ],
    });
  });
});

const refusal = "I'm sorry, I cannot assist with that request.";

describe('a JSON answer that is not asked for again', () => {
  it('is one cut off at max_output_tokens', async () => {
    const { access, requests } = await answersInTurn(describingGateway, chatCompletion('{"verdict":', 'length'));

    const failure = await failed(access, jsonRequest(gatewayModel));

    expect(requests()).toHaveLength(1);
    expect(failure).toMatchObject({ _tag: 'output_invalid', finish_reason: 'length' });
    expect(failure).not.toHaveProperty('repair');
  });

  it('is an empty one', async () => {
    const { access, requests } = await answersInTurn(describingGateway, chatCompletion(' \n'));

    const failure = await failed(access, jsonRequest(gatewayModel));

    expect(requests()).toHaveLength(1);
    expect(failure).toMatchObject({ _tag: 'output_invalid', detail: 'The answer is not JSON' });
    expect(failure).not.toHaveProperty('repair');
  });

  it.each([
    ['described to it', describingGateway, { raw_finish_reason: 'stop', output_mode: 'described' }],
    ['enforced on it', enforcingGateway, { raw_finish_reason: null }],
  ] as const)(
    'is the refusal of a model the schema is %s, which fails as content refused',
    async (_mode, gateway, more) => {
      const { access, requests } = await answersInTurn(gateway, chatCompletionRefusal(refusal));

      const failure = await failed(access, jsonRequest(gatewayModel));

      expect(requests()).toHaveLength(1);
      expect(failure).toMatchObject({
        _tag: 'content_refused',
        detail: 'internal refused to answer',
        provider: 'internal',
        status: null,
        ...more,
      });
      expect(failure).not.toHaveProperty('repair');
    },
  );
});

describe('a JSON answer the SDK could not read', () => {
  it('is not asked for again, and fails saying nothing of what the model wrote', async () => {
    const unread = Object.assign(
      new NoObjectGeneratedError({
        response: { id: 'r', timestamp: new Date(0), modelId: 'm' },
        usage: {
          inputTokens: 1,
          inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          outputTokens: 2,
          outputTokenDetails: { textTokens: 2, reasoningTokens: 0 },
          totalTokens: 3,
        },
        finishReason: 'stop',
      }),
      { finishReason: undefined, usage: undefined, response: undefined },
    );
    const mock = new MockLanguageModelV4({ doGenerate: () => Promise.reject(unread) });

    const failure = await mockGeneration(() => mock).failed(jsonRequest('mock/model'));

    expect(mock.doGenerateCalls).toHaveLength(1);
    expect(failure).toMatchObject({
      _tag: 'output_invalid',
      detail: 'The answer is not JSON',
      finish_reason: 'other',
      usage: { input: { total: null }, output: { total: null }, total: null },
    });
  });
});
