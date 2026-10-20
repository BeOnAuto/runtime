import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { trackerTranslated } from '../testing/curated-documents.ts';
import { trackerAuthorizationServer, trackerDiscovery, trackerManifest } from '../testing/discovery-documents.ts';
import {
  documentsBesideTheEntries,
  manifestIn,
  manifestNamesIn,
  translatedDocuments,
  type Fetching,
} from './document-manifests.ts';

const answers: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  [trackerManifest.discovery, trackerDiscovery],
  [trackerManifest.authorization_server, trackerAuthorizationServer],
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

const decodeOperations = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      paths: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Struct({ operationId: Schema.String }))),
    }),
  ),
);

function operationIdsOf(name: string): readonly string[] {
  const { paths } = decodeOperations(readFileSync(join(documentsBesideTheEntries, `${name}.openapi.json`), 'utf8'));
  return Object.values(paths)
    .flatMap((operations) => Object.values(operations).map(({ operationId }) => operationId))
    .toSorted();
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

describe('the manifests beside the entries', () => {
  it('are each one the command reads, keeping each method once', () => {
    const names = manifestNamesIn(documentsBesideTheEntries);
    const manifests = names.map((name) => manifestIn(documentsBesideTheEntries, name));

    expect(manifests.map(({ methods }) => methods.length)).toEqual(
      manifests.map(({ methods }) => new Set(methods).size),
    );
    expect(
      manifests
        .flatMap(({ discovery, authorization_server: metadata }) => [discovery, metadata])
        .filter((address) => !address.startsWith('https://')),
    ).toEqual([]);
    expect(names.length).toBeGreaterThan(0);
  });

  it('each have their document beside them, whose operations are the methods they keep', () => {
    const names = manifestNamesIn(documentsBesideTheEntries);

    expect(names.map((name) => operationIdsOf(name))).toEqual(
      names.map((name) => manifestIn(documentsBesideTheEntries, name).methods.toSorted()),
    );
  });
});
