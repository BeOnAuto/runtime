import type { ContentStore } from '@on.auto/operations';
import { Effect, Layer } from 'effect';

import { watchFailuresLoggedWith } from '../appended/append-watch.ts';
import type { AppendSignal } from '../appends/append-signal.ts';
import { listenersOf } from '../event-store.ts';
import { ledgerLayerOver, type LedgerServices, type OpenedLedger } from '../ledger-layer.ts';
import { lostConnectionsLoggedWith } from './lost-connections.ts';
import { postgresqlConnectionOn } from './postgresql-connection.ts';
import {
  connectionsOfOneLedger,
  poolOf,
  postgresqlStoreOn,
  type PostgreSQLStoreOptions,
} from './postgresql-event-store.ts';
import type { PostgreSQLOptions } from './postgresql-options.ts';

export { postgresqlEventStore, type PostgreSQLStoreOptions } from './postgresql-event-store.ts';
export { plainPoolsOn, type PoolBounds, type PostgreSQLOptions, type PostgreSQLPools } from './postgresql-options.ts';
export {
  postgresqlSecretRows,
  type PostgreSQLSecretRowsOptions,
  type SecretConnections,
} from '../secrets/postgresql-secret-rows.ts';

export interface PostgreSQLLedgerOptions extends PostgreSQLOptions {
  readonly appends?: AppendSignal;
  readonly content?: ContentStore;
}

const connectionsForTheStatementsBeside = 4;

export function postgresqlLedgerOpened(options: PostgreSQLStoreOptions): OpenedLedger {
  const listeners = listenersOf(options);
  const pool = poolOf(options, connectionsOfOneLedger);
  const besides = poolOf(options, connectionsForTheStatementsBeside);
  const store = postgresqlStoreOn(() => pool, options, listeners);
  return {
    store: {
      ...store,
      close: async () => {
        await store.close();
        await besides.end();
      },
    },
    connection: postgresqlConnectionOn(
      besides,
      postgresqlStoreOn(() => pool, {}, listeners),
    ),
  };
}

export function postgresqlLedgerLayer({
  appends,
  content,
  ...options
}: PostgreSQLLedgerOptions): Layer.Layer<LedgerServices> {
  return Layer.unwrap(
    Effect.map(Effect.context(), (context) =>
      ledgerLayerOver(
        () =>
          postgresqlLedgerOpened({
            ...options,
            reportLostConnection: lostConnectionsLoggedWith(context),
            watchFailed: watchFailuresLoggedWith(context),
          }),
        { appends, content },
      ),
    ),
  );
}
