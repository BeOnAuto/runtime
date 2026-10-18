import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Result, Schema, SchemaIssue } from 'effect';
import { onTestFinished } from 'vitest';

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
  readonly folder: string;
  readonly read: () => string;
}

export function entryFolderWith(files: Readonly<Record<string, string>>): EntryFolder {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-providers-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  mkdirSync(join(folder, 'documents'));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(folder, name), text);
  }
  return {
    folder,
    read: () =>
      Result.match(readProviders(pathToFileURL(`${folder}/`)), {
        onSuccess: ({ providers }) => providers.map(({ entry, address }) => `${entry.name} ${address}`).join('; '),
        onFailure: ({ message }: { readonly message: string }) => message.replaceAll(folder, '<entries>'),
      }),
  };
}
