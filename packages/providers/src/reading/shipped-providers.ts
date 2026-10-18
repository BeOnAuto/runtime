import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { isPinnableUrl } from '@on.auto/tool-servers';
import { Data, Option, Result, Schema, SchemaIssue, type StandardSchema } from 'effect';

import { ProviderEntrySchema, type ProviderEntry } from '../entry/provider-entry.ts';
import { isAddress } from '../entry/templates.ts';
import { addressOf, type Provider, type ProviderList } from './provider-list.ts';

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

function parsedDocument(path: string): unknown {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed;
  } catch {
    return undefined;
  }
}

interface DocumentServer {
  readonly server?: string;
}

function isServerWrittenOut(url: string): boolean {
  return isPinnableUrl(url) && placeholdersIn(url).length === 0;
}

function serverOfTheDocument(entry: ProviderEntry, folder: string): Read<DocumentServer> {
  const written = entry.document;
  if (written === undefined || isAddress(written)) {
    return Result.succeed({});
  }
  const servers = Result.getOrUndefined(decodeServers(parsedDocument(join(folder, written))));
  if (servers === undefined) {
    return documentProblem(`Expected ${written} beside the entries, an OpenAPI document in JSON`);
  }
  if (entry.base_url !== undefined) {
    return Result.succeed({});
  }
  const [first] = servers.servers ?? [];
  if (first === undefined) {
    return documentProblem('The document names no server, so the entry gives base_url');
  }
  return isServerWrittenOut(first.url)
    ? Result.succeed({ server: withoutTrailingSlashes(first.url) })
    : documentProblem(
        'The first server the document names is no https URL, or http URL on a loopback address, without a variable, so the entry gives base_url',
      );
}

function providerOf(entry: ProviderEntry, file: string, folder: string): Read<Provider> {
  const named = `${entry.name}.yaml`;
  if (file !== named) {
    return Result.fail([{ pointer: '/name', detail: `Expected the name the file is named for, as in ${named}` }]);
  }
  return Result.map(serverOfTheDocument(entry, folder), ({ server }) => ({ entry, address: addressOf(entry, server) }));
}

function readProvider(folder: string, file: string): Result.Result<Provider, readonly Located[]> {
  const path = join(folder, file);
  const reading = readYaml(readFileSync(path, 'utf8'), entryYaml);
  if ('problems' in reading) {
    return Result.fail(
      reading.problems.map(({ position, detail }) => ({ place: placeIn(path, position, ''), detail })),
    );
  }
  const { document } = reading;
  const read = Result.flatMap(Result.mapError(decodeEntry(document.value), problemsOf), (entry) =>
    providerOf(entry, file, folder),
  );
  const located = ({ pointer, detail }: Problem): Located => {
    const position: Position = document.locate(pointer);
    return { place: placeIn(path, position, pointer), detail };
  };
  return Result.mapError(read, (problems) => problems.map((problem) => located(problem)));
}

function byName({ entry: { name } }: Provider, { entry: { name: other } }: Provider): number {
  return Number(name > other) - Number(name < other);
}

function invalid(located: readonly Located[]): ProvidersInvalid {
  const listed = located.map(({ place, detail }) => `${place}: ${detail}`).join('; ');
  return new ProvidersInvalid({ message: `The entries of the providers are invalid: ${listed}` });
}

export function readProviders(entries: Readonly<URL> = shippedEntries): Result.Result<ProviderList, ProvidersInvalid> {
  const folder = fileURLToPath(entries);
  const files = readdirSync(folder)
    .filter((file) => file.endsWith('.yaml'))
    .toSorted();
  const read = files.map((file) => readProvider(folder, file));
  const located: Located[] = [];
  for (const each of read) {
    located.push(...Result.getFailure(each).pipe(Option.getOrElse((): readonly Located[] => [])));
  }
  return Result.match(Result.all(read), {
    onFailure: () => Result.fail(invalid(located)),
    onSuccess: (providers: readonly Provider[]) =>
      Result.succeed({ providers: providers.toSorted((one, other) => byName(one, other)), documents: folder }),
  });
}
