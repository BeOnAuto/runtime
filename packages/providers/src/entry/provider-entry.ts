import { failureCodeIssuesOf, markIssuesOf, ServerEntrySchema, serverNameProblems } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { EventsSchema } from '../events/event-destinations.ts';
import { eventIssuesOf } from '../events/event-entries.ts';
import { chatIssuesOf, ChatSchema } from './chat-parts.ts';
import { conversationIssuesOf, ConversationsSchema } from './conversation-parts.ts';
import { CredentialWaySchema, repeatedWayIssuesOf } from './credential-ways.ts';
import { EntryPlaceholdersSchema, placementIssuesOf } from './entry-placeholders.ts';
import { isADocumentBesideTheEntries, writtenIssuesOf } from './entry-values.ts';
import { aliasIssuesOf, AliasesSchema, ReplacesSchema, replacedIssuesOf } from './provider-names.ts';

const { type, url, document, base_url, headers, query_params, request_id, marks, failure_codes } =
  ServerEntrySchema.fields;

const mostDescriptionCharacters = 300;

const mostSummaryCharacters = 120;

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
  aliases: Schema.optionalKey(AliasesSchema),
  title: NamedSchema.annotate({ description: 'What a person reads as its name' }),
  description: NamedSchema.check(Schema.isMaxLength(mostDescriptionCharacters)).annotate({
    description: 'What a function may do through it, in one or two sentences of at most 300 characters',
  }),
  summary: Schema.optionalKey(
    NamedSchema.check(Schema.isMaxLength(mostSummaryCharacters)).annotate({
      description:
        'What playbooks can do through it, in one sentence of at most 120 characters, which a person reads under its title where they connect it; description stays what an agent reads',
    }),
  ),
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
  handles_money: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        'true for a provider whose tools pay, refund, transfer or pay out money, which the directory listing does not offer',
    }),
  ),
  marks: marks.annotate({
    description:
      'The mark of each tool named, for the tools the server marks wrongly or not at all: reads for a tool that only reads, acts for one that may change something, each named as the server lists it; for openapi, a tool of the document beside the entries',
  }),
  failure_codes: failure_codes.annotate({
    description:
      'For openapi, an API that answers a failure in a JSON answer of a successful status: the pointers to whether the call succeeded and to the code of its failure, and the codes that mean a refused credential, a lacking scope or a limited rate',
  }),
  conversations: Schema.optionalKey(ConversationsSchema),
  chat: Schema.optionalKey(ChatSchema),
  renders: Schema.optionalKey(
    NamedSchema.annotate({
      description:
        'The name of the render target a message sent through the provider can be written for, where it can be a card the run turns into the layout the provider shows',
    }),
  ),
  events: Schema.optionalKey(EventsSchema),
  placeholders: Schema.optionalKey(EntryPlaceholdersSchema),
  credentials: Schema.Array(CredentialWaySchema).check(Schema.isMinLength(1)).annotate({
    description:
      'The ways a credential reaches the server, in the order a person is offered them, at most one of each kind, secret, client_credentials, none, authorization, jwt_bearer or token_exchange, with each of application and delegated permissions, and for token_exchange one with managed_service_account and one without; a way that asks a scope says, beside it, what a connection can do through each scope, and an authorization way that asks a scope may name in more the groups of scopes a later consent may add to it',
  }),
  replaces: Schema.optionalKey(ReplacesSchema),
});

export const entryProse: readonly string[] = [
  'title',
  'description',
  'summary',
  'says',
  'for',
  'instructions',
  'key_page_title',
  'page_title',
  'client_id_title',
  'example',
  'limitation',
];

export type ProviderEntry = typeof ProviderEntryFieldsSchema.Type;

type EntryIssue = Schema.FilterIssue;

