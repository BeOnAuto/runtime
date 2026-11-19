import type { NotFound } from '@on.auto/operations';
import { Result } from 'effect';

import type { AppCredentialRefusal } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { isConnectedAt, keptConnectionOf } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';

function holdsItUnrefused({ connection }: KeptConnection, name: string): boolean {
  return connection.app_credentials.some((held) => held.name === name && held.refused === null);
}

export function decideAppCredentialRefusal(
  { connection, connected_at: connectedAt, name, reason }: AppCredentialRefusal,
  registry: Registry,
): Result.Result<readonly ConnectionEvent[], NotFound> {
  return Result.map(keptConnectionOf(registry, connection), (kept): readonly ConnectionEvent[] =>
    isConnectedAt(kept, connectedAt) && holdsItUnrefused(kept, name)
      ? [{ type: 'connection_app_credential_refused', data: { connection, name, reason } }]
      : [],
  );
}
