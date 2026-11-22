import type { NotFound } from '@on.auto/operations';
import { Result } from 'effect';

import type { ConnectionIdentification } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { isConnectedAt, keptConnectionOf } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';

function isUnidentifiedAt(kept: KeptConnection, connectedAt: string): boolean {
  return isConnectedAt(kept, connectedAt) && kept.identified === undefined;
}

export function decideIdentification(
  { connection, connected_at: connectedAt, user }: ConnectionIdentification,
  registry: Registry,
): Result.Result<readonly ConnectionEvent[], NotFound> {
  return Result.map(keptConnectionOf(registry, connection), (kept): readonly ConnectionEvent[] =>
    isUnidentifiedAt(kept, connectedAt)
      ? [{ type: 'connection_identified', data: { connection, connected_at: connectedAt, user } }]
      : [],
  );
}
