import type { ContentStore, Ledger } from '@on.auto/operations';
import { Effect, Layer } from 'effect';

import type { AppendSignal } from '../appends/append-signal.ts';
import { ledgerLayerOver } from '../ledger-layer.ts';
import { lostConnectionsLoggedWith } from './lost-connections.ts';
import { postgresqlEventStore, type PostgreSQLOptions } from './postgresql-event-store.ts';

export {
  plainPoolsOn,
  postgresqlEventStore,
  type PoolBounds,
  type PostgreSQLOptions,
  type PostgreSQLPools,
  type PostgreSQLStoreOptions,
} from './postgresql-event-store.ts';
export {
  postgresqlSecretRows,
  type PostgreSQLSecretRowsOptions,
  type SecretConnections,
} from '../secrets/postgresql-secret-rows.ts';

export interface PostgreSQLLedgerOptions extends PostgreSQLOptions {
  readonly appends?: AppendSignal;
  readonly content?: ContentStore;
}

export function postgresqlLedgerLayer({ appends, content, ...options }: PostgreSQLLedgerOptions): Layer.Layer<Ledger> {
  return Layer.unwrap(
    Effect.map(Effect.context(), (context) =>
      ledgerLayerOver(
        () => postgresqlEventStore({ ...options, reportLostConnection: lostConnectionsLoggedWith(context) }),
        { appends, content },
      ),
    ),
  );
}
