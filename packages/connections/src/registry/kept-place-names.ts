import type { PlaceNamed } from './connection-events.ts';
import type { RecordedConnection } from './connection.ts';

export type PlaceNames = ReadonlyMap<string, ReadonlyMap<string, string>>;

interface Naming {
  readonly connection: RecordedConnection;
  readonly placeNames: PlaceNames;
}

export function keptPlaceNameOf({ placeNames }: Pick<Naming, 'placeNames'>, type: string, subject: string) {
  return placeNames.get(type)?.get(subject);
}

export function placeNamedAfter<Kept extends Naming>(kept: Kept, { data }: PlaceNamed): Kept {
  const { connected_at: connectedAt, event_type: type, subject, name } = data;
  if (connectedAt !== kept.connection.connected_at) {
    return kept;
  }
  const ofTheType = new Map(kept.placeNames.get(type)).set(subject, name);
  return { ...kept, placeNames: new Map(kept.placeNames).set(type, ofTheType) };
}
