import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ProviderOptions } from '../model/model-request.ts';
import { chatCompletion, openAiResponse } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch, type RecordingFetch } from '../provider-testing/recording-fetch.ts';
import { accessFor, failed, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { readModelSettings } from './model-settings.ts';
import { providerStatus } from './provider-status.ts';
import type { Environment, SettingProblem } from './setting-values.ts';

const anyWords: unknown = expect.any(String);

async function problemsOf(aliases: Readonly<Record<string, string>>): Promise<readonly SettingProblem[]> {
  const error = await Effect.runPromise(Effect.flip(readModelSettings({ MODEL_ALIASES: JSON.stringify(aliases) })));
  return error.problems;
}

function aliasProblem(alias: string, detail: string): SettingProblem {
  return { setting: 'MODEL_ALIASES', pointer: `/${alias.replaceAll('/', '~1')}`, detail };
}

const misplaced = 'A * stands once, at the end of both an alias and its target';
const oneHop = 'The target is itself an alias; an alias resolves in one hop';

describe('a wildcard alias in MODEL_ALIASES', () => {
  it('is read with a trailing * on both sides', async () => {
    const aliases = {
      'anthropic/*': 'gateway/anthropic/*',
      'openai/gpt-*': 'gateway/*',
      'house/fast': 'gateway/llama-3.3-70b',
    };

    const settings = await Effect.runPromise(readModelSettings({ MODEL_ALIASES: JSON.stringify(aliases) }));

    expect(settings.aliases).toEqual(new Map(Object.entries(aliases)));
  });

  it('is rejected when a * stands anywhere but once at the end of both sides', async () => {
    const aliases = {
      'anthropic/*': 'gateway/anthropic/model',
      'openai/gpt-5': 'gateway/*',
      'google/*/x': 'gateway/google/*/x',
      'mistral/**': 'gateway/mistral/**',
      'meta/*': 'gateway/*/meta/*',
    };

    expect(await problemsOf(aliases)).toEqual(Object.keys(aliases).map((alias) => aliasProblem(alias, misplaced)));
  });

  it('is rejected when a side is not provider/ followed by the *', async () => {
    expect(await problemsOf({ '*': 'gateway/*', 'anthropic*': 'gateway/*' })).toEqual([
      { setting: 'MODEL_ALIASES', pointer: '/*', detail: 'An alias and its target are each written provider/model' },
      aliasProblem('anthropic*', 'An alias and its target are each written provider/model'),
    ]);
  });

  it('is rejected when its target could resolve again through another alias', async () => {
    const aliases = {
      'anthropic/*': 'gateway/*',
      'gateway/fast': 'local/llama',
      'openai/*': 'relay/openai/*',
      'relay/*': 'local/*',
      'google/*': 'mirror/*',
      'mirror/google/*': 'local/google/*',
      'house/smart': 'proxy/x',
      'proxy/*': 'local/proxy/*',
    };

    expect(await problemsOf(aliases)).toEqual(
      ['anthropic/*', 'openai/*', 'google/*', 'house/smart'].map((alias) => aliasProblem(alias, oneHop)),
    );
  });
});

function statusOf(environment: Environment, entraId: boolean) {
  return Effect.runPromise(readModelSettings(environment)).then((settings) => providerStatus(settings, { entraId }));
}

const everything = {
  ANTHROPIC_API_KEY: 'a',
  OPENAI_API_KEY: 'o',
  GOOGLE_GENERATIVE_AI_API_KEY: 'g',
  AWS_REGION: 'us-east-1',
  AZURE_RESOURCE_NAME: 'acme',
  AZURE_API_KEY: 'z',
  GOOGLE_VERTEX_PROJECT: 'p',
  GOOGLE_VERTEX_LOCATION: 'us-central1',
  MODEL_GATEWAYS: JSON.stringify([{ name: 'internal', base_url: 'https://llm.internal/v1' }]),
};

describe('providerStatus', () => {
  it('lists every configured provider, the gateways last', async () => {
    const status = await statusOf(everything, false);

    expect(status).toEqual({
      configured: [
        'anthropic',
        'openai',
        'google',
        'bedrock',
        'bedrock-anthropic',
        'azure',
        'vertex',
        'vertex-anthropic',
        'internal',
      ],
      unconfigured: [],
    });
  });
});

describe('providerStatus of unconfigured providers', () => {
  it('names the settings each unconfigured provider lacks', async () => {
    const status = await statusOf({ GOOGLE_VERTEX_PROJECT: 'p' }, false);

    expect(status.configured).toEqual([]);
    expect(status.unconfigured).toEqual([
      { provider: 'anthropic', missing: ['ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN'] },
      { provider: 'openai', missing: ['OPENAI_API_KEY'] },
      { provider: 'google', missing: ['GOOGLE_GENERATIVE_AI_API_KEY'] },
      { provider: 'bedrock', missing: ['AWS_REGION'] },
      { provider: 'bedrock-anthropic', missing: ['AWS_REGION'] },
      { provider: 'azure', missing: ['AZURE_RESOURCE_NAME or AZURE_BASE_URL'] },
      { provider: 'vertex', missing: ['GOOGLE_VERTEX_LOCATION'], partial: true },
      { provider: 'vertex-anthropic', missing: ['GOOGLE_VERTEX_LOCATION'], partial: true },
    ]);
  });

  it('configures azure without a key only when Microsoft Entra ID is available', async () => {
    const withEntra = await statusOf({ AZURE_RESOURCE_NAME: 'acme' }, true);
    const withoutEntra = await statusOf({ AZURE_RESOURCE_NAME: 'acme' }, false);

    expect(withEntra.configured).toEqual(['azure']);
    expect(withoutEntra.unconfigured).toContainEqual({
      provider: 'azure',
      missing: ['AZURE_API_KEY, or the optional package @azure/identity for Microsoft Entra ID'],
      partial: true,
    });
  });
});

describe('providerStatus of partly configured providers', () => {
  it.each<readonly [string, Environment, readonly string[]]>([
    ['anthropic', { ANTHROPIC_BASE_URL: 'https://anthropic.proxy.example' }, ['anthropic']],
    ['openai', { OPENAI_API: 'chat_completions' }, ['openai']],
    ['bedrock', { AWS_BEARER_TOKEN_BEDROCK: 'token' }, ['bedrock', 'bedrock-anthropic']],
    ['azure', { AZURE_API_KEY: 'key' }, ['azure']],
    ['vertex', { GOOGLE_VERTEX_LOCATION: 'us-central1' }, ['vertex', 'vertex-anthropic']],
  ])('marks %s as partly configured when some of its settings are set', async (_name, environment, partial) => {
    const status = await statusOf(environment, false);

    expect(status.unconfigured.filter((provider) => provider.partial === true).map(({ provider }) => provider)).toEqual(
      partial,
    );
  });

  it('marks no provider as partly configured when none of their settings are set', async () => {
    const status = await statusOf({}, false);

    expect(status.unconfigured.filter((provider) => provider.partial === true)).toEqual([]);
  });
});

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
        detail: anyWords,
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
        detail: anyWords,
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
          detail: anyWords,
        },
      ],
    });
    expect(recording.requests()).toEqual([]);
  });
});
