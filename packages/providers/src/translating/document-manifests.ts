import { listed, shippedFileIn, type ShippedFile, type ShippedFiles } from '@on.auto/operations';
import { documentInText } from '@on.auto/tool-servers';
import { Result, Schema } from 'effect';

import { shippedEntries } from '../reading/shipped-providers.ts';
import { CutSchema } from './discovery-cuts.ts';
import { OpenApiTranslationSchema } from './openapi-translation.ts';
import { convertedDocumentOf, SwaggerConversionSchema } from './swagger-conversion.ts';
import { translatedDiscoveryOf } from './translate-discovery.ts';
import { curatedOpenApiOf } from './translate-openapi.ts';

export const documentsBesideTheEntries: ShippedFile = shippedFileIn(shippedEntries, 'documents');

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
    .annotate({ description: 'The addresses of the OpenAPI documents in JSON or YAML the document is made from' }),
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
  readonly folder: ShippedFile;
  readonly shippedFiles: ShippedFiles;
  readonly fetching: Fetching;
  readonly readGiven: (path: string) => Promise<string>;
}

export interface Written {
  readonly file: ShippedFile;
  readonly text: string;
}

type Reading = (address: string) => Promise<unknown>;

interface Run extends Translating {
  readonly reading: Reading;
}

interface Asked {
  readonly name: string;
  readonly given: string | undefined;
}

const usage =
  'Usage: pnpm --filter @on.auto/providers documents:translate [<name>[=<Discovery document>]]..., each name a manifest beside the documents, every manifest when none is named';

export async function manifestNamesIn(shippedFiles: ShippedFiles, folder: ShippedFile): Promise<readonly string[]> {
  return (await shippedFiles.list(folder))
    .filter((file) => file.endsWith(manifestSuffix))
    .map((file) => file.slice(0, -manifestSuffix.length))
    .toSorted();
}

export async function manifestIn(
  shippedFiles: ShippedFiles,
  folder: ShippedFile,
  name: string,
): Promise<DocumentManifest> {
  return decodeManifest(await shippedFiles.text(shippedFileIn(folder, `${name}${manifestSuffix}`)));
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

async function fetchedDocument(address: string, fetching: Fetching): Promise<unknown> {
  const answer = await fetching(address);
  if (!answer.ok) {
    throw new Error(`${address} answered ${String(answer.status)}, so nothing is translated from it`);
  }
  return Result.getOrThrowWith(
    documentInText(await answer.text()),
    (located) =>
      new Error(`${address} answered no document in JSON or YAML, so nothing is translated from it: ${located}`),
  );
}

function readingEachOnce(fetching: Fetching): Reading {
  const read = new Map<string, Promise<unknown>>();
  return (address) => {
    const reading = read.get(address) ?? fetchedDocument(address, fetching);
    read.set(address, reading);
    return reading;
  };
}

async function givenJson(path: string, { readGiven }: Translating): Promise<unknown> {
  const read: unknown = JSON.parse(await readGiven(path));
  return read;
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function discoveryTranslated(
  { name, given }: Asked,
  manifest: DiscoveryManifest,
  run: Run,
): Promise<readonly Written[]> {
  const { folder, reading } = run;
  const read = await (given === undefined ? reading(manifest.discovery) : givenJson(given, run));
  const metadata = await reading(manifest.authorization_server);
  const { document, revision } = translatedDiscoveryOf(read, metadata, manifest);
  const { type, discovery: address, authorization_server: authorizationServer, methods, cuts } = manifest;
  const remade = { type, discovery: address, revision, authorization_server: authorizationServer, methods };
  return [
    { file: shippedFileIn(folder, `${name}${documentSuffix}`), text: jsonText(document) },
    {
      file: shippedFileIn(folder, `${name}${manifestSuffix}`),
      text: jsonText(cuts === undefined ? remade : { ...remade, cuts }),
    },
  ];
}

function fetchedAt(
  { name, given }: Asked,
  addresses: readonly string[],
  { reading }: Run,
): Promise<readonly unknown[]> {
  if (given !== undefined) {
    throw new Error(
      `The manifest ${name} is of OpenAPI documents, which the command fetches at the addresses it names, so no file is given in place of one. ${usage}`,
    );
  }
  return Promise.all(addresses.map((address) => reading(address)));
}

async function openApiTranslated(asked: Asked, manifest: OpenApiManifest, run: Run): Promise<readonly Written[]> {
  const documents = await fetchedAt(asked, manifest.sources, run);
  const metadata = await run.reading(manifest.authorization_server);
  const document = curatedOpenApiOf(documents, manifest, metadata);
  return [{ file: shippedFileIn(run.folder, `${asked.name}${documentSuffix}`), text: jsonText(document) }];
}

async function swaggerConverted(asked: Asked, manifest: SwaggerManifest, run: Run): Promise<readonly Written[]> {
  const documents = await fetchedAt(
    asked,
    manifest.sources.map(({ address }) => address),
    run,
  );
  const metadata = await run.reading(manifest.authorization_server);
  const document = convertedDocumentOf(documents, manifest, metadata);
  return [{ file: shippedFileIn(run.folder, `${asked.name}${documentSuffix}`), text: jsonText(document) }];
}

async function translatedOne(asked: Asked, run: Run): Promise<readonly Written[]> {
  const manifest = await manifestIn(run.shippedFiles, run.folder, asked.name);
  if (manifest.type === 'discovery') {
    return discoveryTranslated(asked, manifest, run);
  }
  return manifest.type === 'openapi' ? openApiTranslated(asked, manifest, run) : swaggerConverted(asked, manifest, run);
}

export async function translatedDocuments(
  commandArguments: readonly string[],
  translating: Translating,
): Promise<readonly Written[]> {
  const names = await manifestNamesIn(translating.shippedFiles, translating.folder);
  const asked =
    commandArguments.length === 0
      ? names.map((name): Asked => ({ name, given: undefined }))
      : commandArguments.map((each) => askedOf(each, names));
  const run: Run = { ...translating, reading: readingEachOnce(translating.fetching) };
  const translated = await Promise.all(asked.map((each) => translatedOne(each, run)));
  return translated.flat();
}
