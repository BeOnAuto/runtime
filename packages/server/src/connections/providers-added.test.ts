import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { offeredByTheServer, shippedProviders } from '../testing/servers/connected-servers.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

const workspace = 'notes-workspace-6b2e0d';

const notesToken = 'notes-token-8c41f2a7d0';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function configFile(text: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-providers-added-'));
  onTestFinished(() => {
    rmSync(directory, { recursive: true });
  });
  const path = join(directory, 'auto-runtime.yaml');
  writeFileSync(path, text);
  return path;
}

function notesAt(url: string, name = 'notes'): string {
  return `  providers:
    - name: ${name}
      title: Notes
      description: Read and write the notes of a team.
      website: https://developer.notes.example.com
      type: mcp
      url: ${url}
      headers:
        X-Workspace: \${NOTES_WORKSPACE}
      credentials:
        - kind: secret
          in: header
          name: Authorization
          scheme: Bearer
          description: Token from the settings of your notes.
`;
}

async function servedWith(text: string): Promise<ReasoningServer> {
  const server = await servingReasoning([], {
    CONFIG_FILE: configFile(text),
    NOTES_WORKSPACE: workspace,
    NOTES_TOKEN: notesToken,
  });
  closing.push(server.stop);
  return server;
}

const ListedSchema = Schema.Struct({
  providers: Schema.Array(Schema.Struct({ name: Schema.String, title: Schema.String, website: Schema.String })),
});

async function listedBy(server: ReasoningServer) {
  const { body } = await server.call('GET', '/v1/orgs/local/providers');
  return Schema.decodeUnknownSync(ListedSchema)(body).providers;
}

const notes = { name: 'notes', title: 'Notes', description: 'Read and write the notes of a team.' };

describe('a provider the settings file adds', () => {
  it('is listed, offered by search and connected by its name, as a provider the runtime ships is', async () => {
    const server = await servedWith(`connections:\n${notesAt('https://notes.example.com/mcp')}`);

    const listed = await listedBy(server);
    const searched = await server.call('GET', '/v1/orgs/local/tool-servers/search');
    const added = await server.call('POST', '/v1/orgs/local/connections', { body: { provider: 'notes' } });

    expect(listed.map(({ name }) => name)).toEqual(
      [...shippedProviders.map(({ entry }) => entry.name), 'notes'].toSorted(),
    );
    expect(searched).toMatchObject({
      status: 200,
      body: { providers: [...offeredByTheServer, notes].toSorted((one, other) => one.name.localeCompare(other.name)) },
    });
    expect(added).toMatchObject({
      status: 201,
      body: {
        name: 'notes',
        provider: 'notes',
        entry: { url: 'https://notes.example.com/mcp', headers: { 'X-Workspace': '${NOTES_WORKSPACE}' } },
        credential: { kind: 'secret', in: 'header', name: 'Authorization', scheme: 'Bearer' },
      },
    });
    expect(JSON.stringify(added.body)).not.toContain(workspace);
  });

  it('takes the place of a shipped provider of its name', async () => {
    const server = await servedWith(`connections:\n${notesAt('https://code.internal.example.com/mcp', 'github')}`);

    const listed = await listedBy(server);
    const added = await server.call('POST', '/v1/orgs/local/connections', { body: { provider: 'github' } });

    expect(listed.filter(({ name }) => name === 'github')).toEqual([
      { name: 'github', title: 'Notes', website: 'https://developer.notes.example.com' },
    ]);
    expect(added).toMatchObject({ status: 201, body: { entry: { url: 'https://code.internal.example.com/mcp' } } });
  });
});

const regionsAdded = `connections:
  providers:
    - name: regions
      title: Regions
      description: Read the campaigns of one account, in the region it is kept in.
      website: https://developer.regions.example.com
      type: mcp
      url: https://{api_host}/mcp
      placeholders:
        region:
          description: The region your account is kept in, which sets the hosts of the API and of its tokens
          choices:
            - value: na
              title: North America
              sets: { api_host: api-na.regions.example.com, token_host: auth-na.regions.example.com }
            - value: eu
              title: Europe
              sets: { api_host: api-eu.regions.example.com, token_host: auth-eu.regions.example.com }
      credentials:
        - kind: client_credentials
          issuer: https://{token_host}
`;

