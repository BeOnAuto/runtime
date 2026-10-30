import { describe, expect, it } from 'vitest';

import { chatCompletion } from '../provider-testing/provider-replies.ts';
import { jsonResponse, type RecordingFetch, recordingFetch } from '../provider-testing/recording-fetch.ts';
import type { ModelAccess } from '../providers/model-access.ts';
import { accessFor, failed, succeeded, textRequest } from '../testing/adapter-harness.ts';

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
