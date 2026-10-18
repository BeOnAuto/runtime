import { ServerEntrySchema, serverNameProblems } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { CredentialWaySchema } from './credential-ways.ts';
import { placementIssuesOf } from './entry-placeholders.ts';
import { writtenIssuesOf } from './entry-values.ts';
import { PlaceholdersSchema } from './placeholders.ts';

const { type, url, document, base_url, headers, query_params, request_id } = ServerEntrySchema.fields;

const mostDescriptionCharacters = 300;

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

const ProviderTypeSchema = type.schema.pick(['mcp', 'openapi']);

const ProviderEntryFieldsSchema = Schema.Struct({
  name: Schema.String,
  title: NamedSchema,
  description: NamedSchema.check(Schema.isMaxLength(mostDescriptionCharacters)),
  website: Schema.String,
  type: ProviderTypeSchema,
  url,
  document,
  base_url,
  headers,
  query_params,
  request_id,
  placeholders: Schema.optionalKey(PlaceholdersSchema),
  credentials: Schema.Array(CredentialWaySchema).check(Schema.isMinLength(1)),
});

export type ProviderEntry = typeof ProviderEntryFieldsSchema.Type;

type EntryIssue = Schema.FilterIssue;

const fieldsOfEachType = {
  mcp: { required: 'url', foreign: ['document', 'base_url', 'query_params'] },
  openapi: { required: 'document', foreign: ['url'] },
} as const;

function nameIssuesOf({ name }: ProviderEntry): readonly EntryIssue[] {
  return serverNameProblems(name, []).map(({ detail }) => ({ path: ['name'], issue: detail }));
}

function websiteIssuesOf({ website }: ProviderEntry): readonly EntryIssue[] {
  return URL.parse(website)?.protocol === 'https:'
    ? []
    : [{ path: ['website'], issue: 'Expected the https URL of the page a person reads about the server' }];
}

function typeIssuesOf(entry: ProviderEntry): readonly EntryIssue[] {
  const { required, foreign } = fieldsOfEachType[entry.type];
  return [
    ...(entry[required] === undefined
      ? [{ path: [required], issue: `Expected ${required}, which an ${entry.type} provider takes` }]
      : []),
    ...foreign
      .filter((field) => entry[field] !== undefined)
      .map((field) => ({ path: [field], issue: `Expected no ${field}: an ${entry.type} provider takes ${required}` })),
  ];
}

function wayIssuesOf({ credentials }: ProviderEntry): readonly EntryIssue[] {
  const kinds = credentials.map(({ kind }) => kind);
  return kinds.flatMap((kind, index): readonly EntryIssue[] =>
    kinds.indexOf(kind) === index
      ? []
      : [{ path: ['credentials', index, 'kind'], issue: 'Expected a kind no other way has' }],
  );
}

export const ProviderEntrySchema = ProviderEntryFieldsSchema.check(
  Schema.makeFilter((entry: ProviderEntry) => [
    ...nameIssuesOf(entry),
    ...websiteIssuesOf(entry),
    ...typeIssuesOf(entry),
    ...wayIssuesOf(entry),
    ...placementIssuesOf(entry),
    ...writtenIssuesOf(entry),
  ]),
);
