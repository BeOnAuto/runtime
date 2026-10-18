import { ActedContextSchema, factOf, type Decided } from '@on.auto/operations';
import { Schema } from 'effect';

import { ConnectionEntrySchema, ConnectionTypeSchema } from './connection-entry.ts';
import { CredentialSchema } from './credential.ts';

const ofTheConnection = { connection: Schema.String };

export const ConnectionEventSchema = Schema.Union([
  factOf(
    'connection_added',
    Schema.Struct({
      ...ofTheConnection,
      name: Schema.String,
      server_type: ConnectionTypeSchema,
      provider: Schema.NullOr(Schema.String),
      placeholders: Schema.NullOr(Schema.Record(Schema.String, Schema.String)),
      entry: ConnectionEntrySchema,
      credential: CredentialSchema,
    }),
    ActedContextSchema,
  ),
  factOf(
    'connection_link_issued',
    Schema.Struct({ ...ofTheConnection, token_sha256: Schema.String, expires_at: Schema.String }),
    ActedContextSchema,
  ),
  factOf('connection_approved', Schema.Struct(ofTheConnection), ActedContextSchema),
  factOf(
    'connection_connected',
    Schema.Struct({
      ...ofTheConnection,
      secret_id: Schema.optionalKey(Schema.String),
      algorithm: Schema.optionalKey(Schema.String),
      client_id: Schema.optionalKey(Schema.String),
    }),
    ActedContextSchema,
  ),
  factOf('connection_broken', Schema.Struct({ ...ofTheConnection, reason: Schema.String }), ActedContextSchema),
  factOf('connection_removed', Schema.Struct(ofTheConnection), ActedContextSchema),
]);

export type RecordedConnectionEvent = typeof ConnectionEventSchema.Type;

export type ConnectionEvent = Decided<RecordedConnectionEvent>;

export type ConnectionAdded = Extract<RecordedConnectionEvent, { readonly type: 'connection_added' }>;

export type LinkIssued = Extract<RecordedConnectionEvent, { readonly type: 'connection_link_issued' }>;

export type ConnectionConnected = Extract<RecordedConnectionEvent, { readonly type: 'connection_connected' }>;

export type ConnectionBroken = Extract<RecordedConnectionEvent, { readonly type: 'connection_broken' }>;
