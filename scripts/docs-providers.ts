import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  hostAlternativesOf,
  providersShippedRoots,
  readProviders,
  scopesIn,
  type CredentialWay,
  type Placeholder,
  type Provider,
  type ProviderList,
  type ScopeGroup,
} from '@on.auto/providers';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Option, Result, Schema } from 'effect';

const OperationSchema = Schema.optionalKey(Schema.Struct({ operationId: Schema.String }));

const PathItemSchema = Schema.Struct({
  get: OperationSchema,
  put: OperationSchema,
  post: OperationSchema,
  delete: OperationSchema,
  options: OperationSchema,
  head: OperationSchema,
  patch: OperationSchema,
  trace: OperationSchema,
});

type Method = keyof typeof PathItemSchema.fields;

const methodsInTheRuntimesOrder: readonly Method[] = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];

const readingMethods: ReadonlySet<Method> = new Set(['get', 'head']);

const decodePaths = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ paths: Schema.Record(Schema.String, PathItemSchema) })),
);

type Mark = 'reads' | 'acts';

interface PublishedTool {
  readonly name: string;
  readonly mark: Mark;
}

interface PublishedScope {
  readonly scope: string;
  readonly says: string;
}

function described({ description }: Pick<CredentialWay, 'description'>): { readonly description?: string } {
  return description === undefined ? {} : { description };
}

function required(value: string | undefined): string {
  return Option.getOrThrow(Option.fromNullishOr(value));
}

function scopesOf({ scope, says = {} }: Pick<CredentialWay, 'scope' | 'says'>): readonly PublishedScope[] {
  return scopesIn(scope).flatMap((name) => {
    const words = says[name];
    return words === undefined ? [] : [{ scope: name, says: words }];
  });
}

function groupOf(group: ScopeGroup) {
  return { name: group.name, for: group.for, scopes: scopesOf(group) };
}

function wayOf(way: CredentialWay) {
  const named = { kind: way.kind, ...described(way) };
  if (way.kind === 'authorization') {
    return {
      ...named,
      scopes: scopesOf(way),
      more: (way.more ?? []).map((group) => groupOf(group)),
      own_client: way.oauth_client === 'required',
    };
  }
  if (way.kind === 'client_credentials') {
    return { ...named, scopes: scopesOf(way) };
  }
  if (way.kind === 'secret') {
    return { ...named, key_page: required(way.key_page), instructions: required(way.instructions) };
  }
  return named;
}

function placeholderOf(name: string, placeholder: Placeholder) {
  return {
    name,
    description: placeholder.description,
    required: placeholder.required !== false,
    ...(placeholder.choices === undefined
      ? {}
      : { choices: placeholder.choices.map(({ value, title }) => ({ value, title })) }),
  };
}

function hostsOf(provider: Provider): readonly string[] {
  const hosts = provider.entry.credentials.flatMap((way) =>
    hostAlternativesOf(provider, way).flatMap(([address]) => (address === undefined ? [] : [address])),
  );
  return [...new Set(hosts)];
}

function markOf({ entry }: Provider, method: Method, name: string): Mark {
  if (entry.marks?.reads?.includes(name) === true) {
    return 'reads';
  }
  if (entry.marks?.acts?.includes(name) === true) {
    return 'acts';
  }
  return readingMethods.has(method) ? 'reads' : 'acts';
}

function toolsOf(provider: Provider, { documents }: ProviderList): { readonly tools?: readonly PublishedTool[] } {
  const document = provider.entry.document === undefined ? undefined : documents.get(provider.entry.document);
  if (document === undefined) {
    return {};
  }
  const { paths } = decodePaths(document.text);
  const tools = Object.values(paths).flatMap((item) =>
    methodsInTheRuntimesOrder.flatMap((method) => {
      const operation = item[method];
      return operation === undefined
        ? []
        : [{ name: operation.operationId, mark: markOf(provider, method, operation.operationId) }];
    }),
  );
  return { tools };
}

function publishedOf(provider: Provider, list: ProviderList) {
  const { entry } = provider;
  return {
    name: entry.name,
    title: entry.title,
    description: entry.description,
    website: entry.website,
    server: { type: entry.type, hosts: hostsOf(provider) },
    ways: entry.credentials.map((way) => wayOf(way)),
    placeholders: Object.entries(entry.placeholders ?? {}).map(([name, placeholder]: readonly [string, Placeholder]) =>
      placeholderOf(name, placeholder),
    ),
    ...toolsOf(provider, list),
    handles_money: entry.handles_money === true,
  };
}

export function providersDocumentOf(list: ProviderList): string {
  return `${JSON.stringify(
    {
      schema: 1,
      source: '@on.auto/providers',
      providers: list.providers.map((provider) => publishedOf(provider, list)),
    },
    null,
    2,
  )}\n`;
}

export const shippedProviders = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

export const providersDocument = providersDocumentOf(shippedProviders);

export function writeProviders(path: string): 'updated' | 'unchanged' {
  if (existsSync(path) && readFileSync(path, 'utf8') === providersDocument) return 'unchanged';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, providersDocument);
  return 'updated';
}

export function checkProviders(path: string): void {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== providersDocument) {
    throw new Error(`The providers asset is missing or stale at ${path}. Run pnpm docs:providers.`);
  }
}

export function runProviders(commandArguments: readonly string[], path: string): void {
  if (commandArguments.length === 0) {
    writeProviders(path);
  } else if (commandArguments.length === 1 && commandArguments[0] === '--check') {
    checkProviders(path);
  } else {
    throw new Error('Usage: pnpm docs:providers [--check]');
  }
}

if (import.meta.main) {
  runProviders(process.argv.slice(2), resolve(import.meta.dirname, '../docs/assets/providers.json'));
}
