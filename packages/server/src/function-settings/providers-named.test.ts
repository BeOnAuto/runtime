import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clientIdWrittenOut } from '@on.auto/config';
import { required } from '@on.auto/operations';
import type { ServerSettings } from '@on.auto/tool-servers';
import { Redacted } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { shippedProviders } from '../testing/servers/connected-servers.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

const githubToken = 'github-token-0f3c9a71e2';

const crmToken = 'crm-token-7d1e44b0c9';

const booksSecret = 'books-client-secret-5a90';

const secrets = { GITHUB_TOKEN: githubToken, CRM_TOKEN: crmToken, BOOKS_CLIENT_SECRET: booksSecret };

const providersOfTheFile = `connections:
  providers:
    - name: crm
      title: CRM
      description: Read and change the accounts and contacts of your CRM.
      website: https://developer.crm.example.com
      type: mcp
      url: https://{tenant}.crm.example.com/mcp
      placeholders:
        tenant:
          description: The tenant of your CRM, as in https://<tenant>.crm.example.com
          pattern: '^[a-z0-9-]{1,63}$'
          example: acme
      credentials:
        - kind: secret
          in: header
          name: Authorization
          scheme: Bearer
          description: Token from the settings of your CRM.
        - kind: none
    - name: books
      title: Books
      description: Read the invoices of your books.
      website: https://developer.books.example.com
      type: openapi
      document: https://books.example.com/openapi.json
      headers:
        X-Client: '{client_id}'
      credentials:
        - kind: client_credentials
          issuer: https://auth.books.example.com
          scope: invoices.read
          says:
            invoices.read: Read the invoices of the account.
`;

const serversOfProviders = `tool_servers:
  code:
    provider: github
    credential: \${GITHUB_TOKEN}
    org: acme
  accounts:
    provider: crm
    placeholders:
      tenant: acme
    credential: \${CRM_TOKEN}
    org: acme
    allowed: [search_accounts]
  invoices:
    provider: books
    credential:
      client_id: acme-books
      client_secret: \${BOOKS_CLIENT_SECRET}
    org: acme
`;

function configFile(text: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-providers-named-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true });
  });
  const path = join(directory, 'auto-runtime.yaml');
  writeFileSync(path, text);
  return path;
}

function settingsOf(servers: string, environment: Readonly<Record<string, string>> = secrets) {
  return readSettingsOf({ CONFIG_FILE: configFile(`${providersOfTheFile}${servers}`), ...environment });
}

function errorOf(servers: string, environment: Readonly<Record<string, string>> = secrets): string {
  const path = configFile(`${providersOfTheFile}${servers}`);
  try {
    readSettingsOf({ CONFIG_FILE: path, ...environment });
  } catch (error) {
    return String(error).replaceAll(path, 'auto-runtime.yaml');
  }
  return 'read';
}

function headersOf(server: ServerSettings | undefined): Readonly<Record<string, string>> {
  const headers = server === undefined || server.type === 'stdio' ? new Map() : server.headers;
  return Object.fromEntries(
    [...headers].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
  );
}

const github = required(shippedProviders.find(({ entry }) => entry.name === 'github')).entry;

describe('an entry of the settings file that names a provider', () => {
  it('is the server of a provider the runtime ships, its credential the reference it gives, placed where the way says', () => {
    const [code] = settingsOf(serversOfProviders).toolServers.servers;

    expect(code).toMatchObject({ name: 'code', type: 'mcp', url: github.url, orgs: ['acme'], provider: 'github' });
    expect(headersOf(code)).toEqual({ ...github.headers, Authorization: `Bearer ${githubToken}` });
  });

  it('is the server of a provider the file adds, with its placeholders in their place', () => {
    const [, accounts] = settingsOf(serversOfProviders).toolServers.servers;

    expect(accounts).toMatchObject({
      url: 'https://acme.crm.example.com/mcp',
      allowed: ['search_accounts'],
      provider: 'crm',
    });
    expect(headersOf(accounts)).toEqual({ Authorization: `Bearer ${crmToken}` });
  });

  it('takes client credentials, the client id sent where the provider says and the secret referred to', () => {
    const settings = settingsOf(serversOfProviders);
    const invoices = settings.toolServers.servers[2];

    expect(invoices).toMatchObject({
      type: 'openapi',
      document: { kind: 'url', url: 'https://books.example.com/openapi.json' },
      auth: { issuer: 'https://auth.books.example.com', client_id: 'acme-books', scope: 'invoices.read' },
      provider: 'books',
    });
    expect(headersOf(invoices)).toEqual({ 'X-Client': 'acme-books' });
    expect(settings.toolServers.referencedVariables).toEqual(['GITHUB_TOKEN', 'CRM_TOKEN', 'BOOKS_CLIENT_SECRET']);
  });
});

