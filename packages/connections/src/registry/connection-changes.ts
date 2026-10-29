import {
  changeKindOf,
  strictRecordedDecoder,
  type ChangedFact,
  type ChangeNaming,
  type ResourceChange,
} from '@on.auto/operations';

import { ConnectionEventSchema, type RecordedConnectionEvent } from './connection-events.ts';
import { connectionsStream } from './registry-decider.ts';

const connectionChanged = changeKindOf(
  'connection',
  'A connection added, connected, broken or removed',
  { connection: 'The id of the connection' },
  { permittedBy: ['org:read'] },
);

const decodeConnectionFact = strictRecordedDecoder(ConnectionEventSchema);

function connectionChangedBy(fact: ChangedFact): readonly ResourceChange[] {
  return [connectionChanged.of({ connection: decodeConnectionFact(fact).data.connection })];
}

const named: Readonly<
  Record<RecordedConnectionEvent['type'], ((fact: ChangedFact) => readonly ResourceChange[]) | null>
> = {
  connection_added: connectionChangedBy,
  connection_link_issued: null,
  connection_consent_started: null,
  connection_approved: null,
  connection_connected: connectionChangedBy,
  connection_broken: connectionChangedBy,
  connection_removed: connectionChangedBy,
};

export const connectionChanges: ChangeNaming<ChangedFact> = {
  streamKind: connectionsStream,
  changes: { kinds: [connectionChanged], named },
};
