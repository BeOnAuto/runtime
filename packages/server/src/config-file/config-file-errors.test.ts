import { describe, expect, it } from 'vitest';

import { configuredServer } from '../testing/processes/configured-server.ts';

const secret = 'sk-live-SECRET-0123456789abcdef';

async function startupLine(configText: string, environment: Readonly<Record<string, string>> = {}): Promise<string> {
  const { child, configFile } = configuredServer(configText, environment);
  const exitCode = await child.exited;
  const { stderr } = child.output();
  expect({ exitCode, secret: stderr.includes(secret) }).toEqual({ exitCode: 1, secret: false });
  return stderr.replaceAll(configFile, 'auto-runtime.yaml');
}

const invalid = 'Auto Runtime could not start: ConfigFileInvalid: The configuration file auto-runtime.yaml is invalid:';

describe('a configuration file the server cannot use', () => {
  it('stops the start when the file is missing, naming it', async () => {
    const { child, configFile } = configuredServer(undefined, { CONFIG_FILE: '/nonexistent/auto-runtime.yaml' });

    expect({ exitCode: await child.exited, stderr: child.output().stderr, configFile }).toMatchObject({
      exitCode: 1,
      stderr:
        'Auto Runtime could not start: ConfigFileInvalid: The configuration file /nonexistent/auto-runtime.yaml, which CONFIG_FILE names, does not exist\n',
    });
  });
});

describe('a configuration file the server cannot read as settings', () => {
  it.each([
    [
      'is not YAML',
      'model_aliases: [unclosed\n',
      `${invalid} auto-runtime.yaml:2:1: Flow sequence in block collection must be sufficiently indented and end with a ]\n`,
    ],
    [
      'holds a value its setting does not accept',
      'model_gateways:\n  - name: gateway\n    base_url: 5555\n    colour: blue\n',
      `${invalid} auto-runtime.yaml:3:15 model_gateways[0].base_url: Expected string; auto-runtime.yaml:4:13 model_gateways[0].colour: Expected no excess property\n`,
    ],
    [
      'refers to a variable that is not set',
      'model_gateways:\n  - name: gateway\n    base_url: https://gateway.example.com/v1\n    api_key: ${GATEWAY_API_KEY}\n',
      `${invalid} auto-runtime.yaml:4:14 model_gateways[0].api_key: Refers to the environment variable GATEWAY_API_KEY, which is not set\n`,
    ],
    [
      'holds a credential instead of a reference to one',
      `model_gateways:\n  - name: gateway\n    base_url: https://gateway.example.com/v1\n    api_key: ${secret}\n`,
      `${invalid} auto-runtime.yaml:4:14 model_gateways[0].api_key: Looks like a credential, which this file never holds; write a reference to the environment variable that holds it instead, such as \${GATEWAY_API_KEY}\n`,
    ],
    [
      'holds the URL of the ledger database, which only the environment holds',
      `database_url: postgresql://playbooks:${secret}@db.example.com/playbooks\n`,
      `${invalid} auto-runtime.yaml:1:15 database_url: Not a setting this file holds; it holds allowed_origins, studio_origin, serve_studio, api_keys, access_mode, model_gateways, model_aliases, declared_models, allowed_models, tool_servers, connections, usage_ping\n`,
    ],
  ])('stops the start when it %s, naming the line and the key and never a value', async (_, text, line) => {
    await expect(startupLine(text)).resolves.toBe(line);
  });

  it('stops the start at the line of a setting the model settings refuse', async () => {
    const text = `model_gateways:
  - name: gateway
    base_url: https://a.example.com/v1
  - name: gateway
    base_url: ftp://b.example.com
`;

    await expect(startupLine(text, { MODEL_ALIASES: '{"fast":"gemini"}' })).resolves.toBe(
      'Auto Runtime could not start: model_settings_invalid: The model settings are invalid. ' +
        'auto-runtime.yaml:4:11 model_gateways[1].name: gateway is used twice; ' +
        'auto-runtime.yaml:5:15 model_gateways[1].base_url: Expected an http or https URL; ' +
        'MODEL_ALIASES: /fast: An alias and its target are each written provider/model\n',
    );
  });
});

describe('declared and allowed models the server refuses', () => {
  it('stops the start at the line of a declared or allowed model the model settings refuse', async () => {
    const text = `declared_models:
  anthropic:
    - claude-sonnet-4-5
  azure:
    - gpt 5
allowed_models: []
`;

    await expect(startupLine(text)).resolves.toBe(
      'Auto Runtime could not start: model_settings_invalid: The model settings are invalid. ' +
        'auto-runtime.yaml:3:5 declared_models.anthropic: anthropic lists its own models; models are declared for bedrock, bedrock-anthropic, azure, vertex, vertex-anthropic or a gateway of MODEL_GATEWAYS; ' +
        'auto-runtime.yaml:5:7 declared_models.azure[0]: Expected a model id of 1 to 256 characters, without spaces or control characters; ' +
        'auto-runtime.yaml:6:17 allowed_models: Expected at least one model; leave ALLOWED_MODELS out to offer every model\n',
    );
  });
});

describe('an openapi server whose document cannot be read', () => {
  it('stops the start, naming its entry', async () => {
    const lines = (await startupLine('tool_servers:\n  billing:\n    document: billing.json\n    org: acme\n')).split(
      '\n',
    );

    expect(lines.at(-2)).toBe(
      'Auto Runtime could not start: tool_server_document_refused: The documents of the tool servers could not be read. ' +
        'TOOL_SERVERS: /billing/document: The document does not exist',
    );
  });
});
