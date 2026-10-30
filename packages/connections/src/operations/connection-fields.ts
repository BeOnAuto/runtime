import { ClientSourceSchema, WayAppSchema, givenByTheProvider } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { ConnectionEntrySchema, ConnectionTypeSchema } from '../registry/connection-entry.ts';
import { ConnectionSchema } from '../registry/connection.ts';
import {
  CredentialFieldsSchema,
  CredentialKindSchema,
  credentialDescription,
  credentialFieldIssuesOf,
} from '../registry/credential.ts';

export const ClientSourceField = ClientSourceSchema;

export const ExpiresAtField = Schema.String.annotate({ description: 'When the link expires, in ISO 8601 UTC' });

export const AddedSchema = Schema.Struct({
  ...ConnectionSchema.fields,
  connect: Schema.optionalKey(
    Schema.Struct({
      url: Schema.String.annotate({ description: "Studio's page, where the person approves the connection" }),
      expires_at: ExpiresAtField,
    }).annotate({ description: 'The link that approves the connection, while it lasts and is not used up' }),
  ),
  link_ran_out: Schema.optionalKey(
    Schema.Literal(true).annotate({
      description: 'Answered after the link: the link offered ran out unused, so the connection stands as it was',
    }),
  ),
  link_replaced: Schema.optionalKey(
    Schema.Literal(true).annotate({
      description:
        'Answered after the link: a newer link, still open, replaced the link offered, so the person who added the connection opens the newest',
    }),
  ),
}).annotate({
  identifier: 'AddedConnection',
  description: 'The connection, and the link that approves it while there is one to open',
});

export type AddedConnection = typeof AddedSchema.Type;

export const GroupOfMoreSchema = Schema.Struct({
  name: Schema.String.annotate({ description: 'The name reconnect_connection takes as more' }),
  for: Schema.String.annotate({ description: "What it is for, in the person's words" }),
}).annotate({ description: 'A group of scopes a later consent may add' });

export type GroupOfMore = typeof GroupOfMoreSchema.Type;

const { variable, name, in: placement, scheme, issuer, client_id: clientId, scope } = CredentialFieldsSchema.fields;

const AddedCredentialSchema = Schema.Struct({
  kind: CredentialKindSchema,
  variable,
  name,
  in: placement,
  scheme,
  issuer: Schema.optionalKey(
    issuer.schema.annotate({ description: 'For client_credentials, the https URL of the authorization server' }),
  ),
  client_id: Schema.optionalKey(
    clientId.schema.annotate({ description: 'For client_credentials, the id of the client, else given on the page' }),
  ),
  scope: Schema.optionalKey(
    scope.schema.annotate({
      description: 'For client_credentials, the scopes, separated by spaces, none when left out',
    }),
  ),
  app: Schema.optionalKey(
    WayAppSchema.annotate({
      description:
        "For a provider's authorization, own to connect under the org's own app there, its client id and secret given on the page; own by default where the way takes no other client here",
    }),
  ),
}).annotate({ description: credentialDescription });

const AdditionFieldsSchema = Schema.Struct({
  name: Schema.optionalKey(
    Schema.String.annotate({ description: 'The name a function gives the server, in lowercase and hyphens' }),
  ),
  provider: Schema.optionalKey(Schema.String.annotate({ description: 'A provider to connect, by its name' })),
  placeholders: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String).annotate({ description: "With provider, its placeholders' values" }),
  ),
  type: Schema.optionalKey(ConnectionTypeSchema),
  entry: Schema.optionalKey(ConnectionEntrySchema),
  credential: Schema.optionalKey(AddedCredentialSchema),
});

export type AdditionGiven = typeof AdditionFieldsSchema.Type;

type ModeIssue = Schema.FilterIssue;

const givenByHand = ['name', 'type', 'entry'] as const;

const credentialOfAnApiByHand = 'Expected credential, which an HTTP API given by hand takes, or provider';

const serverFields = ['url', 'document', 'base_url', 'headers', 'query_params', 'request_id'] as const;

const placedByTheProvider = ['variable', 'name', 'in', 'scheme', 'issuer', 'scope'] as const;

function providerModeIssuesOf({ type, entry = {}, credential }: AdditionGiven): readonly ModeIssue[] {
  return [
    ...(type === undefined ? [] : [{ path: ['type'], issue: 'Expected no type: the provider gives it' }]),
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
    ...appIssuesOf(credential),
  ];
}

const appOfConsentAlone = "Expected no app: only an authorization credential's consent runs under an app";

function appIssuesOf(credential: AdditionGiven['credential']): readonly ModeIssue[] {
  return credential?.app === undefined || credential.kind === 'authorization'
    ? []
    : [{ path: ['credential', 'app'], issue: appOfConsentAlone }];
}

const consentOfAnApiByHand =
  'Expected another kind: an HTTP API given by hand takes no consent, since its document names no authorization server; name a provider, as search lists it, in provider';

const givenBesideTheKind = [...placedByTheProvider, 'client_id'] as const;

const appOfAProvider =
  "Expected no app without provider: consent runs under the org's own app at a provider, whose way says where to register it";

type AddedCredential = NonNullable<AdditionGiven['credential']>;

function consentByHandIssuesOf(credential: AddedCredential, type: AdditionGiven['type']): readonly ModeIssue[] {
  if (type === 'openapi') {
    return [{ path: ['credential', 'kind'], issue: consentOfAnApiByHand }];
  }
  return givenBesideTheKind
    .filter((field) => credential[field] !== undefined)
    .map((field) => ({
      path: ['credential', field],
      issue: `Expected no ${field}: the server names its authorization server itself`,
    }));
}

function missingCredentialIssuesOf({ credential, type }: AdditionGiven): readonly ModeIssue[] {
  return credential === undefined && type !== 'mcp' ? [{ path: ['credential'], issue: credentialOfAnApiByHand }] : [];
}

function credentialIssuesOf({ credential, type }: AdditionGiven): readonly ModeIssue[] {
  if (credential === undefined) {
    return [];
  }
  return credential.kind === 'authorization'
    ? consentByHandIssuesOf(credential, type)
    : credentialFieldIssuesOf(credential).map(({ path, issue }) => ({ path: ['credential', ...path], issue }));
}

function handModeIssuesOf(given: AdditionGiven): readonly ModeIssue[] {
  const { placeholders } = given;
  return [
    ...givenByHand
      .filter((field) => given[field] === undefined)
      .map((field) => ({ path: [field], issue: `Expected ${field}, which a server given by hand takes, or provider` })),
    ...missingCredentialIssuesOf(given),
    ...(placeholders === undefined
      ? []
      : [{ path: ['placeholders'], issue: 'Expected no placeholders without provider' }]),
    ...(given.credential?.app === undefined ? [] : [{ path: ['credential', 'app'], issue: appOfAProvider }]),
    ...credentialIssuesOf(given),
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

export const TokenField = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)).annotate({
  description: 'The token of the link add_connection or reconnect_connection gave',
});

export const NextClientIdField = Schema.optionalKey(
  Schema.String.annotate({
    description:
      "For a connection under the org's own app, the client id given while it holds tokens, which its next sign-in takes and which it runs under once that sign-in connects it",
  }),
);
