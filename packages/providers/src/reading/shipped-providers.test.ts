import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentServerOf, hostAlternativesOf, operatorVariablesOf, readProviders, type Provider } from '../index.ts';
import { entryFolderWith } from '../testing/entry-problems.ts';

const shipped = Result.getOrThrow(readProviders());

const entriesFolder = fileURLToPath(new URL('../entries/', import.meta.url));

function addressesOf({ entry, address }: Provider): readonly string[] {
  return [entry.website, address, ...entry.credentials.flatMap(({ issuer }) => (issuer === undefined ? [] : [issuer]))];
}

const tracker = [
  'name: tracker',
  'title: Tracker',
  'description: Read and change issues.',
  'website: https://developer.tracker.example.com',
  'type: mcp',
  'url: https://tracker.example.com/mcp',
  'credentials:',
  '  - kind: none',
  '',
].join('\n');

const notes = [
  'name: notes',
  'title: Notes',
  'description: Read notes.',
  'website: https://developer.notes.example.com',
  'type: openapi',
  'document: documents/notes.openapi.json',
  'credentials:',
  '  - kind: none',
  '',
].join('\n');

const invalid = 'The entries of the providers are invalid: ';

const served = JSON.stringify({ openapi: '3.1.0', servers: [{ url: 'https://api.notes.example.com/v1/' }], paths: {} });

const unserved = JSON.stringify({ openapi: '3.1.0', paths: {} });

function servedAt(url: string): string {
  return JSON.stringify({ openapi: '3.1.0', servers: [{ url }], paths: {} });
}

describe('the shipped providers', () => {
  it('are the entries of the folder, each named as its file, sorted by name and so each named once', () => {
    const names = shipped.providers.map(({ entry }) => entry.name);

    expect(names).toEqual(['github', 'profound', 'slack-api']);
    expect(
      readdirSync(entriesFolder)
        .filter((file) => file.endsWith('.yaml'))
        .toSorted(),
    ).toEqual(names.map((name) => `${name}.yaml`));
    expect(new Set(names).size).toBe(names.length);
  });

  it('reach their servers, their pages and their issuers over https alone', () => {
    const addresses = shipped.providers.flatMap((provider) => addressesOf(provider));

    expect(addresses.filter((address) => !address.startsWith('https://'))).toEqual([]);
    expect(addresses.length).toBeGreaterThan(5);
  });
});

describe('the ways and the servers of the shipped providers', () => {
  it('take only the ways the runtime takes and refer to no value whoever runs the runtime sets', () => {
    expect(
      shipped.providers.map(({ entry }) => [
        entry.name,
        entry.credentials.map(({ kind }) => kind),
        operatorVariablesOf(entry),
      ]),
    ).toEqual([
      ['github', ['secret'], []],
      ['profound', ['secret'], []],
      ['slack-api', ['secret'], []],
    ]);
  });

  it('read the server an HTTP API calls from the document beside the entries, where the entry gives no base_url', () => {
    expect(shipped.providers.map(({ entry, address }) => [entry.name, address])).toEqual([
      ['github', 'https://api.githubcopilot.com/mcp/'],
      ['profound', 'https://mcp.tryprofound.com/mcp'],
      ['slack-api', 'https://slack.com/api'],
    ]);
    expect(
      shipped.providers.map((provider) => provider.entry.credentials.map((way) => hostAlternativesOf(provider, way))),
    ).toEqual([[[['api.githubcopilot.com']]], [[['mcp.tryprofound.com']]], [[['slack.com']]]]);
    expect(shipped.providers.map((provider) => documentServerOf(provider))).toEqual([
      undefined,
      undefined,
      'https://slack.com/api',
    ]);
    expect(shipped.documents).toBe(entriesFolder);
  });
});

