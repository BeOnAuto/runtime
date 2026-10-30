import { describe, expect, it } from 'vitest';

import type { ProviderOptions } from '../model/model-request.ts';
import { chatCompletion, openAiResponse } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch, type RecordingFetch } from '../provider-testing/recording-fetch.ts';
import { accessFor, failed, succeeded, textRequest } from '../testing/adapter-harness.ts';

const gateway = { name: 'my-gateway', base_url: 'https://llm.internal.example/v1' };

function environmentWith(allowed?: readonly string[]): Readonly<Record<string, string>> {
  const entry = allowed === undefined ? gateway : { ...gateway, allowed_provider_options: allowed };
  return { MODEL_GATEWAYS: JSON.stringify([entry]) };
}

async function callWith(
  environment: Readonly<Record<string, string>>,
  providerOptions: ProviderOptions,
): Promise<RecordingFetch> {
  const recording = recordingFetch(() => jsonResponse(chatCompletion('Hello')));
  const access = await accessFor(environment, { fetch: recording.fetch });
  await succeeded(access, textRequest('my-gateway/llama-3.3-70b', { provider_options: providerOptions }));
  return recording;
}

async function refusalOf(environment: Readonly<Record<string, string>>, providerOptions: ProviderOptions) {
  const recording = recordingFetch(() => jsonResponse(chatCompletion('Hello')));
  const access = await accessFor(environment, { fetch: recording.fetch });
  const failure = await failed(access, textRequest('my-gateway/llama-3.3-70b', { provider_options: providerOptions }));
  return { failure, requests: recording.requests() };
}

describe('the provider options of a gateway call', () => {
  it('send the fields the operator allows, under the gateway name or its camel case', async () => {
    const recording = await callWith(environmentWith(['metadata', 'user']), {
      'my-gateway': { metadata: { team: 'sales' } },
      myGateway: { user: 'tenant-7' },
      anthropic: { mock_response: 'not read by a gateway' },
    });

    expect(recording.requests()[0]?.body).toMatchObject({ metadata: { team: 'sales' }, user: 'tenant-7' });
    expect(recording.requests()[0]?.body).not.toHaveProperty('mock_response');
  });

  it('refuse a field the operator does not allow, without calling the gateway', async () => {
    const { failure, requests } = await refusalOf(environmentWith(['metadata']), {
      'my-gateway': { metadata: { team: 'sales' }, mock_response: 'Hi', api_base: 'https://elsewhere.example' },
    });

    expect(failure).toEqual(
      expect.objectContaining({
        _tag: 'definition_invalid',
        detail: 'The gateway my-gateway does not allow the provider option mock_response',
        provider: 'my-gateway',
        issues: [
          {
            pointer: '/provider_options/my-gateway/mock_response',
            detail: 'The gateway my-gateway does not allow this option',
          },
          {
            pointer: '/provider_options/my-gateway/api_base',
            detail: 'The gateway my-gateway does not allow this option',
          },
        ],
      }),
    );
    expect(requests).toEqual([]);
  });

  it.each(['my-gateway', 'myGateway', 'openaiCompatible', 'openai-compatible'])(
    'allow none by default, under %s or any other namespace the gateway reads',
    async (namespace) => {
      const { failure, requests } = await refusalOf(environmentWith(), { [namespace]: { user: 'tenant-7' } });

      expect(failure).toMatchObject({
        detail: 'The gateway my-gateway does not allow the provider option user',
        issues: [{ pointer: `/provider_options/${namespace}/user` }],
      });
      expect(requests).toEqual([]);
    },
  );
});

describe('the provider options of a call to a built-in provider', () => {
  it('are left to that provider', async () => {
    const recording = recordingFetch(() => jsonResponse(openAiResponse('Hello')));
    const access = await accessFor({ ...environmentWith(), OPENAI_API_KEY: 'sk-openai' }, { fetch: recording.fetch });

    await succeeded(
      access,
      textRequest('openai/gpt-4o', { provider_options: { openai: { user: 'tenant-7' }, 'my-gateway': { user: 'x' } } }),
    );

    expect(recording.requests()).toHaveLength(1);
  });
});

describe('provider options under a namespace no configured provider reads', () => {
  it.each([
    ['my-gateway/llama-3.3-70b', 'mistral'],
    ['openai/gpt-4o', 'other-gateway'],
  ])('refuse a call to %s, without calling the provider', async (model, namespace) => {
    const recording = recordingFetch(() => jsonResponse(openAiResponse('Hello')));
    const access = await accessFor({ ...environmentWith(), OPENAI_API_KEY: 'sk-openai' }, { fetch: recording.fetch });

    expect(
      await failed(access, textRequest(model, { provider_options: { [namespace]: { user: 'x' } } })),
    ).toMatchObject({
      _tag: 'definition_invalid',
      detail: `No configured provider reads the provider options under ${namespace}`,
      issues: [
        {
          pointer: `/provider_options/${namespace}`,
          detail: 'Expected the namespace of a built-in provider or of a configured gateway',
        },
      ],
    });
    expect(recording.requests()).toEqual([]);
  });
});
