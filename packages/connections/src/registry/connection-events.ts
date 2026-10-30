import {
  ActedContextSchema,
  RecordedCallerSchema,
  earlierShapeOf,
  factOf,
  readingEarlierShapes,
  type Decided,
} from '@on.auto/operations';
import { ClientSourceSchema } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { ConnectionEntrySchema, ConnectionTypeSchema } from './connection-entry.ts';
import { BrokenKindSchema } from './connection.ts';
import { CredentialSchema, type Credential } from './credential.ts';

const ofTheConnection = { connection: Schema.String };

const clientsOfTheRuntimesOwn: ReadonlySet<string> = new Set(['metadata_document', 'dynamic']);

interface Credentialled {
  readonly provider: string | null;
  readonly credential: Credential;
}

function holdsClientsOfItsOwn({ clients }: Credential): boolean {
  return clients !== undefined && clients.length > 0 && clients.every((source) => clientsOfTheRuntimesOwn.has(source));
}

function clientIssuesOf({ provider, credential }: Credentialled): readonly Schema.FilterIssue[] {
  return provider !== null || credential.kind !== 'authorization' || holdsClientsOfItsOwn(credential)
    ? []
    : [
        {
          path: ['credential', 'clients'],
          issue:
            'Expected clients, which a credential of consent given by hand holds, each a client the runtime makes for itself: metadata_document or dynamic',
        },
      ];
}

const startedFields = {
  ...ofTheConnection,
  state_sha256: Schema.String,
  verifier_secret_id: Schema.String,
  client_id: Schema.String,
  client_source: ClientSourceSchema,
  expires_at: Schema.String,
};

const ConsentStartedBefore = factOf('connection_consent_started', Schema.Struct(startedFields), ActedContextSchema);

const ConsentStartedNow = factOf(
  'connection_consent_started',
  Schema.Struct({
    ...startedFields,
    scope: Schema.optionalKey(Schema.String),
    says: Schema.Record(Schema.String, Schema.String),
  }),
  ActedContextSchema,
);

function askingTheCredentialsScope({ data, ...fact }: typeof ConsentStartedBefore.Type): typeof ConsentStartedNow.Type {
  return { ...fact, data: { ...data, says: {} } };
}

export const ConsentStartedSchema = readingEarlierShapes(ConsentStartedNow, [
  earlierShapeOf(ConsentStartedBefore, askingTheCredentialsScope),
]);

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
      says: Schema.Record(Schema.String, Schema.String),
      added_by: RecordedCallerSchema,
    }).check(Schema.makeFilter(clientIssuesOf)),
    ActedContextSchema,
  ),
  factOf(
    'connection_link_issued',
    Schema.Struct({
      ...ofTheConnection,
      token_sha256: Schema.String,
      expires_at: Schema.String,
      more: Schema.optionalKey(Schema.String),
    }),
    ActedContextSchema,
  ),
  ConsentStartedSchema,
  factOf('connection_approved', Schema.Struct(ofTheConnection), ActedContextSchema),
  factOf(
    'connection_connected',
    Schema.Struct({
      ...ofTheConnection,
      secret_id: Schema.optionalKey(Schema.String),
      algorithm: Schema.optionalKey(Schema.String),
      client_id: Schema.optionalKey(Schema.String),
      client_source: Schema.optionalKey(ClientSourceSchema),
      scope: Schema.optionalKey(Schema.String),
      connected_by: RecordedCallerSchema,
    }),
    ActedContextSchema,
  ),
  factOf(
    'connection_broken',
    Schema.Struct({ ...ofTheConnection, kind: BrokenKindSchema, reason: Schema.String }),
    ActedContextSchema,
  ),
  factOf('connection_removed', Schema.Struct(ofTheConnection), ActedContextSchema),
]);

export type RecordedConnectionEvent = typeof ConnectionEventSchema.Type;

export type ConnectionEvent = Decided<RecordedConnectionEvent>;

export type ConnectionAdded = Extract<RecordedConnectionEvent, { readonly type: 'connection_added' }>;

export type LinkIssued = Extract<RecordedConnectionEvent, { readonly type: 'connection_link_issued' }>;

export type ConsentStarted = Extract<RecordedConnectionEvent, { readonly type: 'connection_consent_started' }>;

export type ConnectionConnected = Extract<RecordedConnectionEvent, { readonly type: 'connection_connected' }>;

export type ConnectionBroken = Extract<RecordedConnectionEvent, { readonly type: 'connection_broken' }>;
