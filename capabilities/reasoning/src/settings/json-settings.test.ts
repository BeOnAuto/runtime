import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { exposedText } from '../testing/exposure.ts';
import { readModelSettings } from './model-settings.ts';
import type { Environment, SettingProblem } from './setting-values.ts';

const secret = 'header-SECRET-value-6c2d';

async function problemsOf(environment: Environment): Promise<readonly SettingProblem[]> {
  const error = await Effect.runPromise(Effect.flip(readModelSettings(environment)));
  expect(exposedText(error)).not.toContain(secret);
  return error.problems;
}

function gateways(entries: unknown): Environment {
  return { MODEL_GATEWAYS: JSON.stringify(entries), GATEWAY_KEY: secret };
}

const internal = {
  name: 'internal',
  base_url: 'https://llm.internal/v1',
  api_key_env: 'GATEWAY_KEY',
  headers: { 'x-tenant': secret },
  query_params: { 'api-version': '1' },
  structured_outputs: true,
  include_usage: true,
  expose_provider_messages: true,
  allowed_provider_options: ['metadata', 'user'],
  cost_header: 'X-Cost',
};

describe('MODEL_GATEWAYS', () => {
  it('reads each gateway with its key, headers, query parameters and switches, keeps secrets redacted and trims its base URL', async () => {
    const settings = await Effect.runPromise(
      readModelSettings(gateways([internal, { name: 'local', base_url: 'http://localhost:11434/v1//' }])),
    );

    expect(settings.gateways).toEqual([
      {
        name: 'internal',
        base_url: 'https://llm.internal/v1',
        api_key: Redacted.make(secret),
        api_key_env: 'GATEWAY_KEY',
        headers: new Map([['x-tenant', Redacted.make(secret)]]),
        query_params: new Map([['api-version', Redacted.make('1')]]),
        structured_outputs: true,
        include_usage: true,
        expose_provider_messages: true,
        allowed_provider_options: new Set(['metadata', 'user']),
        cost_header: 'x-cost',
      },
      {
        name: 'local',
        base_url: 'http://localhost:11434/v1',
        api_key: null,
        api_key_env: null,
        headers: new Map(),
        query_params: new Map(),
        structured_outputs: false,
        include_usage: false,
        expose_provider_messages: false,
        allowed_provider_options: new Set(),
        cost_header: null,
      },
    ]);
    expect(exposedText(settings.gateways)).not.toContain(secret);
  });
});

describe('the key of a gateway', () => {
  it('is read from api_key itself, and kept redacted', async () => {
    const settings = await Effect.runPromise(
      readModelSettings({
        MODEL_GATEWAYS: JSON.stringify([{ name: 'internal', base_url: 'https://llm.internal/v1', api_key: secret }]),
      }),
    );

    expect(settings.gateways[0]?.api_key).toEqual(Redacted.make(secret));
    expect(exposedText(settings.gateways)).not.toContain(secret);
  });

  it('is refused when both api_key and api_key_env give it', async () => {
    const entry = {
      name: 'internal',
      base_url: 'https://llm.internal/v1',
      api_key: secret,
      api_key_env: 'GATEWAY_KEY',
    };

    expect(await problemsOf(gateways([entry]))).toEqual([
      { setting: 'MODEL_GATEWAYS', pointer: '/0/api_key', detail: 'Set api_key or api_key_env, not both' },
    ]);
  });
});

describe('malformed MODEL_GATEWAYS', () => {
  it('is rejected without quoting text that is not JSON', async () => {
    expect(await problemsOf({ MODEL_GATEWAYS: `[{"headers": "${secret}"` })).toEqual([
      { setting: 'MODEL_GATEWAYS', pointer: '', detail: 'Expected JSON' },
    ]);
  });

  it('is rejected with pointers when an entry has the wrong shape', async () => {
    expect(await problemsOf(gateways([{ name: 'a', base_url: 1, headers: { x: 2 }, extra: secret }]))).toEqual([
      { setting: 'MODEL_GATEWAYS', pointer: '/0/extra', detail: 'Expected no excess property' },
      { setting: 'MODEL_GATEWAYS', pointer: '/0/base_url', detail: 'Expected string' },
      { setting: 'MODEL_GATEWAYS', pointer: '/0/headers/x', detail: 'Expected string' },
    ]);
    expect(await problemsOf(gateways({ name: 'a' }))).toEqual([
      { setting: 'MODEL_GATEWAYS', pointer: '', detail: 'Expected array' },
    ]);
  });

  it('is rejected for names that are malformed, built in or repeated, bad URLs and missing keys', async () => {
    const entries = [
      { name: 'Internal', base_url: 'https://a.example' },
      { name: 'openai', base_url: 'https://b.example' },
      { name: 'mine', base_url: 'https://c.example' },
      { name: 'mine', base_url: 'mailto:someone', api_key_env: 'NOT_SET', cost_header: 'x cost' },
    ];

    expect(await problemsOf(gateways(entries))).toEqual([
      {
        setting: 'MODEL_GATEWAYS',
        pointer: '/0/name',
        detail: 'Expected 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
      },
      { setting: 'MODEL_GATEWAYS', pointer: '/1/name', detail: 'openai is a built-in provider' },
      { setting: 'MODEL_GATEWAYS', pointer: '/3/name', detail: 'mine is used twice' },
      { setting: 'MODEL_GATEWAYS', pointer: '/3/base_url', detail: 'Expected an http or https URL' },
      { setting: 'MODEL_GATEWAYS', pointer: '/3/api_key_env', detail: 'The variable it names is not set' },
      { setting: 'MODEL_GATEWAYS', pointer: '/3/cost_header', detail: 'Expected the name of an HTTP header' },
    ]);
  });
});

