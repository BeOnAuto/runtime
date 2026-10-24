import { getBearerTokenProvider } from '@azure/identity';
import { describe, expect, it } from 'vitest';

import { openAiResponse } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { accessFor, failed, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { cognitiveServicesScope, entraIdentityLoader, entraIdentityOf, type AccessToken } from './entra-id.ts';

const resource = { AZURE_RESOURCE_NAME: 'acme-openai' };

function replying() {
  return recordingFetch(() => jsonResponse(openAiResponse('Hello')));
}

function expiringCredentials() {
  const scopes: (string | readonly string[])[] = [];
  class ExpiringCredential {
    getToken(scope: string | readonly string[]): Promise<AccessToken> {
      scopes.push(scope);
      return Promise.resolve({ token: `entra-${scopes.length}`, expiresOnTimestamp: Date.now() });
    }
  }
  const identity = entraIdentityOf({ DefaultAzureCredential: ExpiringCredential, getBearerTokenProvider });
  return { scopes: () => scopes, identity: () => Promise.resolve(identity) };
}

const notInstalled = entraIdentityLoader(() =>
  Promise.reject(Object.assign(new Error('Cannot find package'), { code: 'ERR_MODULE_NOT_FOUND' })),
);

describe('the azure provider with an API key', () => {
  it('sends the key to the Responses API of the resource', async () => {
    const recording = replying();
    const access = await accessFor({ ...resource, AZURE_API_KEY: 'azure-key' }, { fetch: recording.fetch });

    const result = await succeeded(access, textRequest('azure/gpt-5-deployment'));

    expect(recording.requests()[0]).toMatchObject({
      url: 'https://acme-openai.openai.azure.com/openai/v1/responses?api-version=v1',
      headers: { 'api-key': 'azure-key' },
      body: { model: 'gpt-5-deployment', max_output_tokens: 256 },
    });
    expect(result.text).toBe('Hello');
  });

  it('sends requests to an Azure AZURE_BASE_URL with AZURE_API_VERSION', async () => {
    const recording = replying();
    const environment = {
      AZURE_BASE_URL: 'https://acme.cognitiveservices.azure.com/openai',
      AZURE_API_VERSION: '2025-04-01-preview',
      AZURE_API_KEY: 'azure-key',
    };
    const access = await accessFor(environment, { fetch: recording.fetch });

    await succeeded(access, textRequest('azure/gpt-5-deployment'));

    expect(recording.requests()[0]?.url).toBe(
      'https://acme.cognitiveservices.azure.com/openai/v1/responses?api-version=2025-04-01-preview',
    );
  });

  it('leaves the path and version to a gateway in front of Azure', async () => {
    const recording = replying();
    const environment = { AZURE_BASE_URL: 'https://apim.example.com/openai', AZURE_API_KEY: 'azure-key' };
    const access = await accessFor(environment, { fetch: recording.fetch });

    await succeeded(access, textRequest('azure/gpt-5-deployment'));

    expect(recording.requests()[0]?.url).toBe('https://apim.example.com/openai/responses');
  });
});

describe('the azure provider with Microsoft Entra ID', () => {
  it('sends a token from the identity library, looked up again when it expires', async () => {
    const recording = replying();
    const entra = expiringCredentials();
    const access = await accessFor(resource, { fetch: recording.fetch, loadEntraIdentity: entra.identity });

    await succeeded(access, textRequest('azure/gpt-5-deployment'));
    await succeeded(access, textRequest('azure/gpt-5-deployment'));

    const [one, two] = recording.requests();
    expect(entra.scopes()).toEqual([[cognitiveServicesScope], [cognitiveServicesScope]]);
    expect([one?.headers['authorization'], two?.headers['authorization']]).toEqual([
      'Bearer entra-1',
      'Bearer entra-2',
    ]);
    expect(one?.headers['api-key']).toBeUndefined();
    expect(access.status.configured).toEqual(['azure']);
  });

  it('uses an injected token source without loading the library', async () => {
    const recording = replying();
    const options = {
      fetch: recording.fetch,
      credentials: { azure: () => Promise.resolve('injected-token') },
      loadEntraIdentity: () => Promise.reject(new Error('The library must not be loaded')),
    };
    const access = await accessFor(resource, options);

    await succeeded(access, textRequest('azure/gpt-5-deployment'));

    expect(recording.requests()[0]?.headers['authorization']).toBe('Bearer injected-token');
  });
});

describe('the azure provider without the identity library', () => {
  it('is not configured when model access is given no loader of the library, as a shell elsewhere gives none', async () => {
    const recording = replying();
    const access = await accessFor(resource, { fetch: recording.fetch });

    expect(await failed(access, textRequest('azure/gpt-5-deployment'))).toMatchObject({
      _tag: 'provider_not_configured',
      provider: 'azure',
    });
    expect(recording.requests()).toEqual([]);
  });

  it('is not configured, and says what to install', async () => {
    const recording = replying();
    const access = await accessFor(resource, { fetch: recording.fetch, loadEntraIdentity: notInstalled });

    const failure = await failed(access, textRequest('azure/gpt-5-deployment'));

    const missing = ['AZURE_API_KEY, or the optional package @azure/identity for Microsoft Entra ID'];
    expect(failure).toMatchObject({ _tag: 'provider_not_configured', provider: 'azure', missing });
    expect(access.status.unconfigured).toContainEqual({ provider: 'azure', missing, partial: true });
    expect(recording.requests()).toEqual([]);
  });
});