const fieldsOfEachType = {
  mcp: { required: 'url', foreign: ['document', 'base_url', 'query_params', 'failure_codes'] },
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

const ofAnMcpWay = {
  base_url:
    "Expected no base_url: an mcp provider's calls go to its url, and a way's base_url is where the calls of an openapi provider go",
  path_values:
    "Expected no path_values: an mcp provider has no document, and a way's path_values fill the paths of an openapi provider's document",
} as const;

const fieldsOfAnOpenApiWay = ['base_url', 'path_values'] as const;

function openApiWayIssuesOf({ type: typed, credentials }: ProviderEntry): readonly EntryIssue[] {
  return typed === 'mcp'
    ? credentials.flatMap((way, index) =>
        fieldsOfAnOpenApiWay
          .filter((field) => way[field] !== undefined)
          .map((field) => ({ path: ['credentials', index, field], issue: ofAnMcpWay[field] })),
      )
    : [];
}

function markedIssuesOf(entry: ProviderEntry): readonly EntryIssue[] {
  return markIssuesOf(entry.marks).map(({ path, detail }) => ({ path: ['marks', ...path], issue: detail }));
}

function codedIssuesOf(entry: ProviderEntry): readonly EntryIssue[] {
  return failureCodeIssuesOf(entry.failure_codes).map(({ path, detail }) => ({
    path: ['failure_codes', ...path],
    issue: detail,
  }));
}

function testIssuesOf({ credentials, marks: marked }: ProviderEntry): readonly EntryIssue[] {
  const acting = marked?.acts ?? [];
  return credentials.flatMap(({ test }, index): readonly EntryIssue[] =>
    test === undefined || !acting.includes(test.tool)
      ? []
      : [
          {
            path: ['credentials', index, 'test', 'tool'],
            issue: `Expected a tool that only reads, since the runtime calls it to check a connection before it keeps it, and the entry marks ${test.tool} acts`,
          },
        ],
  );
}

function entryIssuesOf(entry: ProviderEntry): readonly EntryIssue[] {
  return [
    ...nameIssuesOf(entry),
    ...aliasIssuesOf(entry),
    ...websiteIssuesOf(entry),
    ...typeIssuesOf(entry),
    ...openApiWayIssuesOf(entry),
    ...repeatedWayIssuesOf(entry.credentials),
    ...testIssuesOf(entry),
    ...markedIssuesOf(entry),
    ...codedIssuesOf(entry),
    ...conversationIssuesOf(entry.conversations, entry.failure_codes),
    ...chatIssuesOf(entry.chat, entry.events),
    ...eventIssuesOf(entry),
    ...placementIssuesOf(entry),
    ...writtenIssuesOf(entry),
    ...replacedIssuesOf(entry),
  ];
}

export const ProviderEntrySchema = ProviderEntryFieldsSchema.check(Schema.makeFilter(entryIssuesOf));

export const providerEntryFields = ProviderEntryFieldsSchema.fields;

export const providerEntryIssues = Schema.makeFilter(entryIssuesOf);

const documentByItsAddress =
  "Expected the https URL of the OpenAPI document, or an http URL on a loopback address: a provider whoever runs the runtime adds names its document by its address, since the documents beside the entries are the runtime's own";

const gatewayOfAnAddedProvider =
  'Expected no gateway: only an entry the runtime ships names one, since the document beside it says the header its key is sent in, and a provider whoever runs the runtime adds names its document by its address';

const replyOfAnAddedProvider =
  'Expected no reply: only an entry the runtime ships declares one, since a reply a delivery carries can answer a request, and a provider whoever runs the runtime adds only makes Auto read';

const clickOfAnAddedProvider =
  'Expected no click: only an entry the runtime ships declares one, since a click a delivery carries can answer a request, and a provider whoever runs the runtime adds only makes Auto read';

function eventsOfAnAddedProvider(field: string): string {
  return `Expected no ${field}: only a provider that ships with the runtime can declare the events its service reports, because an event would start workflows with what its delivery carries. A provider added in the configuration file can only tell Auto to read the replies now`;
}

const chatOfAnAddedProvider =
  'Expected no chat: only a provider that ships with the runtime can declare a chat, because what a person writes there would have Auto act through the connection. A provider added in the configuration file can only tell Auto to read the replies now';

function chatsOfAnAddedProvider({ chat, events }: ProviderEntry): readonly EntryIssue[] {
  return [
    ...(chat === undefined ? [] : [{ path: ['chat'], issue: chatOfAnAddedProvider }]),
    ...(events?.destinations ?? []).flatMap((destination, index) =>
      destination.chat === undefined
        ? []
        : [{ path: ['events', 'destinations', index, 'chat'], issue: chatOfAnAddedProvider }],
    ),
  ];
}

function addedIssuesOf(entry: ProviderEntry): readonly EntryIssue[] {
  const { document: written, credentials, events } = entry;
  return [
    ...(isADocumentBesideTheEntries(written) ? [{ path: ['document'], issue: documentByItsAddress }] : []),
    ...credentials.flatMap(({ gateway }, index) =>
      gateway === undefined ? [] : [{ path: ['credentials', index, 'gateway'], issue: gatewayOfAnAddedProvider }],
    ),
    ...(events?.destinations ?? []).flatMap(({ filter }, index) =>
      filter?.reply === undefined
        ? []
        : [{ path: ['events', 'destinations', index, 'filter', 'reply'], issue: replyOfAnAddedProvider }],
    ),
    ...(events?.destinations ?? []).flatMap(({ filter }, index) =>
      filter?.click === undefined
        ? []
        : [{ path: ['events', 'destinations', index, 'filter', 'click'], issue: clickOfAnAddedProvider }],
    ),
    ...(events?.types === undefined ? [] : [{ path: ['events', 'types'], issue: eventsOfAnAddedProvider('types') }]),
    ...(events?.destinations ?? []).flatMap((destination, index) =>
      destination.events === undefined
        ? []
        : [{ path: ['events', 'destinations', index, 'events'], issue: eventsOfAnAddedProvider('events') }],
    ),
    ...chatsOfAnAddedProvider(entry),
  ];
}

export const AddedProviderEntrySchema = ProviderEntrySchema.check(Schema.makeFilter(addedIssuesOf));
