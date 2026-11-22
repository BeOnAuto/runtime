import {
  ActedContextSchema,
  CallingClientSchema,
  RecordedCallerSchema,
  earlierShapeOf,
  factOf,
  readingEarlierShapes,
  type Decided,
} from '@on.auto/operations';
import { AccountTypeSchema, RecordedEventsSchema } from '@on.auto/providers';
import { ClientSourceSchema } from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { RecordedCredentialSchema, type RecordedCredential } from './acting-fields.ts';
import { ConnectionDocumentSchema, ConnectionEntrySchema, ConnectionTypeSchema } from './connection-entry.ts';
import { AccountSchema, BrokenKindSchema } from './connection.ts';

const ofTheConnection = { connection: Schema.String };

const clientsOfTheRuntimesOwn: ReadonlySet<string> = new Set(['metadata_document', 'dynamic']);

interface Credentialled {
  readonly provider: string | null;
  readonly credential: RecordedCredential;
}

function holdsClientsOfItsOwn({ clients }: RecordedCredential): boolean {
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

function gatewayIssuesOf({ provider, credential }: Credentialled): readonly Schema.FilterIssue[] {
  return provider === null && credential.client_source === 'gateway'
    ? [
        {
          path: ['credential', 'client_source'],
          issue: "Expected a provider, whose entry alone names the gateway a connection's consent is made through",
        },
      ]
    : [];
}

interface WithItsWays extends Credentialled {
  readonly ways?: readonly RecordedCredential[];
}

function waysIssuesOf({ provider, ways }: WithItsWays): readonly Schema.FilterIssue[] {
  return provider !== null && ways !== undefined
    ? [{ path: ['ways'], issue: "Expected no ways: a provider's entry holds the ways of a connection made from it" }]
    : [];
}

function additionIssuesOf(added: WithItsWays): readonly Schema.FilterIssue[] {
  return [...clientIssuesOf(added), ...gatewayIssuesOf(added), ...waysIssuesOf(added)];
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

const SigningSecretsRemovedSchema = Schema.Literals(['previous', 'all']);

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
      document: Schema.optionalKey(ConnectionDocumentSchema),
      credential: RecordedCredentialSchema,
      ways: Schema.optionalKey(Schema.Array(RecordedCredentialSchema)),
      account_type: Schema.optionalKey(AccountTypeSchema),
      says: Schema.Record(Schema.String, Schema.String),
      events: Schema.optionalKey(RecordedEventsSchema),
      added_by: RecordedCallerSchema,
    }).check(Schema.makeFilter(additionIssuesOf)),
    ActedContextSchema,
  ),
  factOf(
    'connection_requested',
    Schema.Struct({ ...ofTheConnection, message: Schema.optionalKey(Schema.String) }),
    ActedContextSchema,
  ),
  factOf('connection_request_declined', Schema.Struct(ofTheConnection), ActedContextSchema),
  factOf(
    'connection_way_chosen',
    Schema.Struct({
      ...ofTheConnection,
      credential: RecordedCredentialSchema,
      account_type: Schema.optionalKey(AccountTypeSchema),
      says: Schema.Record(Schema.String, Schema.String),
      placeholders: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      base_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
    ActedContextSchema,
  ),
  factOf(
    'connection_link_issued',
    Schema.Struct({
      ...ofTheConnection,
      token_sha256: Schema.String,
      expires_at: Schema.String,
      more: Schema.optionalKey(Schema.String),
      asked_by: Schema.optionalKey(CallingClientSchema),
    }),
    ActedContextSchema,
  ),
  factOf(
    'connection_client_given',
    Schema.Struct({ ...ofTheConnection, client_id: Schema.String, secret_id: Schema.String }),
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
      account: Schema.optionalKey(AccountSchema),
      app_secret_ids: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      connected_by: RecordedCallerSchema,
    }),
    ActedContextSchema,
  ),
  factOf(
    'connection_app_credential_refused',
    Schema.Struct({ ...ofTheConnection, name: Schema.String, reason: Schema.String }),
    ActedContextSchema,
  ),
  factOf(
    'connection_broken',
    Schema.Struct({ ...ofTheConnection, kind: BrokenKindSchema, reason: Schema.String }),
    ActedContextSchema,
  ),
  factOf('connection_removed', Schema.Struct(ofTheConnection), ActedContextSchema),
  factOf(
    'connection_playbooks_set',
    Schema.Struct({ ...ofTheConnection, playbooks: Schema.NullOr(Schema.Array(Schema.String)) }),
    ActedContextSchema,
  ),
  factOf(
    'connection_signing_secret_set',
    Schema.Struct({
      ...ofTheConnection,
      secret_id: Schema.String,
      previous_until: Schema.optionalKey(Schema.String),
    }),
    ActedContextSchema,
  ),
  factOf(
    'connection_signing_secret_removed',
    Schema.Struct({ ...ofTheConnection, which: SigningSecretsRemovedSchema }),
    ActedContextSchema,
  ),
  factOf(
    'connection_account_type_set',
    Schema.Struct({ ...ofTheConnection, account_type: AccountTypeSchema }),
    ActedContextSchema,
  ),
  factOf(
    'connection_identified',
    Schema.Struct({
      ...ofTheConnection,
      connected_at: Schema.String,
      user: Schema.Struct({ id: Schema.String, name: Schema.optionalKey(Schema.String) }),
      account: Schema.optionalKey(AccountSchema),
    }),
    ActedContextSchema,
  ),
]);

