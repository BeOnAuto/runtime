import { CallingClientSchema, recordedDecoder, type KeyedProjection, type ProjectedRow } from '@on.auto/operations';
import { ClientSourceSchema } from '@on.auto/tool-servers';
import { Option, Schema, Struct } from 'effect';

import { RecordedCredentialFieldsSchema } from './acting-fields.ts';
import { ConnectionEventSchema, connectionsStream, type RecordedConnectionEvent } from './connection-events.ts';
import { ConnectionSchema } from './connection.ts';
import { evolveRegistry, type KeptConnection, type Registry } from './registry.ts';

export const connectionRowsName = 'connections';

export const addedPositionColumn = 'added_position';

const connectionFactTypes = [
  'connection_added',
  'connection_requested',
  'connection_request_declined',
  'connection_way_chosen',
  'connection_link_issued',
  'connection_client_given',
  'connection_consent_started',
  'connection_approved',
  'connection_connected',
  'connection_app_credential_refused',
  'connection_broken',
  'connection_removed',
  'connection_playbooks_set',
  'connection_signing_secret_set',
  'connection_signing_secret_removed',
  'connection_account_type_set',
  'connection_identified',
  'connection_place_named',
  'connection_model_set',
  'connection_service_account_created',
];

const Text = Schema.String;

const KeptSchema = Schema.Struct({
  connection: Schema.Struct({
    ...Struct.omit(ConnectionSchema.fields, ['credential_ends_with', 'credential', 'permissions']),
    credential: RecordedCredentialFieldsSchema,
  }),
  ways: Schema.optionalKey(Schema.Array(RecordedCredentialFieldsSchema)),
  link: Schema.optionalKey(
    Schema.Struct({
      token_sha256: Text,
      more: Schema.optionalKey(Text),
      asked_by: Schema.optionalKey(CallingClientSchema),
    }),
  ),
  replaced_links: Schema.Array(Text),
  consent: Schema.optionalKey(
    Schema.Struct({
      state_sha256: Text,
      verifier_secret_id: Text,
      client_id: Text,
      client_source: ClientSourceSchema,
      scope: Schema.optionalKey(Text),
      started_at: Text,
      expires_at: Text,
    }),
  ),
  secret_id: Schema.optionalKey(Text),
  algorithm: Schema.optionalKey(Text),
  client_secret_id: Schema.optionalKey(Text),
  next_client: Schema.optionalKey(Schema.Struct({ client_id: Text, secret_id: Text })),
  signing: Schema.optionalKey(
    Schema.Struct({
      current: Schema.Struct({ secretId: Text, setAt: Text }),
      previous: Schema.optionalKey(Schema.Struct({ secretId: Text, until: Text })),
    }),
  ),
  app_secret_ids: Schema.Record(Text, Text),
  model: Schema.NullOr(Text),
  identified: Schema.optionalKey(Schema.Struct({ id: Text, name: Schema.optionalKey(Text) })),
  place_names: Schema.Array(Schema.Tuple([Text, Schema.Array(Schema.Tuple([Text, Text]))])),
  service_account: Schema.optionalKey(
    Schema.Struct({ email: Text, id: Text, placeholders: Schema.Record(Text, Text) }),
  ),
});

type Kept = typeof KeptSchema.Type;

const KeptTextSchema = Schema.fromJsonString(Schema.toCodecJson(KeptSchema));

const keptTextOf = Schema.encodeSync(KeptTextSchema);

const keptOfText = Schema.decodeUnknownSync(KeptTextSchema);

const ConnectionRowSchema = Schema.Struct({
  kept: Text,
  added_position: Schema.Int,
  credential_as_added: Schema.Boolean,
  account_type_as_added: Schema.Boolean,
});

type ConnectionRow = typeof ConnectionRowSchema.Type;

const connectionRowOf = Schema.decodeUnknownSync(ConnectionRowSchema);

const connectionFactOf = recordedDecoder(ConnectionEventSchema);

type StartedConsent = NonNullable<KeptConnection['consent']>;

type KeptSigning = NonNullable<KeptConnection['signing']>;

function consentStored({ scope, ...consent }: StartedConsent) {
  return { ...consent, ...(scope === undefined ? {} : { scope }) };
}

function signingStored({ current, previous }: KeptSigning) {
  return { current, ...(previous === undefined ? {} : { previous }) };
}

