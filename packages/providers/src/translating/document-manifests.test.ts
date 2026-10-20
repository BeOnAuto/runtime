import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { trackerTranslated } from '../testing/curated-documents.ts';
import { trackerAuthorizationServer, trackerDiscovery, trackerManifest } from '../testing/discovery-documents.ts';
import {
  aboutAddress,
  aboutManifest,
  aboutSource,
  aboutTranslated,
  issuesAddress,
  issuesSource,
  peopleAddress,
  peopleSource,
  trackerOpenApiManifest,
  trackerOpenApiTranslated,
} from '../testing/openapi-documents.ts';
import {
  foldersAddress,
  foldersOpenApi,
  notesAddress,
  notesManifest,
  notesSwagger,
} from '../testing/swagger-documents.ts';
import { manifestNamesIn, translatedDocuments, type Fetching } from './document-manifests.ts';

const answers: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  [trackerManifest.discovery, trackerDiscovery],
  [trackerManifest.authorization_server, trackerAuthorizationServer],
  [peopleAddress, peopleSource],
  [issuesAddress, issuesSource],
  [aboutAddress, aboutSource],
  [notesAddress, notesSwagger],
  [foldersAddress, foldersOpenApi],
]);

const fetched: string[] = [];

function fetchingFrom(answered: ReadonlyMap<string, unknown>): Fetching {
  return (address) => {
    fetched.push(address);
    const answer = answered.get(address);
    return Promise.resolve(answer === undefined ? new Response('Not Found', { status: 404 }) : Response.json(answer));
  };
}

function folderWith(files: Readonly<Record<string, unknown>>): string {
  const folder = mkdtempSync(join(tmpdir(), 'translated-documents-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
    fetched.splice(0);
  });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(folder, name), JSON.stringify(content));
  }
  return folder;
}

