import { InvalidPortError, type Environment } from '@on.auto/config';
import { createApiKey } from '@on.auto/identity';
import { readProviders } from '@on.auto/providers';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { readSettings } from './settings.ts';

function errorFrom(environment: Environment): unknown {
  try {
    readSettings(environment);
  } catch (error) {
    return error;
  }
  return undefined;
}

const { entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], playbooks: '*' });

const shippedProviders = Result.getOrThrow(readProviders());

const defaultPrediction = {
  processes: 4,
  processMemoryMebibytes: 1280,
  buildsAtOnce: 2,
  buildsPerDay: 4,
  mostFunctions: 32,
  cacheDirectory: '/var/tmp/auto-runtime',
};

describe('readSettings', () => {
  it('listens on every interface at port 5555, allows no origin, has no API keys and keeps the ledger in data/ by default', () => {
    const { models, toolServers, interaction, ...server } = readSettings({});

    expect(models.openai).toEqual({ configured: false, missing: ['OPENAI_API_KEY'] });
    expect(toolServers).toEqual({ servers: [], referencedVariables: [] });
    expect(interaction).toEqual({ mostOpenRequests: 10_000 });
    expect(server).toEqual({
      host: '0.0.0.0',
      port: 5555,
      allowedOrigins: [],
      apiKeys: undefined,
      identityIssuer: 'https://clerk.on.auto',
      signIn: undefined,
      ledger: { store: 'sqlite', file: 'data/ledger.db' },
      secrets: { key: 'in-a-file', file: 'data/secrets.key' },
      content: { store: 'ledger' },
      proxy: { enabled: false, environment: {} },
      logFormat: 'json',
      logLevel: 'info',
      modelProviders: [
        'anthropic',
        'openai',
        'google',
        'bedrock',
        'bedrock-anthropic',
        'azure',
        'vertex',
        'vertex-anthropic',
      ],
      reasoning: { mostInputTokens: 2_000_000 },
      workflows: { mostDurationMs: 2_592_000_000, mostCallsAtOnce: 32, mostOpenCalls: 1000, sweepEveryMs: 1000 },
      computation: { workers: 4 },
      recall: { mostFunctions: 32, rebuildsAtOnce: 4, playbooksAtOnce: 4 },
      prediction: defaultPrediction,
      connections: { peopleMayAdd: true, allowedHosts: null, credentialKinds: null, variables: [] },
      connectionVariables: new Map(),
      providers: shippedProviders,
      providerValues: new Map(),
      telemetry: undefined,
      configFile: undefined,
    });
  });
});

const everySetting = {
  HOST: '127.0.0.1',
  PORT: '3000',
  ALLOWED_ORIGINS: 'https://app.example.com,http://localhost:5173,http://[::1]:3000',
  API_KEYS: JSON.stringify([entry]),
  IDENTITY_ISSUER: 'https://identity.example',
  PUBLIC_URL: 'https://runtime.example.com',
  LEDGER_FILE: '/data/ledger.db',
  CONTENT_STORE_URL: 's3://playbook-content/production',
  NODE_USE_ENV_PROXY: '1',
  HTTPS_PROXY: 'http://proxy.internal:3128',
  LOG_FORMAT: 'pretty',
  LOG_LEVEL: 'warn',
  OPENAI_API_KEY: 'sk-test',
  INTERACTION_OPEN_REQUESTS: '250',
  REASONING_MAX_INPUT_TOKENS: '500000',
  CONNECTIONS: JSON.stringify({ people_may_add: false, allowed_hosts: ['*.example.com'], credential_kinds: ['none'] }),
};

describe('readSettings given every setting', () => {
  it('reads every setting from the environment it is given', () => {
    const { models, toolServers, interaction, ...server } = readSettings(everySetting);

    expect(interaction).toEqual({ mostOpenRequests: 250 });
    expect(models.openai).toMatchObject({ configured: true });
    expect(toolServers.servers).toEqual([]);
    expect(server).toEqual({
      host: '127.0.0.1',
      port: 3000,
      allowedOrigins: ['https://app.example.com', 'http://localhost:5173', 'http://[::1]:3000'],
      apiKeys: [entry],
      identityIssuer: 'https://identity.example',
      signIn: { issuer: 'https://identity.example', publicUrl: 'https://runtime.example.com' },
      ledger: { store: 'sqlite', file: '/data/ledger.db' },
      secrets: { key: 'in-a-file', file: '/data/secrets.key' },
      content: {
        store: 'object-storage',
        location: { bucket: 'playbook-content', prefix: 'production' },
        endpoint: undefined,
        region: undefined,
      },
      proxy: { enabled: true, environment: { HTTPS_PROXY: 'http://proxy.internal:3128' } },
      logFormat: 'pretty',
      logLevel: 'warn',
      modelProviders: [
        'openai',
        'anthropic',
        'google',
        'bedrock',
        'bedrock-anthropic',
        'azure',
        'vertex',
        'vertex-anthropic',
      ],
      reasoning: { mostInputTokens: 500_000 },
      workflows: { mostDurationMs: 2_592_000_000, mostCallsAtOnce: 32, mostOpenCalls: 1000, sweepEveryMs: 1000 },
      computation: { workers: 4 },
      recall: { mostFunctions: 32, rebuildsAtOnce: 4, playbooksAtOnce: 4 },
      prediction: defaultPrediction,
      connections: { peopleMayAdd: false, allowedHosts: ['*.example.com'], credentialKinds: ['none'], variables: [] },
      connectionVariables: new Map(),
      providers: shippedProviders,
      providerValues: new Map(),
      telemetry: undefined,
      configFile: undefined,
    });
  });
});

