import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { readSettings } from '../settings/settings.ts';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fileOf(text: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-connections-'));
  directories.push(directory);
  const path = join(directory, 'auto-runtime.yaml');
  writeFileSync(path, text);
  return path;
}

function refusalOf(path: string, environment: Readonly<Record<string, string>> = {}): string {
  try {
    readSettings({ CONFIG_FILE: path, ...environment });
  } catch (error) {
    return String(error).replaceAll(path, 'auto-runtime.yaml');
  }
  return 'read';
}

const policy = `connections:
  people_may_add: true
  allowed_hosts: ['*.example.com', 'crm.example.com']
  credential_kinds: [none, reference, secret, client_credentials]
  variables: [CRM_API_KEY]
`;

const ownVariable = 'is a variable the runtime reads for itself, which no connection may name';

describe('the connections section of the configuration file', () => {
  it('is read as the policy of what people may add, its kinds of credential not taken for credentials', () => {
    expect(readSettings({ CONFIG_FILE: fileOf(policy) }).connections).toEqual({
      peopleMayAdd: true,
      allowedHosts: ['*.example.com', 'crm.example.com'],
      credentialKinds: ['none', 'reference', 'secret', 'client_credentials'],
      variables: ['CRM_API_KEY'],
    });
  });
});

describe('the variables of the connections section', () => {
  it('hold the value of each variable it lists that the environment sets, and nothing of one it leaves unset or empty', () => {
    const settings = readSettings({
      CONFIG_FILE: fileOf(policy.replace('[CRM_API_KEY]', '[CRM_API_KEY, WIKI_TOKEN, NOTES_KEY]')),
      CRM_API_KEY: 'crm-key-0f3c9a71',
      NOTES_KEY: '',
    });

    expect(
      [...settings.connectionVariables].map(([name, value]: readonly [string, Redacted.Redacted]) => [
        name,
        Redacted.value(value),
      ]),
    ).toEqual([['CRM_API_KEY', 'crm-key-0f3c9a71']]);
  });
});

describe('the connections section, of the variables the runtime reads for itself', () => {
  it('stops the start at a variable the runtime reads for itself, of its own or one the file refers to, at its place', () => {
    const naming = `model_gateways:
  - { name: corp, base_url: 'https://llm.example.com/v1', api_key: '\${CORP_KEY}' }
tool_servers:
  graph: { url: 'https://graph.example.com/mcp', headers: { Authorization: 'Bearer \${GRAPH_API_KEY}' }, org: acme }
connections:
  variables: [CRM_API_KEY, SECRETS_KEY, CORP_KEY, GRAPH_API_KEY]
`;

    expect(refusalOf(fileOf(naming), { CORP_KEY: 'k', GRAPH_API_KEY: 'k' })).toBe(
      `connection_policy_invalid: The connection settings are invalid. auto-runtime.yaml:6:28 connections.variables[1]: SECRETS_KEY ${ownVariable}; auto-runtime.yaml:6:41 connections.variables[2]: CORP_KEY ${ownVariable}; auto-runtime.yaml:6:51 connections.variables[3]: GRAPH_API_KEY ${ownVariable}`,
    );
  });

  it('names the setting where the policy and the gateways come from the environment, a gateway key among the own variables', () => {
    const environment = {
      MODEL_GATEWAYS: JSON.stringify([
        { name: 'lab', base_url: 'https://lab.example.com/v1', api_key_env: 'LAB_KEY' },
        { name: 'edge', base_url: 'https://edge.example.com/v1' },
      ]),
      LAB_KEY: 'k',
      CONNECTIONS: JSON.stringify({ variables: ['API_KEYS', 'LAB_KEY', 'WIKI_TOKEN'] }),
    };

    expect(refusalOf(fileOf('connections: {}\n'), environment)).toBe(
      `connection_policy_invalid: The connection settings are invalid. CONNECTIONS: /variables/0: API_KEYS ${ownVariable}; CONNECTIONS: /variables/1: LAB_KEY ${ownVariable}`,
    );
  });

  it('stops the start at the place of a rule it does not accept', () => {
    const malformed = `connections:\n  people_may_add: sometimes\n  allowed_hosts: ['https://crm.example.com']\n  maybe: 1\n`;

    expect(refusalOf(fileOf(malformed))).toBe(
      'ConfigFileInvalid: The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:2:19 connections.people_may_add: Expected boolean; auto-runtime.yaml:3:19 connections.allowed_hosts[0]: Expected a host, such as crm.example.com, or a host after *. for every host under it; auto-runtime.yaml:4:10 connections.maybe: Expected no excess property',
    );
  });
});

const gatewaysAndServers = {
  MODEL_GATEWAYS: JSON.stringify([{ name: 'lab', base_url: 'https://lab.example.com/v1', api_key_env: 'LAB_KEY' }]),
  TOOL_SERVERS: JSON.stringify({
    graph: {
      url: 'https://graph.example.com/mcp',
      org: 'acme',
      headers: { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Region': '${GRAPH_REGION:-eu}' },
    },
  }),
  LAB_KEY: 'k',
  CORP_KEY: 'k',
  GRAPH_API_KEY: 'k',
};

describe('the variables the runtime reads for itself, of what it has read', () => {
  it("are its own, the gateways' keys, the references of the servers, a fallback among them, and the file's", () => {
    const named = ['CRM_API_KEY', 'SECRETS_KEY', 'CORP_KEY', 'LAB_KEY', 'GRAPH_API_KEY', 'GRAPH_REGION', 'WIKI_TOKEN'];
    const gateways = `model_gateways:\n  - { name: corp, base_url: 'https://llm.example.com/v1', api_key: '\${CORP_KEY}' }\n`;
    const environment = { ...gatewaysAndServers, CONNECTIONS: JSON.stringify({ variables: named }) };
    const own = named.slice(1, -1);

    expect(refusalOf(fileOf(gateways), environment)).toBe(
      `connection_policy_invalid: The connection settings are invalid. ${own.map((name, index) => `CONNECTIONS: /variables/${String(index + 1)}: ${name} ${ownVariable}`).join('; ')}`,
    );
  });
});

describe('the variables a connection may never name', () => {
  it('refuses a variable any settings module reads or a library it uses reads, and a credential of the Azure library', () => {
    const own = [
      'AZURE_PASSWORD',
      'AZURE_CLIENT_CERTIFICATE_PASSWORD',
      'AWS_SESSION_TOKEN',
      'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
      'PREDICTION_CACHE_DIR',
      'HTTPS_PROXY',
      'HOST',
    ];
    const environment = { CONNECTIONS: JSON.stringify({ variables: [...own, 'CRM_API_KEY'] }) };

    expect(refusalOf(fileOf('connections: {}\n'), environment)).toBe(
      `connection_policy_invalid: The connection settings are invalid. ${own.map((name, index) => `CONNECTIONS: /variables/${String(index)}: ${name} ${ownVariable}`).join('; ')}`,
    );
  });
});
