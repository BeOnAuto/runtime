import type { ConnectionIdentified, IdentifiedUser } from './connection-events.ts';
import type { RecordedConnection } from './connection.ts';

interface Identifying {
  readonly connection: RecordedConnection;
  readonly identified: IdentifiedUser | undefined;
}

function accountAfter({ account }: RecordedConnection, { data }: ConnectionIdentified): RecordedConnection['account'] {
  return account ?? data.account ?? null;
}

export function identifiedAfter<Kept extends Identifying>(kept: Kept, identifying: ConnectionIdentified): Kept {
  const { connection } = kept;
  if (identifying.data.connected_at !== connection.connected_at) {
    return kept;
  }
  return {
    ...kept,
    identified: identifying.data.user,
    connection: { ...connection, account: accountAfter(connection, identifying) },
  };
}
