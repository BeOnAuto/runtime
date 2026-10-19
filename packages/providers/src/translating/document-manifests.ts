import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { listed } from '@on.auto/operations';
import { Schema } from 'effect';

import { CutSchema } from './discovery-cuts.ts';
import { OpenApiTranslationSchema } from './openapi-operations.ts';
import { convertedDocumentOf, SwaggerConversionSchema } from './swagger-conversion.ts';
import { translatedDiscoveryOf } from './translate-discovery.ts';
import { curatedOpenApiOf } from './translate-openapi.ts';

export const documentsBesideTheEntries = join(import.meta.dirname, '../entries/documents/');

const AuthorizationServerAddressSchema = Schema.String.annotate({
  description: 'The address of the metadata of the authorization server whose endpoints the oauth2 scheme names',
});

const DiscoveryManifestSchema = Schema.Struct({
  type: Schema.Literal('discovery').annotate({ description: 'A document translated from a Discovery document' }),
  discovery: Schema.String.annotate({ description: 'The address of the Discovery document the document is made from' }),
  revision: Schema.String.annotate({ description: 'The revision of the Discovery document it was last made from' }),
  authorization_server: AuthorizationServerAddressSchema,
  methods: Schema.Array(Schema.String)
    .check(Schema.isMinLength(1))
    .annotate({ description: 'The ids of the methods the document keeps' }),
  cuts: Schema.optionalKey(
    Schema.Array(CutSchema).annotate({
      description: 'The cuts of the schemas the requests of the document send, made before the translation',
    }),
  ),
});

type DiscoveryManifest = typeof DiscoveryManifestSchema.Type;

const OpenApiManifestSchema = Schema.Struct({
  type: Schema.Literal('openapi').annotate({ description: 'A document translated from OpenAPI documents' }),
  sources: Schema.Array(Schema.String)
    .check(Schema.isMinLength(1))
    .annotate({ description: 'The addresses of the OpenAPI documents in JSON the document is made from' }),
  authorization_server: AuthorizationServerAddressSchema,
  ...OpenApiTranslationSchema.fields,
});

type OpenApiManifest = typeof OpenApiManifestSchema.Type;

const SwaggerManifestSchema = Schema.Struct({
  type: Schema.Literal('swagger').annotate({
    description: 'A document converted from Swagger 2.0 documents and the OpenAPI 3 documents beside them',
  }),
  authorization_server: AuthorizationServerAddressSchema,
  ...SwaggerConversionSchema.fields,
});

type SwaggerManifest = typeof SwaggerManifestSchema.Type;

const DocumentManifestSchema = Schema.Union([DiscoveryManifestSchema, OpenApiManifestSchema, SwaggerManifestSchema]);

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

function documentPathOf(folder: string, name: string): string {
  return join(folder, `${name}${documentSuffix}`);
}

async function discoveryTranslated(
  { name, given }: Asked,
  manifest: DiscoveryManifest,
  { folder, fetching }: Translating,
): Promise<readonly Written[]> {
  const read = await (given === undefined ? fetchedJson(manifest.discovery, fetching) : givenJson(given));
  const metadata = await fetchedJson(manifest.authorization_server, fetching);
  const { document, revision } = translatedDiscoveryOf(read, metadata, manifest);
  const { type, discovery: address, authorization_server: authorizationServer, methods, cuts } = manifest;
  const remade = { type, discovery: address, revision, authorization_server: authorizationServer, methods };
  return [
    { path: documentPathOf(folder, name), text: jsonText(document) },
    {
      path: join(folder, `${name}${manifestSuffix}`),
      text: jsonText(cuts === undefined ? remade : { ...remade, cuts }),
    },
  ];
}

function fetchedAt(
  { name, given }: Asked,
  addresses: readonly string[],
  { fetching }: Translating,
): Promise<readonly unknown[]> {
  if (given !== undefined) {
    throw new Error(
      `The manifest ${name} is of OpenAPI documents, which the command fetches at the addresses it names, so no file is given in place of one. ${usage}`,
    );
  }
  return Promise.all(addresses.map((address) => fetchedJson(address, fetching)));
}

async function openApiTranslated(
  asked: Asked,
  manifest: OpenApiManifest,
  translating: Translating,
): Promise<readonly Written[]> {
  const documents = await fetchedAt(asked, manifest.sources, translating);
  const metadata = await fetchedJson(manifest.authorization_server, translating.fetching);
  const document = curatedOpenApiOf(documents, manifest, metadata);
  return [{ path: documentPathOf(translating.folder, asked.name), text: jsonText(document) }];
}

async function swaggerConverted(
  asked: Asked,
  manifest: SwaggerManifest,
  translating: Translating,
): Promise<readonly Written[]> {
  const documents = await fetchedAt(
    asked,
    manifest.sources.map(({ address }) => address),
    translating,
  );
  const metadata = await fetchedJson(manifest.authorization_server, translating.fetching);
  const document = convertedDocumentOf(documents, manifest, metadata);
  return [{ path: documentPathOf(translating.folder, asked.name), text: jsonText(document) }];
}

function translatedOne(asked: Asked, translating: Translating): Promise<readonly Written[]> {
  const manifest = manifestIn(translating.folder, asked.name);
  if (manifest.type === 'discovery') {
    return discoveryTranslated(asked, manifest, translating);
  }
  return manifest.type === 'openapi'
    ? openApiTranslated(asked, manifest, translating)
    : swaggerConverted(asked, manifest, translating);
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
