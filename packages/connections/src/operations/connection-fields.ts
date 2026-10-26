import { ClientSourceSchema, givenByTheProvider } from '@on.auto/tool-servers';
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
    }).annotate({ description: 'The link that approves the connection, while it is pending and the link lasts' }),
  ),
}).annotate({
  identifier: 'AddedConnection',
  description: 'The connection, and the link that approves it while there is one to open',
});

export type AddedConnection = typeof AddedSchema.Type;

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
      description: 'For client_credentials, the scopes, separated by spaces; none when left out',
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

const givenByHand = ['name', 'type', 'entry', 'credential'] as const;

const serverFields = ['url', 'document', 'base_url', 'headers', 'query_params', 'request_id'] as const;

const placementFields = ['variable', 'name', 'in', 'scheme', 'issuer', 'scope'] as const;

function providerModeIssuesOf({ type, entry = {}, credential }: AdditionGiven): readonly ModeIssue[] {
  return [
    ...(type === undefined ? [] : [{ path: ['type'], issue: 'Expected no type: the provider gives it' }]),
    ...serverFields
      .filter((field) => entry[field] !== undefined)
      .map((field) => ({ path: ['entry', field], issue: givenByTheProvider(field) })),
    ...placementFields
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
  ];
}

const consentByHand =
  'Expected another kind: consent is offered through a provider alone, so name the provider, as search lists it, in provider';

function credentialIssuesOf(credential: AdditionGiven['credential']): readonly ModeIssue[] {
  if (credential === undefined) {
    return [];
  }
  return credential.kind === 'authorization'
    ? [{ path: ['credential', 'kind'], issue: consentByHand }]
    : credentialFieldIssuesOf(credential).map(({ path, issue }) => ({ path: ['credential', ...path], issue }));
}

function handModeIssuesOf(given: AdditionGiven): readonly ModeIssue[] {
  const { placeholders, credential } = given;
  return [
    ...givenByHand
      .filter((field) => given[field] === undefined)
      .map((field) => ({ path: [field], issue: `Expected ${field}, which a server given by hand takes, or provider` })),
    ...(placeholders === undefined
      ? []
      : [{ path: ['placeholders'], issue: 'Expected no placeholders without provider' }]),
    ...credentialIssuesOf(credential),
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
  description: 'The token of the link add_connection gave',
});
