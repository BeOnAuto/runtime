import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listed } from '@on.auto/operations';
import { Schema } from 'effect';

import { CutSchema, discoveryCut } from './discovery-cuts.ts';
import { authorizationServerOf, discoveryDocumentOf } from './discovery-document.ts';
import { curatedDocumentOf } from './translate-discovery.ts';

export const documentsBesideTheEntries = fileURLToPath(new URL('../entries/documents/', import.meta.url));

const DocumentManifestSchema = Schema.Struct({
  discovery: Schema.String.annotate({ description: 'The address of the Discovery document the document is made from' }),
  revision: Schema.String.annotate({ description: 'The revision of the Discovery document it was last made from' }),
  authorization_server: Schema.String.annotate({
    description: 'The address of the metadata of the authorization server whose endpoints the oauth2 scheme names',
  }),
  methods: Schema.Array(Schema.String)
    .check(Schema.isMinLength(1))
    .annotate({ description: 'The ids of the methods the document keeps' }),
  cuts: Schema.optionalKey(
    Schema.Array(CutSchema).annotate({
      description: 'The cuts of the schemas the requests of the document send, made before the translation',
    }),
  ),
});

export type DocumentManifest = typeof DocumentManifestSchema.Type;

const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(DocumentManifestSchema));

const manifestSuffix = '.manifest.json';

const documentSuffix = '.openapi.json';

export type Fetching = (address: string) => Promise<Response>;

export interface Translating {
  readonly folder: string;
  readonly fetching: Fetching;
}

export interface Written {
  readonly path: string;
  readonly text: string;
}

interface Asked {
  readonly name: string;
  readonly given: string | undefined;
}

const usage =
  'Usage: pnpm --filter @on.auto/providers documents:translate [<name>[=<Discovery document>]]..., each name a manifest beside the documents, every manifest when none is named';

export function manifestNamesIn(folder: string): readonly string[] {
  return readdirSync(folder)
    .filter((file) => file.endsWith(manifestSuffix))
    .map((file) => file.slice(0, -manifestSuffix.length))
    .toSorted();
}

export function manifestIn(folder: string, name: string): DocumentManifest {
  return decodeManifest(readFileSync(join(folder, `${name}${manifestSuffix}`), 'utf8'));
}

function askedOf(commandArgument: string, names: readonly string[]): Asked {
  const at = commandArgument.indexOf('=');
  const name = at === -1 ? commandArgument : commandArgument.slice(0, at);
  const given = at === -1 ? undefined : commandArgument.slice(at + 1);
  if (!names.includes(name)) {
    throw new Error(`There is no manifest named ${name} beside the documents, which hold ${listed(names)}. ${usage}`);
  }
  return { name, given };
}

async function fetchedJson(address: string, fetching: Fetching): Promise<unknown> {
  const answer = await fetching(address);
  if (!answer.ok) {
    throw new Error(`${address} answered ${String(answer.status)}, so nothing is translated from it`);
  }
  const read: unknown = await answer.json();
  return read;
}

async function givenJson(path: string): Promise<unknown> {
  const read: unknown = JSON.parse(await readFile(path, 'utf8'));
  return read;
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function translatedOne({ name, given }: Asked, { folder, fetching }: Translating): Promise<readonly Written[]> {
  const manifest = manifestIn(folder, name);
  const read = given === undefined ? fetchedJson(manifest.discovery, fetching) : givenJson(given);
  const discovery = discoveryDocumentOf(await read);
  const server = authorizationServerOf(await fetchedJson(manifest.authorization_server, fetching));
  const document = curatedDocumentOf(discoveryCut(discovery, manifest.cuts ?? []), server, manifest.methods);
  const { discovery: address, authorization_server: authorizationServer, methods, cuts } = manifest;
  const remade = {
    discovery: address,
    revision: discovery.revision,
    authorization_server: authorizationServer,
    methods,
  };
  return [
    { path: join(folder, `${name}${documentSuffix}`), text: jsonText(document) },
    {
      path: join(folder, `${name}${manifestSuffix}`),
      text: jsonText(cuts === undefined ? remade : { ...remade, cuts }),
    },
  ];
}

export async function translatedDocuments(
  commandArguments: readonly string[],
  translating: Translating,
): Promise<readonly Written[]> {
  const names = manifestNamesIn(translating.folder);
  const asked =
    commandArguments.length === 0
      ? names.map((name): Asked => ({ name, given: undefined }))
      : commandArguments.map((each) => askedOf(each, names));
  const translated = await Promise.all(asked.map((each) => translatedOne(each, translating)));
  return translated.flat();
}
