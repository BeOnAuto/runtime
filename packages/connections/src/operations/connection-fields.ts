import { Schema } from 'effect';

import { ConnectionEntrySchema, ConnectionTypeSchema } from '../registry/connection-entry.ts';
import { ConnectionSchema } from '../registry/connection.ts';
import { CredentialSchema } from '../registry/credential.ts';

export const ExpiresAtField = Schema.String.annotate({ description: 'When the link expires, in ISO 8601 UTC' });

export const AddedSchema = Schema.Struct({
  ...ConnectionSchema.fields,
  connect: Schema.Struct({
    url: Schema.String.annotate({ description: "Studio's page, where the person approves the connection" }),
    expires_at: ExpiresAtField,
  }),
}).annotate({ identifier: 'AddedConnection', description: 'The connection, pending, and the link that approves it' });

export const AdditionSchema = Schema.Struct({
  name: Schema.String.annotate({ description: 'The name a function gives the server, in lowercase and hyphens' }),
  type: ConnectionTypeSchema,
  entry: ConnectionEntrySchema,
  credential: CredentialSchema,
});

export const ConnectionIdField = Schema.String.check(Schema.isMinLength(1)).annotate({
  description: 'The id of the connection',
});

export const TokenField = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)).annotate({
  description: 'The token of the link add_connection gave',
});