export type RecordedConnectionEvent = typeof ConnectionEventSchema.Type;

export type ConnectionEvent = Decided<RecordedConnectionEvent>;

export type ConnectionAdded = Extract<RecordedConnectionEvent, { readonly type: 'connection_added' }>;

export type ConnectionRequested = Extract<RecordedConnectionEvent, { readonly type: 'connection_requested' }>;

export type WayChosen = Extract<RecordedConnectionEvent, { readonly type: 'connection_way_chosen' }>;

export type LinkIssued = Extract<RecordedConnectionEvent, { readonly type: 'connection_link_issued' }>;

export type ClientGiven = Extract<RecordedConnectionEvent, { readonly type: 'connection_client_given' }>;

export type ConsentStarted = Extract<RecordedConnectionEvent, { readonly type: 'connection_consent_started' }>;

export type ConnectionConnected = Extract<RecordedConnectionEvent, { readonly type: 'connection_connected' }>;

export type ConnectionBroken = Extract<RecordedConnectionEvent, { readonly type: 'connection_broken' }>;

export type AppCredentialRefused = Extract<
  RecordedConnectionEvent,
  { readonly type: 'connection_app_credential_refused' }
>;

export type PlaybooksSet = Extract<RecordedConnectionEvent, { readonly type: 'connection_playbooks_set' }>;

export type AccountTypeSet = Extract<RecordedConnectionEvent, { readonly type: 'connection_account_type_set' }>;

export type SigningSecretSet = Extract<RecordedConnectionEvent, { readonly type: 'connection_signing_secret_set' }>;

export type SigningSecretRemoved = Extract<
  RecordedConnectionEvent,
  { readonly type: 'connection_signing_secret_removed' }
>;

export type SigningSecretsRemoved = typeof SigningSecretsRemovedSchema.Type;

export type ConnectionIdentified = Extract<RecordedConnectionEvent, { readonly type: 'connection_identified' }>;

export type IdentifiedUser = ConnectionIdentified['data']['user'];

export type OfItsSealedValues = SigningSecretSet | SigningSecretRemoved | AppCredentialRefused;

const typesOfItsSealedValues: ReadonlySet<string> = new Set([
  'connection_signing_secret_set',
  'connection_signing_secret_removed',
  'connection_app_credential_refused',
]);

export function isOfItsSealedValues(event: RecordedConnectionEvent): event is OfItsSealedValues {
  return typesOfItsSealedValues.has(event.type);
}
