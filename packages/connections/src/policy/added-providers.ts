import { AddedProviderEntrySchema, type ProviderEntry } from '@on.auto/providers';
import { Schema } from 'effect';

import { credentialIssuesOf } from '../entries/credential-checks.ts';

type EntryIssue = Schema.FilterIssue;

const repeatedName = 'Expected a name no other provider of the setting has';

function nameIssuesOf(entries: readonly ProviderEntry[]): readonly EntryIssue[] {
  const names = entries.map(({ name }) => name);
  return names.flatMap((name, index): readonly EntryIssue[] =>
    names.indexOf(name) === index ? [] : [{ path: [index, 'name'], issue: repeatedName }],
  );
}

function wayIssuesOf(entry: ProviderEntry, index: number): readonly EntryIssue[] {
  return entry.credentials.flatMap((way, at) =>
    credentialIssuesOf(way, entry.type, entry).map(({ pointer, detail }) => ({
      path: [index, 'credentials', at, ...pointer.split('/').slice(2)],
      issue: detail,
    })),
  );
}

export const AddedProvidersSchema = Schema.Array(AddedProviderEntrySchema)
  .check(
    Schema.makeFilter((entries: readonly ProviderEntry[]) => [
      ...nameIssuesOf(entries),
      ...entries.flatMap((entry, index) => wayIssuesOf(entry, index)),
    ]),
  )
  .annotate({
    description:
      'Providers of your own, which a person connects as they connect those the runtime ships, each an entry of a provider; one named as a provider the runtime ships takes its place. None when left out',
  });

export type AddedProviders = typeof AddedProvidersSchema.Type;