const RegionsListedSchema = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      credentials: Schema.Array(Schema.Struct({ kind: Schema.String, issuer: Schema.optionalKey(Schema.String) })),
      placeholders: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          choices: Schema.optionalKey(Schema.Array(Schema.Struct({ value: Schema.String }))),
        }),
      ),
    }),
  ),
});

describe('a provider the settings file adds, whose choices set a host named for its tokens', () => {
  it('is read, since the file judges what a placeholder sets by its shape alone, and listed with its choices', async () => {
    const server = await servedWith(regionsAdded);

    const { body } = await server.call('GET', '/v1/orgs/local/providers');
    const regions = Schema.decodeUnknownSync(RegionsListedSchema)(body).providers.filter(
      ({ name }) => name === 'regions',
    );

    expect(regions).toEqual([
      {
        name: 'regions',
        credentials: [{ kind: 'client_credentials', issuer: 'https://{token_host}' }],
        placeholders: [{ name: 'region', choices: [{ value: 'na' }, { value: 'eu' }] }],
      },
    ]);
  });
});

function refusalOf(environment: Readonly<Record<string, string>>): string {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return String(error).replaceAll(environment['CONFIG_FILE'] ?? 'no file', 'auto-runtime.yaml');
  }
  return 'read';
}

const unpinned =
  'Expected an https URL, or an http URL on a loopback address, written out up to its host, with each placeholder in its place';

const refusedNotes = {
  name: 'notes',
  title: 'Notes',
  description: 'Read and write the notes of a team.',
  website: 'https://developer.notes.example.com',
  type: 'mcp',
  url: 'http://notes.example.com/mcp',
  credentials: [{ kind: 'none' }],
};

describe('a provider the settings add, which the schema of a provider refuses', () => {
  it('stops the start at its line and key in the file, and at its pointer in the environment', () => {
    const path = configFile(`connections:\n${notesAt('http://notes.example.com/mcp')}`);

    expect([
      refusalOf({ CONFIG_FILE: path, NOTES_WORKSPACE: workspace }),
      refusalOf({ CONNECTIONS: JSON.stringify({ providers: [refusedNotes] }) }),
    ]).toEqual([
      `ConfigFileInvalid: The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:8:12 connections.providers[0].url: ${unpinned}`,
      `connections_setting_invalid: The connection settings are invalid. CONNECTIONS: /providers/0/url: ${unpinned}`,
    ]);
  });

  it('stops the start at a way into a header its entry sends already, in another case, and at a name given twice', () => {
    const colliding = notesAt('https://notes.example.com/mcp').replace('name: Authorization', 'name: x-workspace');
    const path = configFile(
      `connections:\n${colliding}${notesAt('https://notes.example.com/mcp').replace('  providers:\n', '')}`,
    );

    expect(refusalOf({ CONFIG_FILE: path, NOTES_WORKSPACE: workspace })).toBe(
      'ConfigFileInvalid: The configuration file auto-runtime.yaml is invalid: ' +
        'auto-runtime.yaml:14:17 connections.providers[0].credentials[0].name: The entry sends this header already, so the credential cannot go in it; ' +
        'auto-runtime.yaml:17:13 connections.providers[1].name: Expected a name no other provider of the setting has',
    );
  });
});

async function fakeNotes(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: notesToken });
  closing.push(fake.close);
  return fake;
}

describe('a provider an entry of the settings file names', () => {
  it('is left out of the providers the search offers, and its server is searched with the provider', async () => {
    const fake = await fakeNotes();
    const server = await servedWith(
      `connections:\n${notesAt(fake.url)}tool_servers:\n  team-notes:\n    provider: notes\n    credential: \${NOTES_TOKEN}\n    org: local\n    allowed: [search]\n`,
    );

    const searched = await server.call('GET', '/v1/orgs/local/tool-servers/search');

    expect(searched).toMatchObject({
      status: 200,
      body: {
        servers: [{ name: 'team-notes', type: 'mcp', provider: 'notes', tool_count: 1 }],
        providers: offeredByTheServer,
      },
    });
    expect(fake.seen().map(({ authorization }) => authorization)).toContain(`Bearer ${notesToken}`);
  });
});
