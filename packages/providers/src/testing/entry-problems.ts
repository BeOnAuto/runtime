import { shippedFileIn, shippedFileName, type ShippedFile } from '@on.auto/shipped-files';
import { shippedFilesInMemory } from '@on.auto/shipped-files/testing';
import { Result, Schema, SchemaIssue } from 'effect';

import { ProviderEntrySchema } from '../entry/provider-entry.ts';
import type { Provider } from '../reading/provider-list.ts';
import { readProviders } from '../reading/shipped-providers.ts';
import { tracker } from './fixture-providers.ts';

const decodeEntry = Schema.decodeUnknownResult(ProviderEntrySchema, { errors: 'all', onExcessProperty: 'error' });

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

export function problemsOf(entry: unknown): readonly (readonly [string, string])[] {
  return Result.match(decodeEntry(entry), {
    onSuccess: () => [],
    onFailure: ({ issue }: { readonly issue: SchemaIssue.Issue }) =>
      formatIssues(issue).issues.map(({ message, path = [] }) => [`/${path.map(String).join('/')}`, message] as const),
  });
}

const [aKey] = tracker.credentials;

export function keyProblemsOf(way: Readonly<Record<string, unknown>>) {
  return problemsOf({ ...tracker, credentials: [{ ...aKey, ...way }] });
}

export function refusedAt(way: Readonly<Record<string, unknown>>): readonly string[] {
  return keyProblemsOf(way).map(([path]) => path);
}

export function decodedEntry(entry: unknown) {
  return Schema.decodeUnknownSync(ProviderEntrySchema)(entry);
}

export interface EntryFolder {
  readonly read: () => Promise<string>;
  readonly icons: () => Promise<string>;
}

const entries: ShippedFile = { package: '@acme/shipped', path: 'entries' };

const folder = shippedFileName(entries);

type Content = string | Readonly<Uint8Array>;

function iconsOf({ entry, icons = [] }: Provider): string {
  const each = icons.map(
    ({ src, mimeType, theme = 'any' }) => `${mimeType} ${theme} ${src.slice(0, src.indexOf(','))}`,
  );
  return `${entry.name}: ${each.join(', ')}`;
}

export function entryFolderWith(files: Readonly<Record<string, Content>>): EntryFolder {
  const shipped = shippedFilesInMemory({
    [entries.package]: Object.fromEntries(
      Object.entries(files).map(([name, content]: readonly [string, Content]) => [
        shippedFileIn(entries, name).path,
        content,
      ]),
    ),
  });
  const readAs = async (said: (providers: readonly Provider[]) => string) =>
    Result.match(await readProviders(shipped, entries), {
      onSuccess: ({ providers }) => said(providers),
      onFailure: ({ message }: { readonly message: string }) => message.replaceAll(folder, '<entries>'),
    });
  return {
    read: () => readAs((providers) => providers.map(({ entry, address }) => `${entry.name} ${address}`).join('; ')),
    icons: () => readAs((providers) => providers.map((provider) => iconsOf(provider)).join('; ')),
  };
}
