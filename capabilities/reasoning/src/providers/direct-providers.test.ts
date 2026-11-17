import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { modulesReachedFrom } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { LanguageModel } from '../model/language-model.ts';
import {
  anthropicMessage,
  anthropicToolAnswer,
  chatCompletion,
  geminiContent,
  openAiResponse,
} from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../provider-testing/recording-fetch.ts';
import { readModelSettings } from '../settings/model-settings.ts';
import { accessFor, jsonRequest, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { loadEntraIdentity } from './installed-packages.ts';
import { languageModelLayer } from './language-model-layer.ts';
import { makeModelAccess } from './model-access.ts';

function replying(body: object) {
  return recordingFetch(() => jsonResponse(body));
}

const sources = fileURLToPath(new URL('..', import.meta.url));

const libraries: ReadonlySet<string> = new Set([
  '@ai-sdk/google-vertex',
  '@ai-sdk/google-vertex/anthropic',
  '@azure/identity',
  '@on.auto/outbound/aws',
  'google-auth-library',
]);

const importsTheIdentityLibrary = /import\(\s*'@azure\/identity'\s*\)|from\s+'@azure\/identity'/u;

function namingTheIdentityLibrary(entry: string): readonly string[] {
  return modulesReachedFrom(sources, entry).files.filter((file) =>
    importsTheIdentityLibrary.test(readFileSync(join(sources, file), 'utf8')),
  );
}

function librariesReachedFrom(module: string): readonly string[] {
  return modulesReachedFrom(sources, module).packages.filter((name) => libraries.has(name));
}

describe('the anthropic provider', () => {
  it('sends the API key, the model, the instructions and the token limit to the Messages API', async () => {
    const recording = replying(anthropicMessage('Hello'));
    const access = await accessFor({ ANTHROPIC_API_KEY: 'sk-ant-key' }, { fetch: recording.fetch });

    const result = await succeeded(access, textRequest('anthropic/claude-sonnet-4-5'));

    expect(recording.requests()[0]).toMatchObject({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: { 'x-api-key': 'sk-ant-key', 'anthropic-version': '2023-06-01' },
      body: { model: 'claude-sonnet-4-5', max_tokens: 256, system: [{ type: 'text', text: 'Answer briefly' }] },
    });
    expect(result).toMatchObject({
      text: 'Hello',
      finish_reason: 'stop',
      raw_finish_reason: 'end_turn',
      response_id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
      model: {
        requested: 'anthropic/claude-sonnet-4-5',
        resolved: 'anthropic/claude-sonnet-4-5',
        answered: 'claude-sonnet-4-5-20250929',
      },
    });
  });
});

describe('the usage the anthropic provider reports', () => {
  it('includes cached input tokens', async () => {
    const access = await accessFor({ ANTHROPIC_API_KEY: 'k' }, { fetch: replying(anthropicMessage('Hi')).fetch });

    const { usage } = await succeeded(access, textRequest('anthropic/claude-sonnet-4-5'));

    expect(usage).toEqual({
      input: { total: 40, uncached: 25, cache_read: 11, cache_write: 4 },
      output: { total: 9, text: null, reasoning: null },
      total: 49,
    });
  });
});

describe('the anthropic provider behind a gateway', () => {
  it('sends ANTHROPIC_AUTH_TOKEN as a bearer token to ANTHROPIC_BASE_URL', async () => {
    const recording = replying(anthropicMessage('Hello'));
    const environment = {
      ANTHROPIC_AUTH_TOKEN: 'gateway-token',
      ANTHROPIC_BASE_URL: 'https://llm.example.com/anthropic',
    };
    const access = await accessFor(environment, { fetch: recording.fetch });

    await succeeded(access, textRequest('anthropic/claude-sonnet-4-5'));

    const [request] = recording.requests();
    expect(request?.url).toBe('https://llm.example.com/anthropic/messages');
    expect(request?.headers['authorization']).toBe('Bearer gateway-token');
    expect(request?.headers['x-api-key']).toBeUndefined();
  });
});

describe('structured output from the anthropic provider', () => {
  it('asks for structured output and validates the answer', async () => {
    const recording = replying(anthropicMessage('{"verdict":"approve"}'));
    const access = await accessFor({ ANTHROPIC_API_KEY: 'k' }, { fetch: recording.fetch });

    const result = await succeeded(access, jsonRequest('anthropic/claude-sonnet-4-5'));

    expect(recording.requests()[0]?.body).toMatchObject({
      output_config: { format: { type: 'json_schema', schema: { required: ['verdict'] } } },
    });
    expect(result.json).toEqual({ verdict: 'approve' });
  });

  it('falls back to a JSON tool for older models', async () => {
    const recording = replying(anthropicToolAnswer({ verdict: 'reject' }));
    const access = await accessFor({ ANTHROPIC_API_KEY: 'k' }, { fetch: recording.fetch });

    const result = await succeeded(access, jsonRequest('anthropic/claude-3-haiku-20240307'));

    expect(recording.requests()[0]?.body).toMatchObject({ tools: [{ name: 'json' }], tool_choice: { type: 'any' } });
    expect(result.json).toEqual({ verdict: 'reject' });
  });
});

describe('the openai provider', () => {
  it('uses the Responses API with the API key and maps reasoning and cached tokens', async () => {
    const recording = replying(openAiResponse('{"verdict":"approve"}'));
    const access = await accessFor({ OPENAI_API_KEY: 'sk-openai' }, { fetch: recording.fetch });

    const result = await succeeded(access, jsonRequest('openai/gpt-5'));

    expect(recording.requests()[0]).toMatchObject({
      url: 'https://api.openai.com/v1/responses',
      headers: { authorization: 'Bearer sk-openai' },
      body: {
        model: 'gpt-5',
        max_output_tokens: 256,
        text: { format: { type: 'json_schema', strict: true, name: 'verdict' } },
      },
    });
    expect(result).toMatchObject({
      json: { verdict: 'approve' },
      response_id: 'resp_67ccd2bed1ec8190b14f964abc054267',
      usage: {
        input: { total: 36, uncached: 16, cache_read: 20, cache_write: null },
        output: { total: 87, text: 23, reasoning: 64 },
        total: 123,
      },
    });
  });

  it('uses Chat Completions at OPENAI_BASE_URL when OPENAI_API asks for it', async () => {
    const recording = replying(chatCompletion('{"verdict":"approve"}'));
    const environment = {
      OPENAI_API_KEY: 'k',
      OPENAI_BASE_URL: 'https://proxy.example.com/v1',
      OPENAI_API: 'chat_completions',
    };
    const access = await accessFor(environment, { fetch: recording.fetch });

    const result = await succeeded(access, jsonRequest('openai/gpt-4o'));

    expect(recording.requests()[0]).toMatchObject({
      url: 'https://proxy.example.com/v1/chat/completions',
      body: { max_tokens: 256, response_format: { type: 'json_schema' } },
    });
    expect(result.json).toEqual({ verdict: 'approve' });
  });
});

describe('the google provider', () => {
  it('sends the API key and asks for JSON with the schema', async () => {
    const recording = replying(geminiContent('{"verdict":"approve"}'));
    const access = await accessFor({ GOOGLE_GENERATIVE_AI_API_KEY: 'g-key' }, { fetch: recording.fetch });

    const result = await succeeded(access, jsonRequest('google/gemini-2.5-flash'));

    expect(recording.requests()[0]).toMatchObject({
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      headers: { 'x-goog-api-key': 'g-key' },
      body: { generationConfig: { maxOutputTokens: 256, responseMimeType: 'application/json' } },
    });
    expect(result).toMatchObject({
      json: { verdict: 'approve' },
      response_id: 'gemini-response-1',
      usage: { input: { total: 14, cache_read: 5 }, output: { reasoning: 8 } },
    });
  });
});

describe('the credential libraries of the providers', () => {
  it('are reached by no entry of the capability, and load when model access is built with their provider configured', () => {
    expect([...librariesReachedFrom('index.ts'), ...librariesReachedFrom('testing/index.ts')]).toEqual([]);
    expect(librariesReachedFrom('providers/vertex-providers.ts')).toEqual([
      '@ai-sdk/google-vertex',
      '@ai-sdk/google-vertex/anthropic',
      'google-auth-library',
    ]);
  });

  it('are named by no module the main and testing entries reach, so a bundle of them asks for none, and the identity library by the installed-packages entry the server passes it from', () => {
    expect([...namingTheIdentityLibrary('index.ts'), ...namingTheIdentityLibrary('testing/index.ts')]).toEqual([]);
    expect(namingTheIdentityLibrary('providers/installed-packages.ts')).toEqual(['providers/installed-packages.ts']);
  });
});

describe('languageModelLayer', () => {
  it('provides a language model built from the environment', async () => {
    const recording = recordingFetch(() => jsonResponse(anthropicMessage('Hello')));
    const program = Effect.gen(function* () {
      const model = yield* LanguageModel;
      return yield* model.generate(textRequest('anthropic/claude-sonnet-4-5'));
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(languageModelLayer({ ANTHROPIC_API_KEY: 'k' }, { fetch: recording.fetch }))),
    );

    expect(result.text).toBe('Hello');
  });

  it('fails to build when the settings are invalid', async () => {
    const program = Effect.gen(function* () {
      return yield* LanguageModel;
    });

    const failure = await Effect.runPromise(
      Effect.flip(program.pipe(Effect.provide(languageModelLayer({ OPENAI_API: 'assistants' })))),
    );

    expect(failure).toMatchObject({ _tag: 'model_settings_invalid' });
  });
});

describe('makeModelAccess with its defaults', () => {
  it('builds every provider from the default fetch and credential chains without contacting anyone, and one provider without a key only given the loader of its identity library', async () => {
    const settings = await Effect.runPromise(
      readModelSettings({
        AWS_REGION: 'us-east-1',
        GOOGLE_VERTEX_PROJECT: 'acme-ai',
        GOOGLE_VERTEX_LOCATION: 'us-central1',
        AZURE_RESOURCE_NAME: 'acme',
      }),
    );

    const access = await Effect.runPromise(makeModelAccess(settings));
    const withTheLibrary = await Effect.runPromise(makeModelAccess(settings, { loadEntraIdentity }));

    expect(access.status.configured).toEqual(['bedrock', 'bedrock-anthropic', 'vertex', 'vertex-anthropic']);
    expect(withTheLibrary.status.configured).toEqual([
      'bedrock',
      'bedrock-anthropic',
      'azure',
      'vertex',
      'vertex-anthropic',
    ]);
  });
});