const literal = 'sk-live-0123456789abcdefghijklmn';

describe('the credential of an entry that names a provider, written out', () => {
  it('stops the start at its line and key, as the file refuses a credential, whatever header the provider places it in', () => {
    const asText = errorOf(`tool_servers:\n  code:\n    provider: github\n    credential: ${literal}\n    org: acme\n`);
    const asValue = errorOf(
      `tool_servers:\n  code:\n    provider: github\n    credential:\n      value: plain-token-of-github\n    org: acme\n`,
    );
    const asClientId = errorOf(
      `tool_servers:\n  invoices:\n    provider: books\n    credential:\n      client_id: ${literal}\n      client_secret: \${BOOKS_CLIENT_SECRET}\n    org: acme\n`,
    );

    expect([asText, asValue, asClientId]).toEqual([
      'ConfigFileInvalid: The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:38:17 tool_servers.code.credential: Looks like a credential, which this file never holds; write a reference to the environment variable that holds it instead, such as ${GATEWAY_API_KEY}',
      'tool_server_settings_invalid: The tool server settings are invalid. auto-runtime.yaml:39:14 tool_servers.code.credential.value: Expected a reference alone to the environment variable that holds the credential, such as ${TRACKER_TOKEN}, which the provider places where its way says',
      `ConfigFileInvalid: The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:39:18 tool_servers.invoices.credential.client_id: ${clientIdWrittenOut}`,
    ]);
  });
});

describe('a placeholder of an entry that names a provider', () => {
  it('stops the start at its value where it holds a reference, and at its key where it is not the provider’s', () => {
    const referred = errorOf(
      'tool_servers:\n  accounts:\n    provider: crm\n    placeholders:\n      tenant: ${CRM_TENANT}\n      team: core\n    credential: { kind: none }\n    org: acme\n',
      { ...secrets, CRM_TENANT: 'acme' },
    );

    expect(referred).toBe(
      'tool_server_settings_invalid: The tool server settings are invalid. ' +
        'auto-runtime.yaml:40:13 tool_servers.accounts.placeholders.team: The provider crm has no placeholder team; it takes tenant; ' +
        'auto-runtime.yaml:39:15 tool_servers.accounts.placeholders.tenant: Holds a $, which a placeholder never holds, since a reference to an environment variable begins with it',
    );
  });

  it('is judged by the file as a value, by its shape, whatever its name, as the provider judges it', () => {
    const keyed = `connections:
  providers:
    - name: keyed
      title: Keyed
      description: Read the records of a keyed store.
      website: https://developer.keyed.example.com
      type: mcp
      url: https://{key}.keyed.example.com/mcp
      placeholders:
        key:
          description: The key of your store, as in https://<key>.keyed.example.com
          pattern: '^[a-z0-9-]{1,63}$'
          example: acme
      credentials:
        - kind: none
tool_servers:
  store:
    provider: keyed
    placeholders:
      key: acme
    org: acme
`;
    const path = configFile(keyed);

    expect(readSettingsOf({ CONFIG_FILE: path }).toolServers.servers).toMatchObject([
      { name: 'store', url: 'https://acme.keyed.example.com/mcp', provider: 'keyed' },
    ]);
  });
});

describe('an entry that names a provider, refused', () => {
  it('stops the start at the line and key the operator wrote: a field of the server, a way and a placeholder left out', () => {
    expect(
      errorOf(
        'tool_servers:\n  code:\n    provider: github\n    url: https://code.example.com/mcp\n    org: acme\n  accounts:\n    provider: crm\n    credential: { kind: client_credentials }\n    org: acme\n',
      ),
    ).toBe(
      'tool_server_settings_invalid: The tool server settings are invalid. ' +
        'auto-runtime.yaml:38:10 tool_servers.code.url: Expected no url: the provider gives the server; ' +
        'auto-runtime.yaml:41:5 tool_servers.accounts.placeholders.tenant: Expected tenant: The tenant of your CRM, as in https://<tenant>.crm.example.com; ' +
        'auto-runtime.yaml:42:25 tool_servers.accounts.credential.kind: The provider crm takes no client_credentials credential; it takes secret or none',
    );
  });
});
