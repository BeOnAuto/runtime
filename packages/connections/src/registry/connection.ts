import { RecordedCallerSchema } from '@on.auto/operations';
import { Schema } from 'effect';

import { ConnectionEntrySchema, ConnectionTypeSchema } from './connection-entry.ts';
import { CredentialSchema } from './credential.ts';

const ConnectionStatusSchema = Schema.Literals(['pending', 'connected', 'broken', 'removed']);

export const ConnectionSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the connection, a UUIDv7' }),
  name: Schema.String.annotate({ description: 'The name a function gives the connection in server/tool' }),
  type: ConnectionTypeSchema,
  provider: Schema.NullOr(Schema.String).annotate({
    description: 'The provider it was added from, by name, or null for a server given by hand',
  }),
  placeholders: Schema.NullOr(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "The values given for the provider's placeholders, or null",
  }),
  entry: ConnectionEntrySchema,
  credential: CredentialSchema,
  status: ConnectionStatusSchema.annotate({
    description: 'pending until it is approved and its credential given, connected, broken or removed',
  }),
  added_by: RecordedCallerSchema.annotate({ description: 'The caller who added it, by id and name' }),
  added_at: Schema.String.annotate({ description: 'When it was added, in ISO 8601 UTC' }),
  connected_at: Schema.NullOr(Schema.String).annotate({ description: 'When it was connected, in ISO 8601 UTC' }),
  connected_by: Schema.NullOr(RecordedCallerSchema).annotate({
    description: 'The caller who connected it, approving it or giving its credential, by id and name',
  }),
  granted_scope: Schema.NullOr(Schema.String).annotate({
    description:
      'For a connection connected by consent, the scopes its authorization server granted, separated by single spaces, which may be fewer than the scope its credential asked; else null',
  }),
  credential_ends_with: Schema.NullOr(Schema.String).annotate({
    description:
      'The last four characters of the secret or client secret the person gave, where it holds twelve or more, kept beside the sealed value',
  }),
  broken: Schema.NullOr(Schema.String).annotate({ description: 'Why it is broken, while it is' }),
}).annotate({ identifier: 'Connection', description: 'A tool server the org added, shared by its playbooks' });

export type Connection = typeof ConnectionSchema.Type;

export type RecordedConnection = Omit<Connection, 'credential_ends_with'>;

export function connectionShown(connection: RecordedConnection, endsWith: string | null): Connection {
  return { ...connection, credential_ends_with: endsWith };
}
