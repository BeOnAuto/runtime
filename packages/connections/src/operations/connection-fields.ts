import { Schema } from 'effect';

import { ConnectionEntrySchema, ConnectionTypeSchema } from '../registry/connection-entry.ts';
import { ConnectionSchema } from '../registry/connection.ts';
import { CredentialFieldsSchema, credentialDescription, credentialFieldIssuesOf } from '../registry/credential.ts';

export const ExpiresAtField = Schema.String.annotate({ description: 'When the link expires, in ISO 8601 UTC' });

export const AddedSchema = Schema.Struct({
  ...ConnectionSchema.fields,
  connect: Schema.Struct({
    url: Schema.String.annotate({ description: "Studio's page, where the person approves the connection" }),
    expires_at: ExpiresAtField,
  }),
}).annotate({ identifier: 'AddedConnection', description: 'The connection, pending, and the link that approves it' });

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
  credential: Schema.optionalKey(CredentialFieldsSchema.annotate({ description: credentialDescription })),
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
      .map((field) => ({ path: ['entry', field], issue: `Expected no ${field}: the provider gives the server` })),
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

function handModeIssuesOf(given: AdditionGiven): readonly ModeIssue[] {
  const { placeholders, credential } = given;
  return [
    ...givenByHand
      .filter((field) => given[field] === undefined)
      .map((field) => ({ path: [field], issue: `Expected ${field}, which a server given by hand takes, or provider` })),
    ...(placeholders === undefined
      ? []
      : [{ path: ['placeholders'], issue: 'Expected no placeholders without provider' }]),
    ...(credential === undefined
      ? []
      : credentialFieldIssuesOf(credential).map(({ path, issue }) => ({ path: ['credential', ...path], issue }))),
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
