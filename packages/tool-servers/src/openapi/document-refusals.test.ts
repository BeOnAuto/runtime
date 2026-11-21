import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import {
  baseUrlProblem,
  countedFetch,
  directoryWith,
  documentProblem,
  documentWithServer,
  documentsIn,
  refusalOf,
  servedDocumentAt,
} from '../api-testing/described-documents.ts';
import { shippedDocumentOf } from '../settings/server-settings.ts';
import { fakeApiDocument, fakeApiInProcess, inProcessFetch, refusedConnections } from '../testing/index.ts';

const brokenFetch: typeof globalThis.fetch = () =>
  Promise.resolve(
    new Response(
      new ReadableStream({
        start: (controller) => {
          controller.error('the connection was reset');
        },
      }),
    ),
  );

function refusedIn(directory: string) {
  return (document: string) => refusalOf({ graph: { document, org: 'acme' } }, documentsIn(directory));
}

describe('a document refused at start because its URL', () => {
  it('answers an error, cannot be reached or does not answer in time', async () => {
    const missing = servedDocumentAt(() => Promise.resolve(new Response('gone', { status: 404 })));
    const silent = servedDocumentAt(() => Promise.withResolvers<Response>().promise);
    const gone = fakeApiInProcess();
    await gone.close();

    expect(await refusalOf({ graph: { document: missing, org: 'acme' } })).toBe(
      documentProblem('The document could not be read: its URL answered HTTP 404'),
    );
    expect(
      await refusalOf(
        { graph: { document: gone.documentUrl, org: 'acme' } },
        { fetch: refusedConnections([gone.origin]).fetch },
      ),
    ).toBe(documentProblem('The document could not be read: fetch failed'));
    expect(await refusalOf({ graph: { document: silent, org: 'acme' } }, { readMs: 50 })).toBe(
      documentProblem('The document was not read within 50 ms'),
    );
  });

  it('answers a redirect, which is not followed to the address it names', async () => {
    const other = fakeApiInProcess();
    onTestFinished(other.close);
    const moved = servedDocumentAt(() =>
      Promise.resolve(new Response(null, { status: 302, headers: { location: `${other.baseUrl}/openapi.json` } })),
    );

    const refusal = await refusalOf({ graph: { document: moved, org: 'acme' } });

    expect([refusal.startsWith(documentProblem('')), refusal.includes('302')]).toEqual([true, true]);
    expect(other.seen()).toEqual([]);
  });

  it('breaks off its answer', async () => {
    const document = 'https://graph.example.com/openapi.json';

    expect(await refusalOf({ graph: { document, org: 'acme' } }, { fetch: brokenFetch })).toBe(
      documentProblem('The document could not be read: the connection was reset'),
    );
  });
});

describe('a document refused at start because of its bytes', () => {
  it('when it takes more than 4 MiB at its URL, in its file or in the bytes the providers measured as they read it', async () => {
    const large = 'x'.repeat(4_194_305);
    const served = servedDocumentAt(() => Promise.resolve(new Response(large)));
    const directory = directoryWith({ 'graph.json': large });
    const byName = new Map([['graph.json', shippedDocumentOf(new TextEncoder().encode('é'.repeat(2_097_153)))]]);
    const refusals = [
      await refusalOf({ graph: { document: served, org: 'acme' } }),
      await refusedIn(directory)('graph.json'),
      await refusalOf({ graph: { document: 'graph.json', org: 'acme' } }, { documents: { kind: 'shipped', byName } }),
    ];

    expect(new Set(refusals).size).toBe(1);
    expect([refusals[0]?.startsWith(documentProblem('')), refusals[0]?.includes('4194304')]).toEqual([true, true]);
  });

  it('when its file does not exist or cannot be read', async () => {
    const directory = directoryWith({});
    mkdirSync(join(directory, 'graph.json'));

    expect(await refusedIn(directory)('notes.json')).toBe(documentProblem('The document does not exist'));
    expect(await refusedIn(directory)('graph.json')).toBe(documentProblem('The document could not be read (EISDIR)'));
  });
});

describe('a document refused at start because of what it holds', () => {
  it('when it is neither JSON nor YAML, nests too deep, is not of OpenAPI 3.0, 3.1 or 3.2, or is Swagger 2.0', async () => {
    const refused = refusedIn(
      directoryWith({
        'broken.yaml': 'openapi: [3.1\n',
        'deep.json': `${'['.repeat(130)}${']'.repeat(130)}`,
        'later.json': JSON.stringify({ openapi: '4.0.0', paths: {} }),
        'swagger.json': JSON.stringify({ swagger: '2.0', paths: {} }),
      }),
    );

    expect(await refused('broken.yaml')).toMatch(
      /graph\/document: The document is neither JSON nor YAML: line 2, column 1: /u,
    );
    expect(await refused('deep.json')).toBe(documentProblem('The document nests values more than 128 levels deep'));
    expect(await refused('later.json')).toContain(documentProblem('At /openapi of the document'));
    expect(await refused('swagger.json')).toContain(documentProblem('At /swagger of the document'));
  });

  it('when a part the bridge reads is not of the shape the specification gives it, at its place', async () => {
    const paths = { '/a': { get: { parameters: [{ name: 'x', in: 'body' }] } } };
    const refused = refusedIn(directoryWith({ 'graph.json': JSON.stringify({ openapi: '3.1.0', paths }) }));

    expect(await refused('graph.json')).toMatch(
      /graph\/document: At \/paths\/~1a\/get\/parameters\/0(\/in)? of the document: /u,
    );
  });

  it('when its operations cannot be offered as tools, naming each place', async () => {
    const paths = { '/a': { get: { operationId: 'a' } }, '/b': { get: { operationId: 'a' } } };
    const refused = refusedIn(directoryWith({ 'graph.json': JSON.stringify({ openapi: '3.1.0', paths }) }));

    const refusal = await refused('graph.json');

    expect([
      refusal.startsWith(documentProblem('At /paths/~1b/get of the document')),
      refusal.includes('/paths/~1a/get'),
    ]).toEqual([true, true]);
  });
});

