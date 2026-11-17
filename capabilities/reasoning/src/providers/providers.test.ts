import { NoSuchModelError } from 'ai';
import { describe, expect, it } from 'vitest';

import { anthropicMessage, chatCompletion } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { accessFor, jsonRequest, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { googleAccessTokens, guarded } from './credential-sources.ts';
import {
  type AccessToken,
  cognitiveServicesScope,
  entraIdentityLoader,
  entraTokens,
  importUnlessMissing,
} from './entra-id.ts';
import { OutboundFailure } from './outbound-failure.ts';
import { installSdkGlobals } from './sdk-globals.ts';
import { googleCredentialChain } from './vertex-providers.ts';

describe('the default credential chains', () => {
  it('are built without looking anything up', () => {
    expect(typeof googleCredentialChain('acme-ai')).toBe('function');
  });
});

describe('installSdkGlobals', () => {
  it('makes a bare model string fail instead of reaching a default gateway', () => {
    installSdkGlobals();

    expect(() => globalThis.AI_SDK_DEFAULT_PROVIDER?.languageModel('gpt-5')).toThrow(NoSuchModelError);
  });

  it('keeps the SDK from writing warnings to the console', () => {
    installSdkGlobals();

    expect(globalThis.AI_SDK_LOG_WARNINGS).toBe(false);
  });
});

describe('guarded', () => {
  it('passes a credential through', async () => {
    await expect(guarded(() => Promise.resolve('credential'))()).resolves.toBe('credential');
  });

  it('replaces any failure with one that carries nothing from it', async () => {
    const lookup = guarded(() => Promise.reject(new Error('token endpoint said SECRET')));

    await expect(lookup()).rejects.toEqual(new OutboundFailure('credential_lookup_failed'));
  });
});

describe('googleAccessTokens', () => {
  it('gives the token of the client', async () => {
    await expect(googleAccessTokens({ getAccessToken: () => Promise.resolve('ya29.token') })()).resolves.toBe(
      'ya29.token',
    );
  });

  it.each([null, undefined, ''])('fails when the client gives %j', async (token) => {
    await expect(googleAccessTokens({ getAccessToken: () => Promise.resolve(token) })()).rejects.toBeInstanceOf(
      OutboundFailure,
    );
  });
});

function missingModule(): Promise<never> {
  return Promise.reject(
    Object.assign(new Error("Cannot find package '@azure/identity'"), { code: 'ERR_MODULE_NOT_FOUND' }),
  );
}

function tokenFor(token: string): Promise<AccessToken> {
  return Promise.resolve({ token, expiresOnTimestamp: Date.now() + 3_600_000 });
}

describe('importUnlessMissing', () => {
  it('gives the module when it loads', async () => {
    await expect(importUnlessMissing(() => Promise.resolve({ loaded: true }))).resolves.toEqual({ loaded: true });
  });

  it('gives nothing when the package is not installed', async () => {
    await expect(importUnlessMissing(missingModule)).resolves.toBeUndefined();
  });

  it('passes any other failure on', async () => {
    const broken = new SyntaxError('Unexpected token');

    await expect(importUnlessMissing(() => Promise.reject(broken))).rejects.toBe(broken);
  });
});

describe('entraIdentityLoader', () => {
  it('gives nothing when the library is not installed', async () => {
    await expect(entraIdentityLoader(missingModule)()).resolves.toBeNull();
  });
});

describe('entraTokens', () => {
  it('gives the bearer tokens of the default credential for the Azure OpenAI scope', async () => {
    const tokens = entraTokens({
      defaultCredential: () => ({ getToken: () => tokenFor('unused') }),
      bearerTokens: (_, scope) => () => Promise.resolve(`token for ${scope}`),
    });

    await expect(tokens()).resolves.toBe(`token for ${cognitiveServicesScope}`);
  });
});

const gateway = {
  name: 'internal',
  base_url: 'https://llm.internal.example/v1',
  api_key_env: 'INTERNAL_LLM_KEY',
  headers: { 'x-tenant': 'acme', 'x-route': 'eu' },
  query_params: { 'api-version': '2026-09-01' },
  structured_outputs: true,
  include_usage: true,
};

function environmentWith(entry: object): Readonly<Record<string, string>> {
  return { MODEL_GATEWAYS: JSON.stringify([entry]), INTERNAL_LLM_KEY: 'internal-key' };
}

describe('a model gateway', () => {
  it('sends the key it names, its headers and its query parameters to Chat Completions', async () => {
    const recording = recordingFetch(() => jsonResponse(chatCompletion('Hello')));
    const access = await accessFor(environmentWith(gateway), { fetch: recording.fetch });

    const result = await succeeded(access, textRequest('internal/llama-3.3-70b'));

    expect(recording.requests()[0]).toMatchObject({
      url: 'https://llm.internal.example/v1/chat/completions?api-version=2026-09-01',
      headers: { authorization: 'Bearer internal-key', 'x-tenant': 'acme', 'x-route': 'eu' },
      body: { model: 'llama-3.3-70b', max_tokens: 256 },
    });
    expect(result).toMatchObject({ text: 'Hello', response_id: 'chatcmpl-B9MBs8CjcvOU2jLn4n570S5qMJKcT' });
  });

  it('sends the portable form of the schema when it supports structured outputs', async () => {
    const recording = recordingFetch(() => jsonResponse(chatCompletion('{"verdict":"approve"}')));
    const access = await accessFor(environmentWith(gateway), { fetch: recording.fetch });

    const result = await succeeded(access, jsonRequest('internal/llama-3.3-70b'));

    expect(recording.requests()[0]?.body).toMatchObject({
      response_format: { type: 'json_schema', json_schema: { name: 'verdict', strict: true } },
    });
    expect(result).toMatchObject({ json: { verdict: 'approve' }, output_mode: 'portable' });
  });

  it('describes the schema in the instructions, sends no response format, and still validates the answer, when it does not', async () => {
    const recording = recordingFetch(() => jsonResponse(chatCompletion('{"verdict":"approve"}')));
    const plain = { name: 'internal', base_url: 'https://llm.internal.example/v1' };
    const access = await accessFor(environmentWith(plain), { fetch: recording.fetch });

    const result = await succeeded(access, jsonRequest('internal/llama-3.3-70b'));

    const [request] = recording.requests();
    expect(request?.body).not.toHaveProperty('response_format');
    expect(JSON.stringify(request?.body)).toContain('Answer with only a JSON value that matches this JSON Schema');
    expect(request?.headers['authorization']).toBeUndefined();
    expect(result).toMatchObject({ json: { verdict: 'approve' }, output_mode: 'described', warnings: [] });
  });
});

async function costOfACall(entry: object, headers: Readonly<Record<string, string>>): Promise<number | undefined> {
  const recording = recordingFetch(() => jsonResponse(chatCompletion('Hello'), 200, headers));
  const access = await accessFor(environmentWith(entry), { fetch: recording.fetch });
  return (await succeeded(access, textRequest('internal/llama-3.3-70b'))).cost_usd;
}

const costing = { ...gateway, cost_header: 'X-Call-Cost' };

describe('the cost of a call through a model gateway', () => {
  it('is what the gateway answers in the header its entry names, and none when the entry names no header', async () => {
    expect(await costOfACall(costing, { 'x-call-cost': '0.000412' })).toBe(0.000412);
    expect(await costOfACall(costing, { 'x-other-cost': '1' })).toBeUndefined();
    expect(await costOfACall(gateway, { 'x-call-cost': '1.5' })).toBeUndefined();
  });

  it.each(['', ' ', 'free', '-0.1', 'Infinity'])('is none when the header says %j', async (said) => {
    expect(await costOfACall(costing, { 'x-call-cost': said })).toBeUndefined();
  });

  it('is none for a provider that is no gateway, whatever its headers say', async () => {
    const recording = recordingFetch(() => jsonResponse(anthropicMessage('Hello'), 200, { 'x-call-cost': '0.5' }));
    const access = await accessFor({ ANTHROPIC_API_KEY: 'k' }, { fetch: recording.fetch });

    expect((await succeeded(access, textRequest('anthropic/claude-sonnet-4-5'))).cost_usd).toBeUndefined();
  });
});
