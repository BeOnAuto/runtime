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
import { chatCompletion, chatCompletionRefusal } from '../provider-testing/provider-replies.ts';
import { failed, jsonRequest } from '../testing/adapter-harness.ts';

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