const elsewhere = [
  'https://schemas.example.com/note.json',
  'http://schemas.example.com/note.json',
  'file:///etc/passwd',
];

function referringTo(address: string): string {
  return JSON.stringify({ openapi: '3.1.0', paths: {}, components: { schemas: { Note: { $ref: address } } } });
}

describe('a document refused at start because a schema refers outside it', () => {
  it('to an https, http or file address, naming the entry and the place, and fetching nothing', async () => {
    const counted = countedFetch(inProcessFetch);
    const directory = directoryWith(
      Object.fromEntries(elsewhere.map((address, index) => [`graph-${index}.json`, referringTo(address)])),
    );
    const refused = (document: string) =>
      refusalOf({ graph: { document, org: 'acme' } }, { ...documentsIn(directory), fetch: counted.fetch });

    const refusals = await Promise.all(elsewhere.map((_, index) => refused(`graph-${index}.json`)));

    expect(new Set(refusals).size).toBe(1);
    expect(refusals[0]).toContain(documentProblem('At /components/schemas/Note/$ref of the document'));
    expect(counted.fetched()).toEqual([]);
  });
});

function pathsAt(...keys: readonly string[]): string {
  return JSON.stringify({ openapi: '3.1.0', paths: Object.fromEntries(keys.map((key) => [key, { get: {} }])) });
}

describe('a document refused at start because a path would take its calls elsewhere', () => {
  it('to another host or port, which a path that does not begin with / joins, sending nothing there', async () => {
    const other = fakeApiInProcess({ key: 'graph-api-key-4f1d9a7c2b' });
    onTestFinished(other.close);
    const last = other.origin.slice(-1);
    const directory = directoryWith({ 'graph.json': pathsAt(`${last}/v1/search`, '.attacker.example/x') });

    const refusal = await refusalOf(
      { graph: { document: 'graph.json', base_url: other.origin.slice(0, -1), org: 'acme' } },
      documentsIn(directory),
    );

    expect(refusal).toContain(
      `graph/document: At /paths/${last}~1v1~1search of the document: Expected a path that begins with /, since`,
    );
    expect(refusal).toContain('At /paths/.attacker.example~1x of the document');
    expect(other.seen()).toEqual([]);
  });

  it('out of itself, by a . or .. segment written plainly, encoded or split by a tab, or by a ? or #', async () => {
    const refused = refusedIn(
      directoryWith({ 'graph.json': pathsAt('/v1/../admin', '/v1/%2E%2e/admin', '/.\t./x', '/a?b') }),
    );

    expect(
      (await refused('graph.json')).match(/At \/paths\/[^ ]+ of the document: A path a call cannot keep/gu),
    ).toHaveLength(4);
  });
});

describe('a document refused at start because its calls would land in a query or a fragment', () => {
  it('naming a first server with either', async () => {
    const refused = refusedIn(
      directoryWith({
        'query.json': documentWithServer('https://graph.example.com/v1?tenant=acme'),
        'fragment.json': documentWithServer('https://graph.example.com/v1#top'),
      }),
    );
    const refusals = [await refused('query.json'), await refused('fragment.json')];

    expect(new Set(refusals).size).toBe(1);
    expect(refusals[0]?.startsWith(baseUrlProblem(''))).toBe(true);
  });
});

describe('a document refused at start because its calls would have nowhere to go', () => {
  it('naming no server, one relative to a file, or one neither https nor on loopback', async () => {
    const refused = refusedIn(
      directoryWith({
        'none.json': JSON.stringify({ ...fakeApiDocument('3.1', '/v1'), servers: [] }),
        'unsaid.json': JSON.stringify({ openapi: '3.1.0', paths: {} }),
        'relative.json': JSON.stringify(fakeApiDocument('3.1', '/v1')),
        'plain.json': documentWithServer('http://graph.example.com/v1'),
      }),
    );
    const noServer = baseUrlProblem('Expected base_url, since the document names no server');

    expect(await refused('none.json')).toBe(noServer);
    expect(await refused('unsaid.json')).toBe(noServer);
    const others = [await refused('relative.json'), await refused('plain.json')];

    expect(others.map((refusal) => refusal.startsWith(baseUrlProblem('')))).toEqual([true, true]);
    expect(new Set([noServer, ...others]).size).toBe(3);
  });
});
