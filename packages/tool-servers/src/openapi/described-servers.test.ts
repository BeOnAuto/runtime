import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import {
  countedFetch,
  describedApiOf,
  describing,
  directoryWith,
  documentWithServer,
} from '../api-testing/described-documents.ts';
import { serveFakeApi, type FakeApiServer } from '../testing/index.ts';

const notes =
  "openapi: 3.0.3\ninfo: { title: Notes, version: '1' }\nservers:\n  - url: https://notes.example.com/v1\npaths:\n  /notes:\n    get: { operationId: listNotes }\n";

const keyed = { apiKeyAuth: '${GRAPH_API_KEY}' };

const sessionStateTool: unknown = expect.objectContaining({ name: 'sessionState' });

const offersSessionState: unknown = expect.arrayContaining([expect.objectContaining({ tool: sessionStateTool })]);

async function fakeApi(): Promise<FakeApiServer> {
  const fake = await serveFakeApi();
  onTestFinished(fake.close);
  return fake;
}

describe('the document of an openapi server, read from its URL at start', () => {
  it('sends the calls to the first server it names, and reports every operation it leaves out', async () => {
    const fake = await fakeApi();
    const { effect, leftOut } = describing({ graph: { document: fake.documentUrl, org: 'acme', security: keyed } });

    const { servers } = await Effect.runPromise(effect);

    expect(servers).toMatchObject([{ name: 'graph', type: 'openapi', api: { baseUrl: fake.baseUrl } }]);
    expect(leftOut.map(({ server, operation }) => `${server}: ${operation}`)).toEqual([
      'graph: sessionState (GET /sessions)',
      'graph: filtered (GET /filtered)',
      'graph: upload (POST /uploads)',
    ]);
  });

  it('is read through the fetch it is given, and leaves the servers of other kinds as they are', async () => {
    const fake = await fakeApi();
    const counted = countedFetch(globalThis.fetch);
    const entries = {
      graph: { document: fake.documentUrl, org: 'acme' },
      wiki: { url: 'https://wiki.example.com/mcp', org: 'acme' },
      notes: { command: '/usr/local/bin/notes', org: 'acme' },
    };

    const { servers } = await Effect.runPromise(describing(entries, { fetch: counted.fetch }).effect);

    expect(counted.fetched()).toEqual([fake.documentUrl]);
    expect(servers.map(({ name, type }) => `${name} ${type}`)).toEqual(['graph openapi', 'wiki mcp', 'notes stdio']);
  });

  it('sends the calls to base_url in place of the servers the document names', async () => {
    const fake = await fakeApi();
    const entry = { document: fake.documentUrl, base_url: 'https://graph.example.com/v2', org: 'acme' };

    expect(await describedApiOf({ graph: entry })).toMatchObject({ baseUrl: 'https://graph.example.com/v2' });
  });
});

describe('the operations of an openapi server that need a header', () => {
  it('are offered where the headers of the entry give each of them, whatever the case either writes', async () => {
    const fake = await fakeApi();
    const headers = { 'X-SESSION': 'session-of-acme' };
    const { effect, leftOut } = describing({
      graph: { document: fake.documentUrl, org: 'acme', security: keyed, headers },
    });

    const { servers } = await Effect.runPromise(effect);

    expect(servers).toMatchObject([{ api: { operations: offersSessionState } }]);
    expect(leftOut.map(({ operation }) => operation)).toEqual(['filtered (GET /filtered)', 'upload (POST /uploads)']);
  });
});

describe('the document of an openapi server, read from a file at start', () => {
  it('is JSON or YAML in the directory of the configuration file', async () => {
    const directory = directoryWith({
      'graph.json': documentWithServer('https://graph.example.com/v1'),
      'notes.yaml': notes,
    });

    const graph = await describedApiOf(
      { graph: { document: 'graph.json', org: 'acme', security: keyed } },
      { directory },
    );
    const listed = await describedApiOf({ notes: { document: 'notes.yaml', org: 'acme' } }, { directory });

    expect(graph?.baseUrl).toBe('https://graph.example.com/v1');
    expect(graph?.operations).toHaveLength(9);
    expect(listed).toMatchObject({
      baseUrl: 'https://notes.example.com/v1',
      operations: [{ tool: { name: 'listNotes' } }],
    });
  });

  it('takes the defaults of the variables of its first server, keeping one it does not declare as written', async () => {
    const directory = directoryWith({
      'graph.json': documentWithServer('https://{region}.graph.example.com/{stage}', { region: { default: 'eu' } }),
    });

    expect((await describedApiOf({ graph: { document: 'graph.json', org: 'acme' } }, { directory }))?.baseUrl).toBe(
      'https://eu.graph.example.com/%7Bstage%7D',
    );
  });

  it('sends the calls to the first server it names without the slashes it ends in, as base_url is read', async () => {
    const directory = directoryWith({
      'graph.json': documentWithServer('https://graph.example.com/v1/'),
      'root.json': documentWithServer('https://graph.example.com'),
    });

    expect(
      await Promise.all(
        ['graph.json', 'root.json'].map(
          async (document) => (await describedApiOf({ graph: { document, org: 'acme' } }, { directory }))?.baseUrl,
        ),
      ),
    ).toEqual(['https://graph.example.com/v1', 'https://graph.example.com']);
  });
});

describe('the address of the first server a document names', () => {
  it('reads an address of 200,000 braces in one pass, and keeps them as written', async () => {
    const braces = '{'.repeat(200_000);
    const directory = directoryWith({ 'graph.json': documentWithServer(`https://graph.example.com/${braces}`) });

    expect((await describedApiOf({ graph: { document: 'graph.json', org: 'acme' } }, { directory }))?.baseUrl).toBe(
      `https://graph.example.com/${'%7B'.repeat(200_000)}`,
    );
  });
});