describe('readSettings with empty values', () => {
  it('treats empty variables as not set', () => {
    expect(
      readSettings({
        ALLOWED_ORIGINS: '',
        API_KEYS: '',
        LEDGER_FILE: '',
        SECRETS_KEY: '',
        SECRETS_KEY_PREVIOUS: '',
        CONTENT_STORE_URL: '',
        LOG_FORMAT: '',
        LOG_LEVEL: '',
        INTERACTION_OPEN_REQUESTS: '',
      }),
    ).toMatchObject({
      interaction: { mostOpenRequests: 10_000 },
      allowedOrigins: [],
      apiKeys: undefined,
      ledger: { store: 'sqlite', file: 'data/ledger.db' },
      secrets: { key: 'in-a-file', file: 'data/secrets.key' },
      content: { store: 'ledger' },
      logFormat: 'json',
      logLevel: 'info',
    });
  });

  it.each([' ', '\t', '  \n  '])('treats API_KEYS=%j, only whitespace, as no API keys', (keys) => {
    expect(readSettings({ API_KEYS: keys })).toMatchObject({ apiKeys: undefined });
  });
});

describe('readSettings rejects invalid log settings', () => {
  it.each(['text', 'JSON', 'logfmt'])('rejects LOG_FORMAT="%s", naming the formats it accepts', (value) => {
    const error = errorFrom({ LOG_FORMAT: value });

    expect(error).toMatchObject({ name: 'InvalidSettingsError' });
    expect(String(error)).toBe(
      'InvalidSettingsError: SchemaError(Expected "json" | "pretty" | "console"\n  at ["LOG_FORMAT"])',
    );
  });

  it.each(['verbose', 'WARN', 'trace'])('rejects LOG_LEVEL="%s", naming the levels it accepts', (value) => {
    const error = errorFrom({ LOG_LEVEL: value });

    expect(error).toMatchObject({ name: 'InvalidSettingsError' });
    expect(String(error)).toBe(
      'InvalidSettingsError: SchemaError(Expected "debug" | "info" | "warn" | "error"\n  at ["LOG_LEVEL"])',
    );
  });
});

describe('readSettings rejects invalid settings', () => {
  it.each([
    'https://app.example.com/',
    'app.example.com',
    'https://App.example.com',
    'https://app.example.com:443',
    ' https://app.example.com',
    'null',
    '*',
    'https://a.example,,https://b.example',
  ])('rejects ALLOWED_ORIGINS="%s" with a named error', (origins) => {
    const error = errorFrom({ ALLOWED_ORIGINS: origins });

    expect(error).toMatchObject({ name: 'InvalidSettingsError', _tag: 'InvalidSettingsError' });
    expect(String(error)).toContain('ALLOWED_ORIGINS');
    expect(String(error)).toContain('Expected an origin such as https://app.example.com');
  });
});

describe('readSettings rejects invalid settings of other packages', () => {
  it('rejects invalid API keys with the named error from the identity settings', () => {
    expect(String(errorFrom({ API_KEYS: '[{"id":"ci-1"}]' }))).toContain('InvalidApiKeysError: API_KEYS[0].org');
  });

  it('rejects an invalid port with the named error from the server configuration', () => {
    expect(errorFrom({ PORT: 'eighty' })).toEqual(new InvalidPortError('eighty'));
  });

  it('stops at connection settings it cannot read, naming the setting', () => {
    expect(String(errorFrom({ CONNECTIONS: '{"people_may_add": "yes"}' }))).toBe(
      'connection_policy_invalid: The connection settings are invalid. CONNECTIONS: /people_may_add: Expected boolean',
    );
  });

  it('stops at model settings it cannot read, naming the setting and never its value', () => {
    const error = String(errorFrom({ MODEL_ALIASES: '{"fast": "sk-not-a-reference"}' }));

    expect(error).toBe(
      'model_settings_invalid: The model settings are invalid. MODEL_ALIASES: /fast: An alias and its target are each written provider/model',
    );
    expect(error).not.toContain('sk-not-a-reference');
  });
});
