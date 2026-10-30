import {
  changeKindOf,
  strictRecordedDecoder,
  type ChangedFact,
  type ChangeNaming,
  type ResourceChange,
} from '@on.auto/operations';

import { ConnectionEventSchema, ConsentStartedSchema, type RecordedConnectionEvent } from './connection-events.ts';
import { connectionsStream } from './registry-decider.ts';

const connectionChanged = changeKindOf(
  'connection',
  "A connection added, connected, broken or removed, asked for more, or given the client of the org's own app",
  { connection: 'The id of the connection' },
  { permittedBy: ['org:read'] },
);

const decodeConnectionFact = strictRecordedDecoder(ConnectionEventSchema);

const decodeConsentStarted = strictRecordedDecoder(ConsentStartedSchema);

function connectionChangedBy(fact: ChangedFact): readonly ResourceChange[] {
  return [connectionChanged.of({ connection: decodeConnectionFact(fact).data.connection })];
}

function scopesAddedBy(fact: ChangedFact): readonly ResourceChange[] {
  const { connection, says } = decodeConsentStarted(fact).data;
  return Object.keys(says).length === 0 ? [] : [connectionChanged.of({ connection })];
}

const named: Readonly<
  Record<RecordedConnectionEvent['type'], ((fact: ChangedFact) => readonly ResourceChange[]) | null>
> = {
  connection_added: connectionChangedBy,
  connection_link_issued: null,
  connection_client_given: connectionChangedBy,
  connection_consent_started: scopesAddedBy,
  connection_approved: null,
  connection_connected: connectionChangedBy,
  connection_broken: connectionChangedBy,
  connection_removed: connectionChangedBy,
};

export const connectionChanges: ChangeNaming<ChangedFact> = {
  streamKind: connectionsStream,
  changes: { kinds: [connectionChanged], named },
};
