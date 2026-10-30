import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { exposedText } from '../testing/exposure.ts';
import { readModelSettings, type ModelSettings, type ModelSettingsInvalid } from './model-settings.ts';
import type { Environment } from './setting-values.ts';

const secret = 'sk-SECRET-value-3a7b';

function settingsOf(environment: Environment): Promise<ModelSettings> {
  return Effect.runPromise(readModelSettings(environment));
}

function invalidSettings(environment: Environment): Promise<ModelSettingsInvalid> {
  return Effect.runPromise(Effect.flip(readModelSettings(environment)));
}

describe('readModelSettings with nothing set', () => {
  it('configures no provider and names what each one needs', async () => {
    const settings = await settingsOf({});

    expect(settings).toEqual({
      anthropic: { configured: false, missing: ['ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN'] },
      openai: { configured: false, missing: ['OPENAI_API_KEY'] },
      google: { configured: false, missing: ['GOOGLE_GENERATIVE_AI_API_KEY'] },
      bedrock: { configured: false, missing: ['AWS_REGION'] },
      azure: { configured: false, missing: ['AZURE_RESOURCE_NAME or AZURE_BASE_URL'] },
      vertex: { configured: false, missing: ['GOOGLE_VERTEX_PROJECT', 'GOOGLE_VERTEX_LOCATION'] },
      gateways: [],
      aliases: new Map(),
      declared: new Map(),
      allowed: null,
    });
  });

  it('treats empty values as not set', async () => {
    const settings = await settingsOf({ OPENAI_API_KEY: '', GOOGLE_VERTEX_PROJECT: 'p', GOOGLE_VERTEX_LOCATION: '' });

    expect(settings.openai).toEqual({ configured: false, missing: ['OPENAI_API_KEY'] });
    expect(settings.vertex).toEqual({ configured: false, missing: ['GOOGLE_VERTEX_LOCATION'], partial: true });
  });
});

describe('readModelSettings for the direct providers', () => {
  it('reads every setting of anthropic, openai and google, a base URL without the slashes it ends in', async () => {
    const settings = await settingsOf({
      ANTHROPIC_API_KEY: 'a-key',
      ANTHROPIC_BASE_URL: 'https://llm.example.com/anthropic/',
      OPENAI_API_KEY: 'o-key',
      OPENAI_BASE_URL: 'https://llm.example.com/openai///',
      OPENAI_API: 'chat_completions',
      GOOGLE_GENERATIVE_AI_API_KEY: 'g-key',
    });

    expect(settings.anthropic).toEqual({
      configured: true,
      settings: {
        credential: { type: 'api_key', key: Redacted.make('a-key') },
        base_url: 'https://llm.example.com/anthropic',
      },
    });
    expect(settings.openai).toEqual({
      configured: true,
      settings: {
        api_key: Redacted.make('o-key'),
        base_url: 'https://llm.example.com/openai',
        api: 'chat_completions',
      },
    });
    expect(settings.google).toEqual({ configured: true, settings: { api_key: Redacted.make('g-key') } });
  });

  it('defaults to the providers own endpoints and the Responses API', async () => {
    const settings = await settingsOf({ ANTHROPIC_AUTH_TOKEN: 'token', OPENAI_API_KEY: 'o-key' });

    expect(settings.anthropic).toEqual({
      configured: true,
      settings: { credential: { type: 'auth_token', token: Redacted.make('token') }, base_url: null },
    });
    expect(settings.openai).toMatchObject({ settings: { base_url: null, api: 'responses' } });
  });
});

