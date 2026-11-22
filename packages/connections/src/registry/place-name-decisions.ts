import type { NotFound } from '@on.auto/operations';
import { Result } from 'effect';

import type { PlaceNaming } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { keptPlaceNameOf } from './kept-place-names.ts';
import { isConnectedAt, keptConnectionOf } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';

function namesItAnew(
  kept: KeptConnection,
  { connected_at: connectedAt, event_type: type, subject, name }: PlaceNaming,
) {
  return isConnectedAt(kept, connectedAt) && keptPlaceNameOf(kept, type, subject) !== name;
}

export function decidePlaceNaming(
  naming: PlaceNaming,
  registry: Registry,
): Result.Result<readonly ConnectionEvent[], NotFound> {
  const { connection, connected_at: connectedAt, event_type: eventType, subject, name } = naming;
  return Result.map(keptConnectionOf(registry, connection), (kept): readonly ConnectionEvent[] =>
    namesItAnew(kept, naming)
      ? [
          {
            type: 'connection_place_named',
            data: { connection, connected_at: connectedAt, event_type: eventType, subject, name },
          },
        ]
      : [],
  );
}
