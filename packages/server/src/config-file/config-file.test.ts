import { createApiKey } from '@on.auto/identity';
import { describe, expect, it } from 'vitest';

import { configuredServer, rejectedRun, settingLines, stoppedOutput } from '../testing/processes/configured-server.ts';
import { request } from '../testing/servers/http-client.ts';

const gatewayKey = 'gateway-key-SECRET-7f3a';

const created = createApiKey({
  id: 'ci-1',
  org: 'acme',
  permissions: ['org:read', 'org:write', 'playbook:read', 'playbook:write'],
  playbooks: '*',
});

const fileText = `model_gateways:
  - name: gateway
    base_url: https://gateway.example.com/v1
    api_key: \${GATEWAY_API_KEY}
model_aliases:
  anthropic/*: gateway/anthropic/*
api_keys:
  - ${JSON.stringify(created.entry)}
allowed_origins:
  - https://app.example.com
`;

function fromOrigin(port: number, origin: string): Promise<number> {
  return fetch(`http://127.0.0.1:${port}/v1/orgs/acme/playbooks`, {
    headers: { origin, authorization: `Bearer ${created.key}` },
  }).then(({ status }) => status);
}

describe('a server with a configuration file and no variable for its settings', () => {
  it('takes its gateways, aliases, API keys and origins from the file, and says so once', async () => {
    const { child, configFile } = configuredServer(fileText, { GATEWAY_API_KEY: gatewayKey });
    const port = await child.port;

    const unauthenticated = await rejectedRun(port);
    const rejected = await rejectedRun(port, created.key);
    const origins = {
      listed: await fromOrigin(port, 'https://app.example.com'),
      other: await fromOrigin(port, 'https://other.example'),
    };
    const stderr = await stoppedOutput(child);

    expect({ unauthenticated: unauthenticated.status, rejected: rejected.body, origins }).toMatchObject({
      unauthenticated: 401,
      rejected: { detail: 'openai is not configured. Configured providers: gateway. Aliases: anthropic/*' },
      origins: { listed: 200, other: 403 },
    });
    expect(settingLines(stderr)).toEqual([
      `Settings read from the configuration file ${configFile}: MODEL_GATEWAYS, MODEL_ALIASES, API_KEYS, ALLOWED_ORIGINS`,
    ]);
    expect(stderr).not.toContain(gatewayKey);
  });
});

const modelsText = `declared_models:
  bedrock:
    - eu.anthropic.claude-sonnet-4-5-20250929-v1:0
allowed_models:
  - bedrock/*
`;

describe('a server whose configuration file declares and allows models', () => {
  it('lists the declared models as a list it narrows, and refuses a definition that names a model it does not allow', async () => {
    const { child, configFile } = configuredServer(modelsText, { AWS_REGION: 'eu-central-1' });
    const port = await child.port;

    const listed = await request(port, 'GET', '/v1/orgs/acme/models?provider=bedrock');
    const rejected = await rejectedRun(port);
    const stderr = await stoppedOutput(child);

    expect(listed.body).toMatchObject({
      object: 'list',
      data: [
        {
          id: 'bedrock/eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
          object: 'model',
          created: 0,
          owned_by: 'bedrock',
        },
      ],
      catalog_status: 'complete',
      narrowed: true,
    });
    expect(rejected).toMatchObject({
      status: 503,
      body: {
        reason: 'unavailable',
        detail: 'openai/gpt-5 is not one of the models this server offers',
      },
    });
    expect(settingLines(stderr)).toEqual([
      `Settings read from the configuration file ${configFile}: DECLARED_MODELS, ALLOWED_MODELS`,
    ]);
  });
});

describe('a server with settings in the environment', () => {
  it('reads them as before, and says nothing of a configuration file, when CONFIG_FILE is not set', async () => {
    const { child } = configuredServer(undefined, {
      MODEL_GATEWAYS: JSON.stringify([{ name: 'relay', base_url: 'https://relay.example.com/v1' }]),
      MODEL_ALIASES: JSON.stringify({ 'house/fast': 'relay/llama-3.3-70b' }),
    });

    const rejected = await rejectedRun(await child.port);
    const stderr = await stoppedOutput(child);

    expect(rejected.body).toMatchObject({
      detail: 'openai is not configured. Configured providers: relay. Aliases: house/fast',
    });
    expect(settingLines(stderr)).toEqual([]);
  });

  it('lets a variable win over the file whole, and says once which settings it won', async () => {
    const { child, configFile } = configuredServer(fileText, {
      GATEWAY_API_KEY: gatewayKey,
      API_KEYS: JSON.stringify([created.entry]),
      MODEL_ALIASES: JSON.stringify({ 'house/fast': 'gateway/llama-3.3-70b' }),
    });

    const rejected = await rejectedRun(await child.port, created.key);
    const stderr = await stoppedOutput(child);

    expect(rejected.body).toMatchObject({
      detail: 'openai is not configured. Configured providers: gateway. Aliases: house/fast',
    });
    expect(settingLines(stderr)).toEqual([
      `Settings read from the configuration file ${configFile}: MODEL_GATEWAYS, ALLOWED_ORIGINS`,
      "Set both in the environment and in the configuration file, so the environment's value is used: MODEL_ALIASES, API_KEYS",
    ]);
  });
});
