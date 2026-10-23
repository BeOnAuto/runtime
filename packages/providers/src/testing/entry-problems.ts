import { shippedFileIn, shippedFileName, type ShippedFile } from '@on.auto/operations';
import { shippedFilesInMemory } from '@on.auto/operations/testing';
import { Result, Schema, SchemaIssue } from 'effect';

import { ProviderEntrySchema } from '../entry/provider-entry.ts';
import { readProviders } from '../reading/shipped-providers.ts';

const decodeEntry = Schema.decodeUnknownResult(ProviderEntrySchema, { errors: 'all', onExcessProperty: 'error' });

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

export function problemsOf(entry: unknown): readonly (readonly [string, string])[] {
  return Result.match(decodeEntry(entry), {
    onSuccess: () => [],
    onFailure: ({ issue }: { readonly issue: SchemaIssue.Issue }) =>
      formatIssues(issue).issues.map(({ message, path = [] }) => [`/${path.map(String).join('/')}`, message] as const),
  });
}

export function decodedEntry(entry: unknown) {
  return Schema.decodeUnknownSync(ProviderEntrySchema)(entry);
}

export interface EntryFolder {
  readonly read: () => Promise<string>;
}

const entries: ShippedFile = { package: '@acme/shipped', path: 'entries' };

const folder = shippedFileName(entries);

export function entryFolderWith(files: Readonly<Record<string, string>>): EntryFolder {
  const shipped = shippedFilesInMemory({
    [entries.package]: Object.fromEntries(
      Object.entries(files).map(([name, text]: readonly [string, string]) => [shippedFileIn(entries, name).path, text]),
    ),
  });
  return {
    read: async () =>
      Result.match(await readProviders(shipped, entries), {
        onSuccess: ({ providers }) => providers.map(({ entry, address }) => `${entry.name} ${address}`).join('; '),
        onFailure: ({ message }: { readonly message: string }) => message.replaceAll(folder, '<entries>'),
      }),
  };
}
