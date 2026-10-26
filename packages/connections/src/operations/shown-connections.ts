import { Effect } from 'effect';

import { connectionShown, type Connection } from '../registry/connection.ts';
import type { KeptConnection } from '../registry/registry.ts';
import type { SecretKeeping } from './connection-services.ts';

function endingOf(endings: ReadonlyMap<string, string>, secretId: string | undefined): string | null {
  return secretId === undefined ? null : (endings.get(secretId) ?? null);
}

export function shownConnections(
  { endingsOf }: Pick<SecretKeeping, 'endingsOf'>,
  kept: readonly KeptConnection[],
): Effect.Effect<readonly Connection[]> {
  const secretIds = kept.flatMap(({ secretId }) => (secretId === undefined ? [] : [secretId]));
  return Effect.map(endingsOf(secretIds), (endings) =>
    kept.map(({ connection, secretId }) => connectionShown(connection, endingOf(endings, secretId))),
  );
}

export function shownConnection(
  secrets: Pick<SecretKeeping, 'endingsOf'>,
  kept: KeptConnection,
): Effect.Effect<Connection> {
  return Effect.flatMap(shownConnections(secrets, [kept]), ([shown]) => Effect.orDie(Effect.fromNullishOr(shown)));
}
