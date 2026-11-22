import type { ConnectionIdentified, IdentifiedUser } from './connection-events.ts';
import type { RecordedConnection } from './connection.ts';

export function identifiedAfter(
  identified: IdentifiedUser | undefined,
  { connected_at: connectedAt }: Pick<RecordedConnection, 'connected_at'>,
  { data }: ConnectionIdentified,
): IdentifiedUser | undefined {
  return data.connected_at === connectedAt ? data.user : identified;
}
