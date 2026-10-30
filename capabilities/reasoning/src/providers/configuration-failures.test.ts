import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { anthropicMessage } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { readModelSettings } from '../settings/model-settings.ts';
import { accessFor, failed, promptText, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { exposedText } from '../testing/exposure.ts';
import { makeModelAccess } from './model-access.ts';

const secret = 'SECRET-credential-material-91b0';

function unavailableCredential(): Promise<never> {
  return Promise.reject(new Error(`could not refresh ${secret}`));
}

const environments = {
  bedrock: { AWS_REGION: 'us-east-1' },
  vertex: { GOOGLE_VERTEX_PROJECT: 'acme-ai', GOOGLE_VERTEX_LOCATION: 'us-central1' },
  azure: { AZURE_RESOURCE_NAME: 'acme-openai' },
};

const failingSources: readonly (readonly [string, string, Readonly<Record<string, string>>])[] = [
  ['bedrock', 'bedrock/amazon.nova-pro-v1:0', environments.bedrock],
  ['bedrock-anthropic', 'bedrock-anthropic/us.anthropic.claude-sonnet-4-5-20250929-v1:0', environments.bedrock],
  ['vertex', 'vertex/gemini-2.5-flash', environments.vertex],
  ['vertex-anthropic', 'vertex-anthropic/claude-sonnet-4-5', environments.vertex],
  ['azure', 'azure/gpt-5-deployment', environments.azure],
];

describe('a credential source that fails', () => {
  it.each(failingSources)(
    'makes %s fail as credentials_rejected without sending anything',
    async (provider, model, environment) => {
      const recording = recordingFetch(() => jsonResponse(anthropicMessage('unused')));
      const credentials = { aws: unavailableCredential, google: unavailableCredential, azure: unavailableCredential };
      const access = await accessFor(environment, { fetch: recording.fetch, credentials });

      const failure = await failed(access, textRequest(model, { retries: 'adapter' }));

      expect(failure).toMatchObject({
        _tag: 'credentials_rejected',
        provider,
        status: null,
        detail: `No credentials could be obtained for ${provider} from its credential source`,
      });
      expect(exposedText(failure)).not.toContain(secret);
      expect(exposedText(failure)).not.toContain(promptText);
      expect(recording.requests()).toEqual([]);
    },
  );
});

describe('a model reference that does not resolve', () => {
  it('fails as provider_not_configured, naming the configured providers and no setting', async () => {
    const recording = recordingFetch(() => jsonResponse(anthropicMessage('unused')));
    const access = await accessFor({ ANTHROPIC_API_KEY: secret }, { fetch: recording.fetch });

    const failure = await failed(access, textRequest('openai/gpt-5'));

    expect(failure).toMatchObject({
      _tag: 'provider_not_configured',
      provider: 'openai',
      configured: ['anthropic'],
      missing: ['OPENAI_API_KEY'],
      detail: 'openai is not configured. Configured providers: anthropic',
    });
    expect(exposedText(failure)).not.toContain(secret);
    expect(recording.requests()).toEqual([]);
  });

  it('fails as provider_not_configured, saying that none is configured, for an unknown prefix', async () => {
    const access = await accessFor({}, { fetch: recordingFetch(() => jsonResponse({})).fetch });

    const failure = await failed(access, textRequest('mistral/large'));

    expect(failure).toMatchObject({
      _tag: 'provider_not_configured',
      provider: 'mistral',
      configured: [],
      missing: [],
      detail: 'There is no provider named mistral. No model provider is configured',
    });
  });

  it.each(['claude-sonnet-4-5', '/claude', 'anthropic/'])(
    'fails as definition_invalid for the bare reference %s, without sending anything',
    async (model) => {
      const recording = recordingFetch(() => jsonResponse(anthropicMessage('unused')));
      const access = await accessFor({ ANTHROPIC_API_KEY: 'k' }, { fetch: recording.fetch });

      const failure = await failed(access, textRequest(model));

      expect(failure).toMatchObject({
        _tag: 'definition_invalid',
        provider: null,
        issues: [{ pointer: '/model', detail: 'Expected provider/model' }],
      });
      expect(recording.requests()).toEqual([]);
    },
  );
});

describe('model aliases', () => {
  it('resolve one reference to another before the provider is chosen', async () => {
    const recording = recordingFetch(() => jsonResponse(anthropicMessage('Hello')));
    const environment = {
      ANTHROPIC_API_KEY: 'k',
      MODEL_ALIASES: JSON.stringify({ 'fast/default': 'anthropic/claude-haiku-4-5' }),
    };
    const access = await accessFor(environment, { fetch: recording.fetch });

    const result = await succeeded(access, textRequest('fast/default'));

    expect(result.model).toEqual({
      requested: 'fast/default',
      resolved: 'anthropic/claude-haiku-4-5',
      answered: 'claude-sonnet-4-5-20250929',
    });
    expect(recording.requests()[0]?.body).toMatchObject({ model: 'claude-haiku-4-5' });
    expect(access.offered).toEqual({ providers: ['anthropic'], aliases: ['fast/default'] });
  });
});

describe('a model reference to a provider the server has not set up', () => {
  it('says how a person sets one up, where the server says', async () => {
    const settings = await Effect.runPromise(readModelSettings({}));
    const access = await Effect.runPromise(
      makeModelAccess(
        { ...settings, providerSetup: 'To add one, the person puts a key in the settings of the server.' },
        { fetch: recordingFetch(() => jsonResponse({})).fetch },
      ),
    );

    const failure = await failed(access, textRequest('anthropic/claude-sonnet-4-5'));

    expect(failure).toMatchObject({
      _tag: 'provider_not_configured',
      detail:
        'anthropic is not configured. No model provider is configured. To add one, the person puts a key in the settings of the server.',
    });
  });
});
