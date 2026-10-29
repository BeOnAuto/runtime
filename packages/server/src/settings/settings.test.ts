import { InvalidPortError, type Environment } from '@on.auto/config';
import { createApiKey } from '@on.auto/identity';
import { describe, expect, it } from 'vitest';

import { shippedList } from '../testing/servers/connected-servers.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

function errorFrom(environment: Environment): unknown {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return error;
  }
  return undefined;
}

const { entry } = createApiKey({ id: 'ci-1', org: 'acme', permissions: ['org:read'], playbooks: '*' });

function aKeyFileAt(file: string) {
  return { current: { from: 'file', setting: 'SECRETS_KEY_FILE', file, madeByTheServer: true }, previous: undefined };
}

const defaultPrediction = {
  processes: 4,
  processMemoryMebibytes: 1280,
  buildsAtOnce: 2,
  buildsPerDay: 4,
  mostFunctions: 32,
  cacheDirectory: '/var/tmp/auto-runtime',
};

const modelProvidersByDefault = [
  'anthropic',
  'openai',
  'google',
  'bedrock',
  'bedrock-anthropic',
  'azure',
  'vertex',
  'vertex-anthropic',
];

const notLocal = { loopbackAllowed: false };

describe('readSettings', () => {
  it('listens on every interface at port 5555, allows no origin, has no API keys and keeps the ledger in data/ by default', () => {
    const { models, toolServers, interaction, ...server } = readSettingsOf({});

    expect(models.openai).toEqual({ configured: false, missing: ['OPENAI_API_KEY'] });
    expect(toolServers).toEqual({ servers: [], referencedVariables: [] });
    expect(interaction).toEqual({ mostOpenRequests: 10_000 });
    expect(server).toEqual({
      host: '0.0.0.0',
      port: 5555,
      allowedOrigins: [],
      apiKeys: undefined,
      identityIssuer: 'https://clerk.on.auto',
      identityKeySet: { from: 'discovery' },
      publicUrl: undefined,
      accessMode: undefined,
      signIn: undefined,
      studio: { origin: 'https://studio.on.auto', served: false },
      ledger: { store: 'sqlite', file: 'data/ledger.db' },
      secrets: aKeyFileAt('data/secrets.key'),
      keepers: { current: { kind: 'ledger', setting: 'SECRETS_KEEPER' }, previous: undefined },
      content: { store: 'ledger' },
      proxy: { enabled: false, environment: {} },
      logFormat: 'json',
      logLevel: 'info',
      modelProviders: modelProvidersByDefault,
      reasoning: { mostInputTokens: 2_000_000 },
      workflows: { mostDurationMs: 2_592_000_000, mostCallsAtOnce: 32, mostOpenCalls: 1000, sweepEveryMs: 1000 },
      computation: { workers: 4 },
      recall: { mostFunctions: 32, rebuildsAtOnce: 4, playbooksAtOnce: 4 },
      prediction: defaultPrediction,
      documents: { processes: 2 },
      connections: { peopleMayAdd: true, allowedHosts: null, ...notLocal, credentialKinds: null, variables: [] },
      registeredClients: [],
      autoClientsWritten: undefined,
      autoClients: { enabled: false, serviceUrl: 'https://consent.on.auto' },
      connectionVariables: new Map(),
      providers: shippedList,
      providerValues: new Map(),
      telemetry: undefined,
      usagePing: { distribution: 'source' },
      license: { key: undefined, allocation: undefined, accounts: 'https://billing.on.auto' },
      distribution: 'source',
      configFile: undefined,
      extensions: [],
    });
  });
});

