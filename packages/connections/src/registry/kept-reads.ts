import type { ConnectionIdentified, IdentifiedUser, PlaceNamed, RecordedConnectionEvent } from './connection-events.ts';
import type { RecordedConnection } from './connection.ts';
import { identifiedAfter } from './kept-identities.ts';
import { placeNamedAfter, type PlaceNames } from './kept-place-names.ts';

export interface KeptReads {
  readonly identified: IdentifiedUser | undefined;
  readonly placeNames: PlaceNames;
}

export const noReads: KeptReads = { identified: undefined, placeNames: new Map() };

type ReadThroughTheConnection = ConnectionIdentified | PlaceNamed;

export function isKeptRead(event: RecordedConnectionEvent): event is ReadThroughTheConnection {
  return event.type === 'connection_identified' || event.type === 'connection_place_named';
}

export function keptReadAfter<Kept extends KeptReads & { readonly connection: RecordedConnection }>(
  kept: Kept,
  event: ReadThroughTheConnection,
): Kept {
  return event.type === 'connection_identified' ? identifiedAfter(kept, event) : placeNamedAfter(kept, event);
}
