import { Effect } from 'effect';

import { executorOn } from '../content/postgresql-content.ts';
import { lostConnectionsLoggedWith } from '../postgresql/lost-connections.ts';
import type { PoolBounds } from '../postgresql/postgresql-options.ts';
import type { SecretConnections } from '../secrets/postgresql-secret-rows.ts';
import { receivedWebhooksOn, type ReceivedWebhooks } from './received-webhooks.ts';

export interface PostgreSQLReceivedWebhooksOptions {
  readonly pools: (bounds: PoolBounds) => SecretConnections;
}

const connectionsOfTheReceivedWebhooks = 2;

export function postgresqlReceivedWebhooks({
  pools,
}: PostgreSQLReceivedWebhooksOptions): Effect.Effect<ReceivedWebhooks> {
  return Effect.map(Effect.context(), (context) => {
    const connections = pools({ max: connectionsOfTheReceivedWebhooks });
    connections.on('error', lostConnectionsLoggedWith(context));
    return receivedWebhooksOn(executorOn(connections), () => connections.end());
  });
}