const everySetting = {
  HOST: '127.0.0.1',
  PORT: '3000',
  ALLOWED_ORIGINS: 'https://app.example.com,http://localhost:5173,http://[::1]:3000',
  API_KEYS: JSON.stringify([entry]),
  IDENTITY_ISSUER: 'https://identity.example',
  IDENTITY_JWKS_URL: 'https://identity.example/jwks',
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
  AUTO_RUNTIME_EXTENSIONS: JSON.stringify([{ package: '@acme/models' }]),
  CONNECTIONS: JSON.stringify({
    people_may_add: false,
    allowed_hosts: ['*.example.com'],
    credential_kinds: ['none'],
    auto_clients: false,
  }),
  AUTO_CLIENTS: 'true',
  CONSENT_SERVICE_URL: 'https://consent.example.com',
  AUTO_RUNTIME_LICENSE_KEY: 'alk.acme.0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a.c2VjcmV0',
  ACCOUNTS_ORIGIN: 'https://accounts.example.com',
};

const everySettingRead = {
  host: '127.0.0.1',
  port: 3000,
  allowedOrigins: ['https://app.example.com', 'http://localhost:5173', 'http://[::1]:3000'],
  apiKeys: [entry],
  identityIssuer: 'https://identity.example',
  identityKeySet: { from: 'url', url: 'https://identity.example/jwks' },
  signIn: { issuer: 'https://identity.example', publicUrl: 'https://runtime.example.com' },
  ledger: { store: 'sqlite', file: '/data/ledger.db' },
  secrets: aKeyFileAt('/data/secrets.key'),
  keepers: { current: { kind: 'ledger', setting: 'SECRETS_KEEPER' }, previous: undefined },
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
  documents: { processes: 2 },
  connections: {
    peopleMayAdd: false,
    allowedHosts: ['*.example.com'],
    ...notLocal,
    credentialKinds: ['none'],
    variables: [],
  },
  registeredClients: [],
  autoClientsWritten: false,
  autoClients: { enabled: true, serviceUrl: 'https://consent.example.com' },
  connectionVariables: new Map(),
  providers: shippedList,
  providerValues: new Map(),
  telemetry: undefined,
  usagePing: { distribution: 'source' },
  license: {
    key: { key: 'alk.acme.0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a.c2VjcmV0', source: 'environment' },
    allocation: undefined,
    accounts: 'https://accounts.example.com',
  },
  distribution: 'source',
  configFile: undefined,
  extensions: [{ package: '@acme/models' }],
};

describe('readSettings given the distribution', () => {
  it('reads where the runtime came from even when the usage ping is turned off', () => {
    expect(readSettingsOf({ RUNTIME_DISTRIBUTION: 'docker', DO_NOT_TRACK: '1' })).toMatchObject({
      usagePing: undefined,
      distribution: 'docker',
    });
  });
});

describe('readSettings given every setting', () => {
  it('reads every setting from the environment it is given', () => {
    const { models, toolServers, interaction, studio, accessMode, publicUrl, ...server } = readSettingsOf(everySetting);

    expect([interaction, studio.served, accessMode]).toEqual([{ mostOpenRequests: 250 }, false, undefined]);
    expect([models.openai.configured, publicUrl]).toEqual([true, 'https://runtime.example.com']);
    expect(toolServers.servers).toEqual([]);
    expect(server).toEqual(everySettingRead);
  });
});

describe('readSettings with empty values', () => {
  it('treats empty variables as not set', () => {
    expect(
      readSettingsOf({
        ALLOWED_ORIGINS: '',
        API_KEYS: '',
        LEDGER_FILE: '',
        SECRETS_KEY: '',
        SECRETS_KEY_FILE: '',
        SECRETS_KEY_PREVIOUS: '',
        SECRETS_KEY_FILE_PREVIOUS: '',
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
      secrets: aKeyFileAt('data/secrets.key'),
      content: { store: 'ledger' },
      logFormat: 'json',
      logLevel: 'info',
    });
  });

  it.each([' ', '\t', '  \n  '])('treats API_KEYS=%j, only whitespace, as no API keys', (keys) => {
    expect(readSettingsOf({ API_KEYS: keys })).toMatchObject({ apiKeys: undefined });
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
      'connections_setting_invalid: The connection settings are invalid. CONNECTIONS: /people_may_add: Expected boolean',
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