const runtimeFields = [
  'model',
  'messages',
  'stream',
  'stream_options',
  'n',
  'max_tokens',
  'max_completion_tokens',
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
  'seed',
  'stop',
  'response_format',
  'tools',
  'tool_choice',
  'functions',
  'function_call',
  'reasoning_effort',
  'verbosity',
  'reasoningEffort',
  'textVerbosity',
  'strictJsonSchema',
];

describe('the allowed_provider_options of a gateway', () => {
  it('refuses every field the runtime sets or that changes what the call is, naming the field', async () => {
    const entry = { name: 'internal', base_url: 'https://llm.internal/v1', allowed_provider_options: runtimeFields };

    expect(await problemsOf(gateways([entry]))).toEqual(
      runtimeFields.map((field, position) => ({
        setting: 'MODEL_GATEWAYS',
        pointer: `/0/allowed_provider_options/${position}`,
        detail: `${field} is set by the runtime or changes what the call is, so it cannot be allowed`,
      })),
    );
  });

  it('is a list of distinct field names, each of 1 to 64 characters, and at most 64 of them', async () => {
    const malformed = {
      name: 'a',
      base_url: 'https://a.example',
      allowed_provider_options: ['', 'x'.repeat(65), 'user', 'user'],
    };
    const many = {
      name: 'b',
      base_url: 'https://b.example',
      allowed_provider_options: Array.from({ length: 65 }, (_, index) => `f${index}`),
    };
    const notText = { name: 'c', base_url: 'https://c.example', allowed_provider_options: ['user', 7] };

    expect(await problemsOf(gateways([malformed, many, notText]))).toEqual([
      { setting: 'MODEL_GATEWAYS', pointer: '/2/allowed_provider_options/1', detail: 'Expected string' },
    ]);
    expect(await problemsOf(gateways([malformed, many]))).toEqual([
      {
        setting: 'MODEL_GATEWAYS',
        pointer: '/0/allowed_provider_options/0',
        detail: 'Expected a field name of 1 to 64 characters',
      },
      {
        setting: 'MODEL_GATEWAYS',
        pointer: '/0/allowed_provider_options/1',
        detail: 'Expected a field name of 1 to 64 characters',
      },
      { setting: 'MODEL_GATEWAYS', pointer: '/0/allowed_provider_options/3', detail: 'user is listed twice' },
      { setting: 'MODEL_GATEWAYS', pointer: '/1/allowed_provider_options', detail: 'Expected at most 64 field names' },
    ]);
  });
});

describe('MODEL_ALIASES', () => {
  it('reads aliases from one reference to another', async () => {
    const aliases = { 'anthropic/claude-haiku-4-5': 'bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0' };

    const settings = await Effect.runPromise(readModelSettings({ MODEL_ALIASES: JSON.stringify(aliases) }));

    expect(settings.aliases).toEqual(new Map(Object.entries(aliases)));
  });

  it('rejects malformed text and shapes', async () => {
    expect(await problemsOf({ MODEL_ALIASES: 'nope' })).toEqual([
      { setting: 'MODEL_ALIASES', pointer: '', detail: 'Expected JSON' },
    ]);
    expect(await problemsOf({ MODEL_ALIASES: '{"a/b": 1}' })).toEqual([
      { setting: 'MODEL_ALIASES', pointer: '/a~1b', detail: 'Expected string' },
    ]);
  });

  it('rejects malformed references, chains and cycles', async () => {
    const aliases = { fast: 'anthropic/x', 'a/one': 'a/two', 'a/two': 'a/three', 'a/self': 'a/self' };

    expect(await problemsOf({ MODEL_ALIASES: JSON.stringify(aliases) })).toEqual([
      { setting: 'MODEL_ALIASES', pointer: '/fast', detail: 'An alias and its target are each written provider/model' },
      {
        setting: 'MODEL_ALIASES',
        pointer: '/a~1one',
        detail: 'The target is itself an alias; an alias resolves in one hop',
      },
      {
        setting: 'MODEL_ALIASES',
        pointer: '/a~1self',
        detail: 'The target is itself an alias; an alias resolves in one hop',
      },
    ]);
  });
});
