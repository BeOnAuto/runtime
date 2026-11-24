import {
  changeKindOf,
  strictRecordedDecoder,
  type ChangedFact,
  type ChangeNaming,
  type ResourceChange,
} from '@on.auto/operations';

import {
  ConnectionEventSchema,
  ConsentStartedSchema,
  connectionsStream,
  type RecordedConnectionEvent,
} from './connection-events.ts';

const connectionChanged = changeKindOf(
  'connection',
  "A connection added, connected, broken or removed, asked for more, given the organization's own OAuth client, its way chosen, its service account created, its playbooks, its account type or its model set, its signing secret set or removed, or one of its app credentials refused",
  { connection: 'The id of the connection' },
  { permittedBy: ['org:read'] },
);

const decodeConnectionFact = strictRecordedDecoder(ConnectionEventSchema);

const decodeConsentStarted = strictRecordedDecoder(ConsentStartedSchema);

function connectionChangedBy(fact: ChangedFact): readonly ResourceChange[] {
  return [connectionChanged.of({ connection: decodeConnectionFact(fact).data.connection })];
}

function accountRecordedBy(fact: ChangedFact): readonly ResourceChange[] {
  const decoded = decodeConnectionFact(fact);
  return decoded.type === 'connection_identified' && decoded.data.account !== undefined
    ? [connectionChanged.of({ connection: decoded.data.connection })]
    : [];
}

function scopesAddedBy(fact: ChangedFact): readonly ResourceChange[] {
  const { connection, says } = decodeConsentStarted(fact).data;
  return Object.keys(says).length === 0 ? [] : [connectionChanged.of({ connection })];
}

const named: Readonly<
  Record<RecordedConnectionEvent['type'], ((fact: ChangedFact) => readonly ResourceChange[]) | null>
> = {
  connection_added: connectionChangedBy,
  connection_requested: null,
  connection_request_declined: null,
  connection_way_chosen: connectionChangedBy,
  connection_link_issued: null,
  connection_client_given: connectionChangedBy,
  connection_consent_started: scopesAddedBy,
  connection_approved: null,
  connection_connected: connectionChangedBy,
  connection_broken: connectionChangedBy,
  connection_app_credential_refused: connectionChangedBy,
  connection_removed: connectionChangedBy,
  connection_playbooks_set: connectionChangedBy,
  connection_account_type_set: connectionChangedBy,
  connection_signing_secret_set: connectionChangedBy,
  connection_signing_secret_removed: connectionChangedBy,
  connection_identified: accountRecordedBy,
  connection_place_named: null,
  connection_model_set: connectionChangedBy,
  connection_service_account_created: connectionChangedBy,
};

export const connectionChanges: ChangeNaming<ChangedFact> = {
  streamKind: connectionsStream,
  changes: { kinds: [connectionChanged], named },
};
