import { fileURLToPath } from 'node:url';

import {
  placeholdersIn,
  placeIn,
  pointerOf,
  readYaml,
  withoutTrailingSlashes,
  type Position,
  type YamlKind,
} from '@on.auto/config';
import type { ShippedFiles } from '@on.auto/operations';
import { isPinnableUrl, shippedDocumentOf, type ShippedDocument } from '@on.auto/tool-servers';
import { Data, Option, Result, Schema, SchemaIssue, type StandardSchema } from 'effect';

import { ProviderEntrySchema, type ProviderEntry } from '../entry/provider-entry.ts';
import { isAddress } from '../entry/templates.ts';
import { addressOf, byName, type Provider, type ProviderList } from './provider-list.ts';

export class ProvidersInvalid extends Data.TaggedError('providers_invalid')<{ readonly message: string }> {}

interface Problem {
  readonly pointer: string;
  readonly detail: string;
}

interface Located {
  readonly place: string;
  readonly detail: string;
}

type Read<A> = Result.Result<A, readonly Problem[]>;

interface Entries {
  readonly shippedFiles: ShippedFiles;
  readonly folder: Readonly<URL>;
}

type PathSegment = PropertyKey | StandardSchema.StandardSchemaV1.PathSegment;

const shippedEntries = new URL('../entries/', import.meta.url);

const entryYaml: YamlKind = {
  noun: "a provider's entry",
  mapping: "A provider's entry is a mapping of its fields",
  mostDepth: 16,
  emptyIsMapping: false,
};

const decodeEntry = Schema.decodeUnknownResult(ProviderEntrySchema, { errors: 'all', onExcessProperty: 'error' });

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

const DocumentServersSchema = Schema.Struct({
  servers: Schema.optionalKey(Schema.Array(Schema.Struct({ url: Schema.String }))),
});

type DocumentServers = typeof DocumentServersSchema.Type;

const decodeServers = Schema.decodeUnknownResult(DocumentServersSchema);

function isPropertyKey(segment: PathSegment): segment is PropertyKey {
  return typeof segment !== 'object';
}

function problemsOf({ issue }: { readonly issue: SchemaIssue.Issue }): readonly Problem[] {
  return formatIssues(issue).issues.map(({ message, path = [] }) => ({
    pointer: pointerOf(path.filter((segment) => isPropertyKey(segment))),
    detail: message,
  }));
}

function documentProblem(detail: string): Read<never> {
  return Result.fail([{ pointer: '/document', detail }]);
}

interface DocumentBesideTheEntries {
  readonly shipped: ShippedDocument;
  readonly servers: DocumentServers;
}

async function documentBesideTheEntries(
  { shippedFiles, folder }: Entries,
  written: string,
): Promise<DocumentBesideTheEntries | undefined> {
  try {
    const shipped = shippedDocumentOf(await shippedFiles.bytes(new URL(written, folder)));
    const parsed: unknown = JSON.parse(shipped.text);
    return Result.getOrUndefined(Result.map(decodeServers(parsed), (servers) => ({ shipped, servers })));
  } catch {
    return undefined;
  }
}

type Shipped = readonly [written: string, document: ShippedDocument];

interface DocumentRead {
  readonly server?: string;
  readonly shipped?: Shipped;
}

interface ProviderRead {
  readonly provider: Provider;
  readonly shipped?: Shipped;
}

function isServerWrittenOut(url: string): boolean {
  return isPinnableUrl(url) && placeholdersIn(url).length === 0;
}

async function documentOfTheEntry(entry: ProviderEntry, entries: Entries): Promise<Read<DocumentRead>> {
  const written = entry.document;
  if (written === undefined || isAddress(written)) {
    return Result.succeed({});
  }
  const document = await documentBesideTheEntries(entries, written);
  if (document === undefined) {
    return documentProblem(`Expected ${written} beside the entries, an OpenAPI document in JSON`);
  }
  const shipped: Shipped = [written, document.shipped];
  if (entry.base_url !== undefined) {
    return Result.succeed({ shipped });
  }
  const [first] = document.servers.servers ?? [];
  if (first === undefined) {
    return documentProblem('The document names no server, so the entry gives base_url');
  }
  return isServerWrittenOut(first.url)
    ? Result.succeed({ server: withoutTrailingSlashes(first.url), shipped })
    : documentProblem(
        'The first server the document names is no https URL, or http URL on a loopback address, without a variable, so the entry gives base_url',
      );
}

async function providerOf(entry: ProviderEntry, file: string, entries: Entries): Promise<Read<ProviderRead>> {
  const named = `${entry.name}.yaml`;
  if (file !== named) {
    return Result.fail([{ pointer: '/name', detail: `Expected the name the file is named for, as in ${named}` }]);
  }
  return Result.map(await documentOfTheEntry(entry, entries), ({ server, shipped }): ProviderRead => ({
    provider: { entry, address: addressOf(entry, server) },
    ...(shipped === undefined ? {} : { shipped }),
  }));
}

async function readProvider(entries: Entries, file: string): Promise<Result.Result<ProviderRead, readonly Located[]>> {
  const at = new URL(file, entries.folder);
  const path = fileURLToPath(at.href);
  const reading = readYaml(await entries.shippedFiles.text(at), entryYaml);
  if ('problems' in reading) {
    return Result.fail(
      reading.problems.map(({ position, detail }) => ({ place: placeIn(path, position, ''), detail })),
    );
  }
  const { document } = reading;
  const read = await Result.match(Result.mapError(decodeEntry(document.value), problemsOf), {
    onFailure: (problems): Promise<Read<ProviderRead>> => Promise.resolve(Result.fail(problems)),
    onSuccess: (entry) => providerOf(entry, file, entries),
  });
  const located = ({ pointer, detail }: Problem): Located => {
    const position: Position = document.locate(pointer);
    return { place: placeIn(path, position, pointer), detail };
  };
  return Result.mapError(read, (problems) => problems.map((problem) => located(problem)));
}

function invalid(located: readonly Located[]): ProvidersInvalid {
  const listed = located.map(({ place, detail }) => `${place}: ${detail}`).join('; ');
  return new ProvidersInvalid({ message: `The entries of the providers are invalid: ${listed}` });
}

export async function readProviders(
  shippedFiles: ShippedFiles,
  folder: Readonly<URL> = shippedEntries,
): Promise<Result.Result<ProviderList, ProvidersInvalid>> {
  const entries: Entries = { shippedFiles, folder };
  const files = (await shippedFiles.list(folder)).filter((file) => file.endsWith('.yaml'));
  const read = await Promise.all(files.map((file) => readProvider(entries, file)));
  const located: Located[] = [];
  for (const each of read) {
    located.push(...Result.getFailure(each).pipe(Option.getOrElse((): readonly Located[] => [])));
  }
  return Result.match(Result.all(read), {
    onFailure: () => Result.fail(invalid(located)),
    onSuccess: (providers: readonly ProviderRead[]) =>
      Result.succeed({
        providers: providers.map(({ provider }) => provider).toSorted(byName),
        documents: new Map(providers.flatMap(({ shipped }) => (shipped === undefined ? [] : [shipped]))),
      }),
  });
}
