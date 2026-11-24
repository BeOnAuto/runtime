import { PlaybookIdSchema } from '@on.auto/operations';
import { keyFieldNames, rendersOf, type ProviderList } from '@on.auto/providers';
import { ClientSourceSchema, givenByTheProvider, rendersDescription } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { AddedEntrySchema, documentIssuesOf } from '../entries/document-fields.ts';
import { AddedEventsSchema, eventsOfAProvider, unallowedToolsIn } from '../entries/events-fields.ts';
import { ConnectionTypeSchema } from '../registry/connection-entry.ts';
import { ConnectionSchema } from '../registry/connection.ts';
import {
  AddedCredentialSchema,
  handCredentialIssuesOf,
  providerCredentialIssuesOf,
} from './added-credential-fields.ts';
import { MessageField } from './request-fields.ts';

export const ClientSourceField = ClientSourceSchema;

export const RendersField = Schema.optionalKey(Schema.String.annotate({ description: rendersDescription }));

export function rendersFieldOf(providers: ProviderList, provider: string | null): { readonly renders?: string } {
  const renders = rendersOf(providers, provider);
  return renders === undefined ? {} : { renders };
}

export const AddedSchema = Schema.Struct({
  ...ConnectionSchema.fields,
  renders: RendersField,
  connect: Schema.optionalKey(
    Schema.Struct({
      url: Schema.String.annotate({ description: "Studio's page, where the person approves the connection" }),
    }).annotate({ description: 'The link that approves the connection, until it is used or a newer link replaces it' }),
  ),
  link_replaced: Schema.optionalKey(
    Schema.Literal(true).annotate({
      description:
        'Answered after the link: a newer link, still open, replaced the link offered, so the newest link is the one to open',
    }),
  ),
}).annotate({
  identifier: 'AddedConnection',
  description: 'The connection, and the link that approves it while there is one to open',
});

export type AddedConnection = typeof AddedSchema.Type;

export const GroupOfMoreSchema = Schema.Struct({
  name: Schema.String.annotate({ description: 'The name add_connection and reconnect_connection take as more' }),
  for: Schema.String.annotate({ description: "What it is for, in the person's words" }),
}).annotate({ description: 'A group of scopes a later consent may add' });

export type GroupOfMore = typeof GroupOfMoreSchema.Type;

const AdditionFieldsSchema = Schema.Struct({
  name: Schema.optionalKey(
    Schema.String.annotate({ description: 'The name a function gives the server, in lowercase and hyphens' }),
  ),
  provider: Schema.optionalKey(Schema.String.annotate({ description: 'A provider to connect, by its name' })),
  placeholders: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).annotate({ description: "With provider, its placeholders' values" }),
  ),
  type: Schema.optionalKey(ConnectionTypeSchema),
  entry: Schema.optionalKey(AddedEntrySchema),
  credential: Schema.optionalKey(AddedCredentialSchema),
  more: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "A group of more the provider's way offers, by name, as search lists under providers; its scopes are asked on the page beside the first consent's. None when left out, and an addition by hand takes none",
    }),
  ),
  events: Schema.optionalKey(AddedEventsSchema),
  message: Schema.optionalKey(MessageField),
});

export type AdditionGiven = typeof AdditionFieldsSchema.Type;

type ModeIssue = Schema.FilterIssue;

const givenByHand = ['name', 'type', 'entry'] as const;

const credentialOfAnApiByHand = 'Expected credential, which an HTTP API given by hand takes, or provider';

const serverFields = ['url', 'document', 'document_text', 'base_url', 'headers', 'query_params', 'request_id'] as const;

const placedByTheProvider = ['variable', 'name', 'in', 'scheme', 'issuer', 'scope', ...keyFieldNames] as const;

function providerModeIssuesOf({ type, entry = {}, credential, events }: AdditionGiven): readonly ModeIssue[] {
  return [
    ...(type === undefined ? [] : [{ path: ['type'], issue: 'Expected no type: the provider gives it' }]),
    ...(events === undefined ? [] : [eventsOfAProvider]),
    ...serverFields
      .filter((field) => entry[field] !== undefined)
      .map((field) => ({ path: ['entry', field], issue: givenByTheProvider(field) })),
    ...placedByTheProvider
      .filter((field) => credential?.[field] !== undefined)
      .map((field) => ({
        path: ['credential', field],
        issue: `Expected no ${field}: the provider gives the credential but its kind`,
      })),
    ...(credential?.client_id === undefined
      ? []
      : [
          {
            path: ['credential', 'client_id'],
            issue: 'Expected no client_id: the person gives the client id on the page',
          },
        ]),
    ...providerCredentialIssuesOf(credential),
  ];
}

function missingCredentialIssuesOf({ credential, type }: AdditionGiven): readonly ModeIssue[] {
  return credential === undefined && type !== 'mcp' ? [{ path: ['credential'], issue: credentialOfAnApiByHand }] : [];
}

function unallowedEventsToolsOf({ events, entry }: AdditionGiven): readonly ModeIssue[] {
  const allowed = entry?.allowed;
  return events === undefined || allowed === undefined ? [] : unallowedToolsIn(events, allowed);
}

const moreOfAnAdditionByHand =
  'Expected no more without provider: an addition by hand offers no group of more, since only a provider names one';

function handModeIssuesOf(given: AdditionGiven): readonly ModeIssue[] {
  const { placeholders } = given;
  return [
    ...givenByHand
      .filter((field) => given[field] === undefined)
      .map((field) => ({ path: [field], issue: `Expected ${field}, which a server given by hand takes, or provider` })),
    ...documentIssuesOf(given),
    ...missingCredentialIssuesOf(given),
    ...(placeholders === undefined
      ? []
      : [{ path: ['placeholders'], issue: 'Expected no placeholders without provider' }]),
    ...(given.more === undefined ? [] : [{ path: ['more'], issue: moreOfAnAdditionByHand }]),
    ...handCredentialIssuesOf(given.credential, given.type),
    ...unallowedEventsToolsOf(given),
  ];
}

export const AdditionSchema = AdditionFieldsSchema.check(
  Schema.makeFilter((given: AdditionGiven) =>
    given.provider === undefined ? handModeIssuesOf(given) : providerModeIssuesOf(given),
  ),
);

export const ConnectionIdField = Schema.String.check(Schema.isMinLength(1)).annotate({
  description: 'The id of the connection',
});

export const PlaybooksField = Schema.NullOr(
  Schema.Array(PlaybookIdSchema).check(
    Schema.isMinLength(1, { message: 'Expected at least one playbook id, or null for every playbook' }),
  ),
).annotate({
  description:
    'The playbooks that may use the connection, by id, or null for every playbook of the org, those made later among them',
});

export const ChosenPlaybooksField = Schema.optionalKey(
  PlaybooksField.annotate({
    description:
      'The playbooks that may use the connection, by id, or null for every playbook of the org, set with the approval, or with the start of the consent; left out, the connection keeps the playbooks it has',
  }),
);

export const TokenField = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)).annotate({
  description: 'The token of the link add_connection or reconnect_connection gave',
});

export const NextClientIdField = Schema.optionalKey(
  Schema.String.annotate({
    description:
      "For a connection under the organization's own OAuth client, the client ID given while it holds tokens, which its next sign-in takes and which it runs under once that sign-in connects it",
  }),
);