function serviceAccountStoredOf({ serviceAccount }: KeptConnection): Pick<Kept, 'service_account'> {
  return serviceAccount === undefined ? {} : { service_account: serviceAccount };
}

function storedOf(kept: KeptConnection): Kept {
  const { ways, link, consent, secretId, algorithm, clientSecretId, nextClient, signing, identified } = kept;
  return {
    connection: kept.connection,
    ...(ways === undefined ? {} : { ways }),
    ...(link === undefined ? {} : { link }),
    replaced_links: [...kept.replacedLinks],
    ...(consent === undefined ? {} : { consent: consentStored(consent) }),
    ...(secretId === undefined ? {} : { secret_id: secretId }),
    ...(algorithm === undefined ? {} : { algorithm }),
    ...(clientSecretId === undefined ? {} : { client_secret_id: clientSecretId }),
    ...(nextClient === undefined ? {} : { next_client: nextClient }),
    ...(signing === undefined ? {} : { signing: signingStored(signing) }),
    app_secret_ids: kept.appSecretIds,
    model: kept.model,
    ...(identified === undefined ? {} : { identified }),
    place_names: [...kept.placeNames].map(
      ([type, names]: readonly [string, ReadonlyMap<string, string>]) => [type, [...names]] as const,
    ),
    ...serviceAccountStoredOf(kept),
  };
}

function keptOf(stored: Kept): KeptConnection {
  const { consent, signing } = stored;
  return {
    connection: stored.connection,
    ways: stored.ways,
    link: stored.link,
    replacedLinks: new Set(stored.replaced_links),
    consent: consent === undefined ? undefined : { ...consent, scope: consent.scope },
    secretId: stored.secret_id,
    algorithm: stored.algorithm,
    clientSecretId: stored.client_secret_id,
    nextClient: stored.next_client,
    signing: signing === undefined ? undefined : { current: signing.current, previous: signing.previous },
    appSecretIds: stored.app_secret_ids,
    model: stored.model,
    identified: stored.identified,
    placeNames: new Map(stored.place_names.map(([type, names]) => [type, new Map(names)])),
    serviceAccount: stored.service_account,
  };
}

function asAddedAfter(row: ConnectionRow | undefined, { type }: RecordedConnectionEvent) {
  if (type === 'connection_added' || row === undefined) {
    return { credential_as_added: true, account_type_as_added: true };
  }
  if (type === 'connection_way_chosen') {
    return { credential_as_added: false, account_type_as_added: false };
  }
  return {
    credential_as_added: row.credential_as_added,
    account_type_as_added: row.account_type_as_added && type !== 'connection_account_type_set',
  };
}

function rowAfterFact(
  stored: ProjectedRow | undefined,
  fact: RecordedConnectionEvent,
  position: number,
): ProjectedRow | undefined {
  const id = fact.data.connection;
  const row = stored === undefined ? undefined : connectionRowOf(stored);
  const before: Registry = row === undefined ? new Map() : new Map([[id, keptOf(keptOfText(row.kept))]]);
  const after = evolveRegistry(before, fact).get(id);
  return after === undefined || after === before.get(id)
    ? undefined
    : {
        kept: keptTextOf(storedOf(after)),
        added_position: row === undefined ? position : row.added_position,
        ...asAddedAfter(row, fact),
      };
}

const connectionRowsLayout = 33;

export const connectionRowsLayoutSteps = [{ layout: connectionRowsLayout, statements: [] }] as const;

export const connectionRows: KeyedProjection = {
  name: connectionRowsName,
  version: 1,
  scopes: ['org'],
  kinds: [connectionsStream],
  types: connectionFactTypes,
  columns: [
    { name: 'kept', kind: 'text' },
    { name: addedPositionColumn, kind: 'integer' },
    { name: 'credential_as_added', kind: 'boolean' },
    { name: 'account_type_as_added', kind: 'boolean' },
  ],
  indexes: [],
  keyOf: (message) => Option.getOrUndefined(Option.map(connectionFactOf(message), ({ data }) => data.connection)),
  rowAfter: (row, message) =>
    Option.getOrUndefined(
      Option.flatMapNullishOr(connectionFactOf(message), (fact) => rowAfterFact(row, fact, message.position)),
    ),
};

export interface KeptInARow {
  readonly kept: KeptConnection;
  readonly row: ConnectionRow;
}

export function keptInTheRow(stored: ProjectedRow): KeptInARow {
  const row = connectionRowOf(stored);
  return { kept: keptOf(keptOfText(row.kept)), row };
}
