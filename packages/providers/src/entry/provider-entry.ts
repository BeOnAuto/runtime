import { ServerEntrySchema, serverNameProblems } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { CredentialWaySchema } from './credential-ways.ts';
import { placementIssuesOf } from './entry-placeholders.ts';
import { localDocumentOf, writtenIssuesOf } from './entry-values.ts';
import { PlaceholdersSchema } from './placeholders.ts';

const { type, url, document, base_url, headers, query_params, request_id } = ServerEntrySchema.fields;

const mostDescriptionCharacters = 300;

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

const ProviderTypeSchema = type.schema.pick(['mcp', 'openapi']);

const placed = '{name} standing for the placeholder name';

const ofWhoeverRunsIt =
  'never a credential; a reference such as ${ADS_DEVELOPER_TOKEN} stands for a value of whoever runs the runtime';

const ProviderEntryFieldsSchema = Schema.Struct({
  name: Schema.String.annotate({
    description:
      'The name of the provider and of a connection to it by default: 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
  }),
  title: NamedSchema.annotate({ description: 'What a person reads as its name' }),
  description: NamedSchema.check(Schema.isMaxLength(mostDescriptionCharacters)).annotate({
    description: 'What a function may do through it, in one or two sentences of at most 300 characters',
  }),
  website: Schema.String.annotate({
    description: 'The https page where a person reads about the server and makes a credential',
  }),
  type: ProviderTypeSchema.annotate({ description: 'mcp for an MCP server, given url; openapi for an HTTP API' }),
  url: url.annotate({ description: `For mcp, the https URL of the server, ${placed}` }),
  document: document.annotate({ description: `For openapi, the https URL of its OpenAPI document, ${placed}` }),
  base_url: base_url.annotate({
    description: `For openapi, the https URL its calls go to where the document names no server, ${placed}`,
  }),
  headers: headers.annotate({ description: `Headers sent with every request, ${ofWhoeverRunsIt}` }),
  query_params: query_params.annotate({
    description: `For openapi, query parameters sent with every call, ${ofWhoeverRunsIt}`,
  }),
  request_id,
  placeholders: Schema.optionalKey(
    PlaceholdersSchema.annotate({
      description:
        'The values that differ from one connection to the next, by name: each a description with a pattern and an example, or with choices',
    }),
  ),
  credentials: Schema.Array(CredentialWaySchema).check(Schema.isMinLength(1)).annotate({
    description:
      'The ways a credential reaches the server, in the order a person is offered them, the first the default: secret, client_credentials or none; a way that asks a scope says, beside it, what a connection can do through each scope',
  }),
});

export const entryProse: readonly string[] = ['title', 'description', 'says'];

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

const documentByItsAddress =
  "Expected the https URL of the OpenAPI document, or an http URL on a loopback address: a provider whoever runs the runtime adds names its document by its address, since the documents beside the entries are the runtime's own";

export const AddedProviderEntrySchema = ProviderEntrySchema.check(
  Schema.makeFilter((entry: ProviderEntry) =>
    entry.document === localDocumentOf(entry.name) ? [{ path: ['document'], issue: documentByItsAddress }] : [],
  ),
);