function parsed(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

function textOf(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function translatedIn(folder: string, commandArguments: readonly string[] = [], answered = answers) {
  return translatedDocuments(commandArguments, { folder, fetching: fetchingFrom(answered) });
}

const { cuts, ...uncut } = trackerManifest;

const remade = { ...trackerManifest, revision: trackerDiscovery.revision };

describe('the documents translated from their manifests', () => {
  it('are each the document of the methods its manifest keeps, cut as it says, with the manifest at the revision read', async () => {
    const folder = folderWith({ 'tracker.manifest.json': trackerManifest });

    const written = await translatedIn(folder);

    const read = written.map(({ text }) => parsed(text));
    expect(written.map(({ path }) => path)).toEqual([
      join(folder, 'tracker.openapi.json'),
      join(folder, 'tracker.manifest.json'),
    ]);
    expect(read).toEqual([trackerTranslated, remade]);
    expect(written.map(({ text }) => text)).toEqual(read.map((value) => textOf(value)));
    expect(fetched).toEqual([trackerManifest.discovery, trackerManifest.authorization_server]);
  });

  it('are made for the manifests named alone, from the Discovery document given beside a name instead of fetching it', async () => {
    const given = folderWith({ 'tracker-v1.json': trackerDiscovery });
    const folder = folderWith({ 'tracker.manifest.json': trackerManifest, 'bare.manifest.json': uncut });

    const written = await translatedIn(folder, [`tracker=${join(given, 'tracker-v1.json')}`]);

    expect(written.map(({ path }) => path)).toEqual([
      join(folder, 'tracker.openapi.json'),
      join(folder, 'tracker.manifest.json'),
    ]);
    expect(fetched).toEqual([trackerManifest.authorization_server]);
    expect(manifestNamesIn(folder)).toEqual(['bare', 'tracker']);
  });

  it('write a manifest without cuts as it is, and leave the schemas whole', async () => {
    const folder = folderWith({ 'bare.manifest.json': { ...uncut, methods: ['tracker.projects.issues.mutate'] } });

    const written = await translatedIn(folder, ['bare']);

    expect(written.map(({ text }) => parsed(text))).toMatchObject([
      {
        components: {
          schemas: {
            MutateOperation: { properties: { labelOperation: { $ref: '#/components/schemas/LabelOperation' } } },
          },
        },
      },
      { ...uncut, methods: ['tracker.projects.issues.mutate'], revision: trackerDiscovery.revision },
    ]);
    expect(written.map(({ text }) => parsed(text))).not.toHaveProperty([1, 'cuts']);
  });
});

describe('the documents not translated', () => {
  it('are refused for a name no manifest has, saying how the command is used', async () => {
    const folder = folderWith({ 'tracker.manifest.json': trackerManifest });

    await expect(translatedIn(folder, ['crm'])).rejects.toThrow(
      'There is no manifest named crm beside the documents, which hold tracker. Usage: pnpm --filter @on.auto/providers documents:translate [<name>[=<Discovery document>]]..., each name a manifest beside the documents, every manifest when none is named',
    );
  });

  it('are refused where an address answers with a failure', async () => {
    const folder = folderWith({ 'tracker.manifest.json': trackerManifest });

    await expect(translatedIn(folder, [], new Map())).rejects.toThrow(
      `${trackerManifest.discovery} answered 404, so nothing is translated from it`,
    );
  });

  it('are refused for a manifest that is not one', async () => {
    const folder = folderWith({ 'tracker.manifest.json': { ...trackerManifest, methods: [] } });

    await expect(translatedIn(folder)).rejects.toThrow('Expected a value with a length of at least 1');
  });
});

function cutWith(cut: unknown, discovery: unknown = trackerDiscovery) {
  const folder = folderWith({ 'tracker.manifest.json': { ...trackerManifest, cuts: [cut] } });
  return translatedIn(folder, [], new Map([...answers, [trackerManifest.discovery, discovery]]));
}

describe('a cut not made', () => {
  it('is refused for a schema the Discovery document does not have, or a property its schema does not have', async () => {
    const [writable, , kept] = cuts;

    await expect(cutWith({ ...kept, schema: 'Comment' })).rejects.toThrow(
      'The Discovery document has no schema Comment, which a cut names',
    );
    await expect(cutWith(kept, { ...trackerDiscovery, schemas: undefined })).rejects.toThrow(
      'The Discovery document has no schema MutateOperation, which a cut names',
    );
    await expect(cutWith({ ...writable, leaves_out: ['extra', 'owner', 'team'] })).rejects.toThrow(
      'The schema Issue of the Discovery document has no property owner, team, which a cut names',
    );
    await expect(cutWith({ ...writable, writable_in: { Unused: ['create'] } })).rejects.toThrow(
      'The schema Unused of the Discovery document has no property create, which a cut names',
    );
    await expect(cutWith({ ...kept, keeps: ['commentOperation'] })).rejects.toThrow(
      'The schema MutateOperation of the Discovery document has no property commentOperation, which a cut names',
    );
  });
});

describe('a cut a manifest does not take', () => {
  it('is a writable copy that leaves out properties without saying what they are, or says so where it leaves out none', async () => {
    const [writable] = cuts;

    await expect(cutWith({ ...writable, because: undefined })).rejects.toThrow(
      'Expected because, which says what the properties the cut leaves out are',
    );
    await expect(cutWith({ ...writable, leaves_out: [] })).rejects.toThrow(
      'Expected no because: the cut leaves out the output-only properties alone',
    );
  });
});

describe('the documents translated from the manifests of OpenAPI and Swagger documents', () => {
  it('are each the document of the operations its manifest keeps, from the documents it names, fetched, with no manifest written', async () => {
    const folder = folderWith({
      'tracker.manifest.json': trackerOpenApiManifest,
      'about.manifest.json': aboutManifest,
      'notes.manifest.json': notesManifest,
    });

    const written = await translatedIn(folder);

    const read = written.map(({ text }) => parsed(text));
    const converted = { info: notesManifest.info, security: [{ oauth2: [] }] };
    expect(written.map(({ path }) => path)).toEqual(
      ['about', 'notes', 'tracker'].map((name) => join(folder, `${name}.openapi.json`)),
    );
    expect(read).toEqual([aboutTranslated, expect.objectContaining(converted), trackerOpenApiTranslated]);
    expect(written.map(({ text }) => text)).toEqual(read.map((value) => textOf(value)));
    expect(fetched.toSorted()).toEqual(
      [
        aboutAddress,
        peopleAddress,
        issuesAddress,
        notesAddress,
        foldersAddress,
        ...Array.from({ length: 3 }, () => trackerManifest.authorization_server),
      ].toSorted(),
    );
  });

  it('are refused a file given in place of their documents, and a document that does not answer, in the words of the command', async () => {
    const gone = 'https://developers.tracker.example.com/api/gone/';
    const folder = folderWith({ 'tracker.manifest.json': trackerOpenApiManifest });
    const unanswered = folderWith({
      'tracker.manifest.json': { ...trackerOpenApiManifest, sources: [peopleAddress, gone] },
    });

    await expect(translatedIn(folder, ['tracker=tracker-people.json'])).rejects.toThrow(
      'The manifest tracker is of OpenAPI documents, which the command fetches at the addresses it names, so no file is given in place of one. Usage: pnpm --filter @on.auto/providers documents:translate',
    );
    await expect(translatedIn(unanswered)).rejects.toThrow(`${gone} answered 404, so nothing is translated from it`);
  });
});
