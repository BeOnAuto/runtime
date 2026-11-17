import { openaiLanguageModelChatOptions } from '@ai-sdk/openai/internal';
import { describe, expect, it } from 'vitest';

import { chatCompletion } from '../provider-testing/provider-replies.ts';
import { jsonResponse, type RecordingFetch, recordingFetch } from '../provider-testing/recording-fetch.ts';
import type { ModelAccess } from '../providers/model-access.ts';
import { accessFor, failed, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { decidedOptions, offeredOptions, optionCheckFor, providerNamespaces } from './offered-provider-options.ts';

const anyWords: unknown = expect.any(String);

const offered: Readonly<Record<string, readonly string[]>> = {
  anthropic: ['thinking'],
  openai: ['textVerbosity', 'reasoningMode', 'logitBias'],
  azure: ['textVerbosity', 'reasoningMode', 'logitBias'],
  google: ['thinkingConfig', 'safetySettings', 'threshold'],
  vertex: ['thinkingConfig', 'safetySettings', 'threshold'],
  googleVertex: ['thinkingConfig', 'safetySettings', 'threshold', 'thinking'],
  amazonBedrock: ['reasoningConfig'],
  bedrock: ['reasoningConfig'],
};

const reasons = [
  'it attributes the request on the operator account',
  'it stores or reuses state on the operator account',
  'it chooses routing, fallbacks or capacity',
  'it sets request headers or betas',
  'it brings in tools or servers',
  'it adds raw fields to the request',
  'the front matter sets it',
  'the runtime manages conversation state',
  'it asks for output the runtime does not read',
  'it changes how the runtime sends the request',
];

function verdictsOf(namespace: string, option: string): readonly string[] {
  const check = optionCheckFor(namespace);
  return check === undefined ? ['no check'] : check(option, true).map(({ detail }) => detail);
}

describe('the provider options a reasoning function may set', () => {
  it('are kept for the namespaces of the built-in providers', () => {
    expect(providerNamespaces).toEqual(Object.keys(offered));
    expect(optionCheckFor('mistral')).toBeUndefined();
    expect(decidedOptions('mistral')).toEqual([]);
    expect(offeredOptions('mistral')).toEqual([]);
  });

  it.each(Object.entries(offered))('are only those that shape the answer, for %s', (namespace, options) => {
    const decided = decidedOptions(namespace);
    const accepted = decided.filter((option) => verdictsOf(namespace, option).length === 0);
    const refused = decided.filter((option) => !accepted.includes(option));

    expect(accepted).toEqual(options);
    expect(offeredOptions(namespace)).toEqual(options);
    for (const option of refused) {
      expect(reasons.map((reason) => `${option} is not offered: ${reason}`)).toContain(
        verdictsOf(namespace, option).join(),
      );
    }
  });

  it('decide every option of the OpenAI chat schema the SDK exports, so an upgrade that adds one fails', async () => {
    const schema = await openaiLanguageModelChatOptions().jsonSchema;
    const options = Object.keys({ ...schema.properties });

    expect(options.length).toBeGreaterThan(10);
    expect(options.filter((option) => !decidedOptions('openai').includes(option))).toEqual([]);
  });
});

describe('a provider option that is not offered', () => {
  it('is refused when no provider of the namespace reads it, saying what the namespace offers', () => {
    expect(verdictsOf('openai', 'temperature')).toEqual([
      'temperature is not offered: openai offers textVerbosity, reasoningMode, logitBias',
    ]);
  });

  it('is refused under an offered option when it is not pure shaping', () => {
    const check = optionCheckFor('anthropic');

    expect(check?.('thinking', { type: 'adaptive', display: 'summarized', blockBinding: {} })).toEqual([
      {
        path: ['thinking', 'blockBinding'],
        detail: anyWords,
      },
    ]);
    expect(check?.('thinking', 'adaptive')).toEqual([]);
  });

  it('is refused on Bedrock when Bedrock would send it as it is, though Anthropic models read it', () => {
    expect(verdictsOf('bedrock', 'thinking')).toEqual(['thinking is not offered: it adds raw fields to the request']);
  });
});

const gateway = { name: 'gateway', base_url: 'https://llm.internal.example/v1', api_key_env: 'GATEWAY_KEY' };

interface GatewayAccess {
  readonly access: ModelAccess;
  readonly recording: RecordingFetch;
}

async function gatewayWith(aliases: Readonly<Record<string, string>>): Promise<GatewayAccess> {
  const recording = recordingFetch(() => jsonResponse(chatCompletion('Hello')));
  const environment = {
    MODEL_GATEWAYS: JSON.stringify([gateway]),
    GATEWAY_KEY: 'gateway-key',
    MODEL_ALIASES: JSON.stringify(aliases),
  };
  return { access: await accessFor(environment, { fetch: recording.fetch }), recording };
}

async function sentModel(aliases: Readonly<Record<string, string>>, requested: string): Promise<unknown> {
  const { access, recording } = await gatewayWith(aliases);
  await succeeded(access, textRequest(requested));
  return recording.requests()[0]?.body;
}

describe('a wildcard alias', () => {
  it('sends every model of a provider through a gateway, keeping what the definition asked for', async () => {
    const { access, recording } = await gatewayWith({ 'anthropic/*': 'gateway/anthropic/*' });

    const result = await succeeded(access, textRequest('anthropic/claude-sonnet-4-5'));

    expect(result.model).toEqual({
      requested: 'anthropic/claude-sonnet-4-5',
      resolved: 'gateway/anthropic/claude-sonnet-4-5',
      answered: 'llama-3.3-70b',
    });
    expect(recording.requests()[0]).toMatchObject({
      url: 'https://llm.internal.example/v1/chat/completions',
      body: { model: 'anthropic/claude-sonnet-4-5' },
    });
  });

  it('may drop the prefix, for a gateway that names models without it', async () => {
    expect(await sentModel({ 'anthropic/*': 'gateway/*' }, 'anthropic/claude-sonnet-4-5')).toMatchObject({
      model: 'claude-sonnet-4-5',
    });
  });

  it('gives way to an exact alias, and to a longer wildcard prefix', async () => {
    const aliases = {
      'anthropic/*': 'gateway/anthropic/*',
      'anthropic/claude-opus-*': 'gateway/opus-*',
      'anthropic/claude-opus-4-1': 'gateway/opus-latest',
    };

    expect(await sentModel(aliases, 'anthropic/claude-haiku-4-5')).toMatchObject({
      model: 'anthropic/claude-haiku-4-5',
    });
    expect(await sentModel(aliases, 'anthropic/claude-opus-4')).toMatchObject({ model: 'opus-4' });
    expect(await sentModel(aliases, 'anthropic/claude-opus-4-1')).toMatchObject({ model: 'opus-latest' });
  });
});

describe('a server with a wildcard alias', () => {
  it('does not count the provider the alias covers as configured', async () => {
    const { access } = await gatewayWith({ 'anthropic/*': 'gateway/anthropic/*' });

    expect(access.status.configured).toEqual(['gateway']);
    expect(access.offered).toEqual({ providers: ['gateway'], aliases: ['anthropic/*'] });
  });

  it('names the alias, with the configured providers, when a definition names another provider', async () => {
    const { access, recording } = await gatewayWith({
      'anthropic/*': 'gateway/anthropic/*',
      'house/fast': 'gateway/x',
    });

    const failure = await failed(access, textRequest('openai/x'));

    expect(failure).toMatchObject({
      _tag: 'provider_not_configured',
      provider: 'openai',
      detail: 'openai is not configured. Configured providers: gateway. Aliases: anthropic/*, house/fast',
    });
    expect(recording.requests()).toEqual([]);
  });

  it('rejects a reference with nothing in place of the *', async () => {
    const { access } = await gatewayWith({ 'anthropic/*': 'gateway/anthropic/*' });

    expect(await failed(access, textRequest('anthropic/'))).toMatchObject({ _tag: 'definition_invalid' });
  });
});
