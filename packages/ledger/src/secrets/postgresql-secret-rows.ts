import type { SecretRows } from '@on.auto/secrets';
import { Effect } from 'effect';

import { executorOn } from '../content/postgresql-content.ts';
import { lostConnectionsLoggedWith } from '../postgresql/lost-connections.ts';
import type { PoolBounds } from '../postgresql/postgresql-event-store.ts';
import { secretRowsOn } from './secret-rows.ts';

export interface SecretConnections {
  query(text: string, values: readonly unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
  on(event: 'error', listener: (error: Readonly<Error>) => void): unknown;
  end(): Promise<void>;
}

export interface PostgreSQLSecretRowsOptions {
  readonly pools: (bounds: PoolBounds) => SecretConnections;
}

const connectionsOfTheSecretRows = 2;

export function postgresqlSecretRows({ pools }: PostgreSQLSecretRowsOptions): Effect.Effect<SecretRows> {
  return Effect.map(Effect.context(), (context) => {
    const connections = pools({ max: connectionsOfTheSecretRows });
    connections.on('error', lostConnectionsLoggedWith(context));
    return secretRowsOn(executorOn(connections), () => connections.end());
  });
}
