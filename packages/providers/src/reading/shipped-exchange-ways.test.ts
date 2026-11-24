import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Option, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { readProviders, type CredentialWay, type Provider, providersShippedRoots } from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

/**
 * The code that reads a provider's ways and serves a connection made by one: this package and the tool servers it
 * hands a way to. Both are inputs of this package's tests, so a change to either runs these cases again.
 */
const codeOfTheWays = [
  ['providers', fileURLToPath(new URL('../', import.meta.url))],
  ['tool-servers', fileURLToPath(new URL('../../../tool-servers/src/', import.meta.url))],
] as const;

interface CodeFile {
  readonly path: string;
  readonly text: string;
}

function isCode(path: string): boolean {
  const folders = path.split(/[\\/]/u).slice(0, -1);
  return path.endsWith('.ts') && !path.endsWith('.test.ts') && !folders.some((folder) => folder.endsWith('testing'));
}

function codeIn(owner: string, root: string): readonly CodeFile[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((path) => isCode(path))
    .map((path) => ({ path: `${owner}/${path.replaceAll('\\', '/')}`, text: readFileSync(join(root, path), 'utf8') }));
}

const code = codeOfTheWays.flatMap(([owner, root]: readonly [string, string]) => codeIn(owner, root));

function quotedIn(text: string, named: string): boolean {
  return ["'", '"', '`'].some((quote) => text.includes(`${quote}${named}${quote}`));
}

function namingOf(name: string, title: string): readonly string[] {
  return code
    .filter(({ text }: CodeFile) => quotedIn(text, name) || quotedIn(text, title))
    .map(({ path }: CodeFile) => path);
}

describe('the code that reads and serves the ways of the shipped providers', () => {
  it('is read from the format of an entry and from the exchange of a token', () => {
    expect(code.map(({ path }: CodeFile) => path)).toEqual(
      expect.arrayContaining(['providers/entry/exchange-ways.ts', 'tool-servers/exchange/exchanged-tokens.ts']),
    );
  });

  it.each(shipped.providers.map(({ entry }) => [entry.name, entry.title]))(
    'names %s neither by its name nor by its title, %s, so the ways its entry declares are all it takes',
    (name, title) => {
      expect(namingOf(name, title)).toEqual([]);
    },
  );
});

const OperationSchema = Schema.Struct({
  operationId: Schema.optionalKey(Schema.String),
  parameters: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.optionalKey(Schema.String) }))),
});

const decodeOperation = Schema.decodeUnknownOption(OperationSchema);

const decodePaths = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ paths: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)) }),
  ),
);

const readingMethods: ReadonlySet<string> = new Set(['get', 'head']);

interface DocumentedTool {
  readonly method: string;
  readonly parameters: readonly string[];
}

function documentedOf(method: string, operation: unknown): readonly (readonly [string, DocumentedTool])[] {
  return Option.match(decodeOperation(operation), {
    onNone: () => [],
    onSome: ({ operationId, parameters = [] }) =>
      operationId === undefined
        ? []
        : [[operationId, { method, parameters: parameters.flatMap(({ name }) => name ?? []) }]],
  });
}

function toolsOfTheDocumentOf({ entry }: Provider): ReadonlyMap<string, DocumentedTool> {
  const document = entry.document === undefined ? undefined : shipped.documents.get(entry.document);
  const paths = document === undefined ? {} : decodePaths(document.text).paths;
  return new Map(
    Object.values(paths).flatMap((item) =>
      Object.entries(item).flatMap(([method, operation]: readonly [string, unknown]) =>
        documentedOf(method, operation),
      ),
    ),
  );
}

function markOf({ entry }: Provider, tool: string, documented: DocumentedTool | undefined): string {
  if (entry.marks?.acts?.includes(tool) === true) return 'acts';
  if (entry.marks?.reads?.includes(tool) === true) return 'reads';
  if (documented === undefined) return 'absent';
  return readingMethods.has(documented.method) ? 'reads' : 'acts';
}

function checkOf(provider: Provider, { test }: CredentialWay): readonly unknown[] {
  if (test === undefined) return [];
  const documented = toolsOfTheDocumentOf(provider).get(test.tool);
  const taken = new Set(documented?.parameters ?? []);
  return [
    test.tool,
    markOf(provider, test.tool, documented),
    Object.keys(test.with ?? {}).filter((name) => !taken.has(name)),
  ];
}

function exchangeWaysOf(provider: Provider): readonly (readonly unknown[])[] {
  return provider.entry.credentials
    .filter(({ kind }) => kind === 'token_exchange')
    .map((way) => [
      provider.entry.name,
      way.managed_service_account === true,
      way.read_only === true,
      checkOf(provider, way),
    ]);
}

const accountSummaries = ['analyticsadmin.accountSummaries.list', 'reads', []];

const profiles = ['dfareporting.userProfiles.list', 'reads', []];

const files = ['drive.files.list', 'reads', []];

const sites = ['webmasters.sites.list', 'reads', []];

const exchangeWaysOfTheShipped = [
  ['campaign-manager-360', true, false, profiles],
  ['campaign-manager-360', false, false, profiles],
  ['display-video-360', true, false, []],
  ['display-video-360', false, false, []],
  ['display-video-360-reports', true, false, []],
  ['display-video-360-reports', false, false, []],
  ['google-ads', true, true, []],
  ['google-ads', false, false, []],
  ['google-analytics', true, false, []],
  ['google-analytics', false, false, []],
  ['google-analytics-admin', true, false, accountSummaries],
  ['google-analytics-admin', false, false, accountSummaries],
  ['google-docs', true, false, []],
  ['google-docs', false, false, []],
  ['google-drive', true, false, files],
  ['google-drive', false, false, files],
  ['google-search-console', true, false, sites],
  ['google-search-console', false, false, sites],
  ['google-sheets', true, false, []],
  ['google-sheets', false, false, []],
  ['google-slides', true, false, []],
  ['google-slides', false, false, []],
  ['search-ads-360', true, false, []],
  ['search-ads-360', false, false, []],
];

describe('the ways of the shipped providers that exchange a token Auto signs', () => {
  it('are a managed and an own service account of each app that takes one, each checked where the app lists what it reaches, by a tool of its document that reads, with arguments the tool takes', () => {
    expect(shipped.providers.flatMap((provider) => exchangeWaysOf(provider))).toEqual(exchangeWaysOfTheShipped);
  });
});