describe('readModelSettings for bedrock', () => {
  it('reads bedrock with the runtime endpoint before the general one', async () => {
    const settings = await settingsOf({
      AWS_REGION: 'eu-central-1',
      AWS_BEARER_TOKEN_BEDROCK: 'b-token',
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: 'https://runtime.example.com',
      AWS_ENDPOINT_URL: 'https://aws.example.com',
    });

    expect(settings.bedrock).toEqual({
      configured: true,
      settings: {
        region: 'eu-central-1',
        bearer_token: Redacted.make('b-token'),
        endpoint: 'https://runtime.example.com',
      },
    });
  });

  it('reads bedrock with the general endpoint, or none', async () => {
    const general = await settingsOf({ AWS_REGION: 'us-east-1', AWS_ENDPOINT_URL: 'https://aws.example.com' });
    const plain = await settingsOf({ AWS_REGION: 'us-east-1' });

    expect(general.bedrock).toMatchObject({ settings: { endpoint: 'https://aws.example.com', bearer_token: null } });
    expect(plain.bedrock).toMatchObject({ settings: { endpoint: null } });
  });
});

describe('readModelSettings for azure and vertex', () => {
  it('reads azure with a resource name and a key, or a base URL for Entra ID', async () => {
    const keyed = await settingsOf({
      AZURE_RESOURCE_NAME: 'acme',
      AZURE_API_KEY: 'z-key',
      AZURE_API_VERSION: '2025-04-01-preview',
    });
    const entra = await settingsOf({ AZURE_BASE_URL: 'https://acme.cognitiveservices.azure.com/openai' });

    expect(keyed.azure).toEqual({
      configured: true,
      settings: {
        endpoint: { resource_name: 'acme' },
        api_version: '2025-04-01-preview',
        api_key: Redacted.make('z-key'),
      },
    });
    expect(entra.azure).toEqual({
      configured: true,
      settings: {
        endpoint: { base_url: 'https://acme.cognitiveservices.azure.com/openai' },
        api_version: null,
        api_key: null,
      },
    });
  });

  it('reads vertex', async () => {
    const settings = await settingsOf({ GOOGLE_VERTEX_PROJECT: 'acme-ai', GOOGLE_VERTEX_LOCATION: 'global' });

    expect(settings.vertex).toEqual({ configured: true, settings: { project: 'acme-ai', location: 'global' } });
  });
});

describe('readModelSettings with malformed values', () => {
  it('names every problem without echoing a value', async () => {
    const error = await invalidSettings({
      ANTHROPIC_API_KEY: secret,
      ANTHROPIC_AUTH_TOKEN: secret,
      ANTHROPIC_BASE_URL: `ftp://${secret}`,
      OPENAI_API_KEY: secret,
      OPENAI_BASE_URL: `not a url ${secret}`,
      OPENAI_API: 'assistants',
      AWS_REGION: 'us east 1',
      AWS_ENDPOINT_URL: 'nope',
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: 'nope',
      AZURE_RESOURCE_NAME: 'acme.openai',
      AZURE_BASE_URL: `https://${secret}.example.com`,
      GOOGLE_VERTEX_LOCATION: 'us/central',
    });

    expect(error.problems).toEqual([
      { setting: 'ANTHROPIC_AUTH_TOKEN', detail: 'Set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN, not both' },
      { setting: 'ANTHROPIC_BASE_URL', detail: 'Expected an http or https URL' },
      { setting: 'OPENAI_BASE_URL', detail: 'Expected an http or https URL' },
      { setting: 'OPENAI_API', detail: 'Expected responses or chat_completions' },
      { setting: 'AWS_REGION', detail: 'Expected letters, digits and hyphens only' },
      { setting: 'AWS_ENDPOINT_URL_BEDROCK_RUNTIME', detail: 'Expected an http or https URL' },
      { setting: 'AWS_ENDPOINT_URL', detail: 'Expected an http or https URL' },
      { setting: 'AZURE_BASE_URL', detail: 'Set AZURE_RESOURCE_NAME or AZURE_BASE_URL, not both' },
      { setting: 'AZURE_RESOURCE_NAME', detail: 'Expected letters, digits and hyphens only' },
      { setting: 'GOOGLE_VERTEX_LOCATION', detail: 'Expected letters, digits and hyphens only' },
    ]);
    expect(error.message).toContain('The model settings are invalid. ANTHROPIC_AUTH_TOKEN: Set ANTHROPIC_API_KEY');
    expect(exposedText(error)).not.toContain(secret);
  });
});