describe('a folder of entries', () => {
  it('is read with the server of a document beside it, or the address of a document an entry names by URL', () => {
    const remote = notes.replace('documents/notes.openapi.json', 'https://notes.example.com/openapi.json');
    const beside = { 'notes.yaml': notes, 'tracker.yaml': tracker, 'documents/notes.openapi.json': served };

    expect(entryFolderWith(beside).read()).toBe(
      'notes https://api.notes.example.com/v1; tracker https://tracker.example.com/mcp',
    );
    expect(entryFolderWith({ 'notes.yaml': remote, 'README.md': '# Entries' }).read()).toBe(
      'notes https://notes.example.com/openapi.json',
    );
  });

  it('is sorted by the names of the providers, not of their files', () => {
    const slack = tracker.replace('name: tracker', 'name: slack');
    const slackApi = tracker.replace('name: tracker', 'name: slack-api');

    expect(entryFolderWith({ 'slack.yaml': slack, 'slack-api.yaml': slackApi }).read()).toBe(
      'slack https://tracker.example.com/mcp; slack-api https://tracker.example.com/mcp',
    );
  });
});

describe('a folder of entries the runtime refuses', () => {
  it('is refused with the file, the line and the key of each problem, as a settings file is', () => {
    const refused = entryFolderWith({
      'tracker.yaml': tracker.replace('  - kind: none', '  - kind: reference'),
      'notes.yaml': notes.replace('name: notes', 'name: notebook').replace('/notes.', '/notebook.'),
      'broken.yaml': 'name: [broken\n',
      'anchored.yaml': 'name: &name tracker\n',
    }).read();

    expect(refused.split('; ')).toEqual([
      `${invalid}<entries>/anchored.yaml:1:13: Anchors are not allowed in a provider's entry`,
      '<entries>/broken.yaml:2:1: Flow sequence in block collection must be sufficiently indented and end with a ]',
      '<entries>/notes.yaml:1:7 name: Expected the name the file is named for, as in notebook.yaml',
      '<entries>/tracker.yaml:8:11 credentials[0].kind: Expected "secret" | "client_credentials" | "none" | "authorization"',
    ]);
  });

  it('refuses a document that is not the one beside the entries named for the provider', () => {
    const elsewhere = notes.replace('documents/notes.openapi.json', 'documents/other.openapi.json');
    const at = `${invalid}<entries>/notes.yaml:6:11 document`;

    expect([
      entryFolderWith({ 'notes.yaml': elsewhere }).read(),
      entryFolderWith({ 'notes.yaml': notes }).read(),
      entryFolderWith({ 'notes.yaml': notes, 'documents/notes.openapi.json': '{ not json' }).read(),
    ]).toEqual([
      `${at}: Expected an https URL, or an http URL on a loopback address, written out up to its host, with each placeholder in its place, or documents/notes.openapi.json, the document beside the entries named for the provider`,
      `${at}: Expected documents/notes.openapi.json beside the entries, an OpenAPI document in JSON`,
      `${at}: Expected documents/notes.openapi.json beside the entries, an OpenAPI document in JSON`,
    ]);
  });
});

describe('the server of a document beside the entries', () => {
  it('is refused where the document names none, unless the entry gives base_url', () => {
    const based = `${notes}base_url: https://api.notes.example.com\n`;

    expect([
      entryFolderWith({ 'notes.yaml': notes, 'documents/notes.openapi.json': unserved }).read(),
      entryFolderWith({ 'notes.yaml': based, 'documents/notes.openapi.json': unserved }).read(),
    ]).toEqual([
      `${invalid}<entries>/notes.yaml:6:11 document: The document names no server, so the entry gives base_url`,
      'notes https://api.notes.example.com',
    ]);
  });

  it('is refused where the first is no pinned URL written out, unless the entry gives base_url', () => {
    const refusal = `${invalid}<entries>/notes.yaml:6:11 document: The first server the document names is no https URL, or http URL on a loopback address, without a variable, so the entry gives base_url`;

    expect([
      entryFolderWith({ 'notes.yaml': notes, 'documents/notes.openapi.json': servedAt('/v1') }).read(),
      entryFolderWith({
        'notes.yaml': notes,
        'documents/notes.openapi.json': servedAt('http://notes.example.com'),
      }).read(),
      entryFolderWith({
        'notes.yaml': notes,
        'documents/notes.openapi.json': servedAt('https://{region}.notes.example.com'),
      }).read(),
    ]).toEqual([refusal, refusal, refusal]);
  });
});
