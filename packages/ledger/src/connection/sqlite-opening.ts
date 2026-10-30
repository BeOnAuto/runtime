import { Effect, Layer } from 'effect';

import { watchFailuresLoggedWith } from '../appended/append-watch.ts';
import { listenersOf, type AppendListeners } from '../event-store.ts';
import { ledgerLayerOver, type LedgerServices, type OpenedLedger, type StoreLayerOptions } from '../ledger-layer.ts';
import type { KeptTables } from '../projections/projection-parts.ts';
import { pooledOptionsOf, sqliteEventStore, type AnyDriver, type SQLiteStoreOptions } from '../sqlite-event-store.ts';
import { mostValuesTheLedgerBindsOnSQLite, sqliteMostBoundValues } from './bound-values.ts';
import { sqliteConnectionOn } from './sqlite-connection.ts';

export interface SQLiteOpening<Driver extends AnyDriver> {
  readonly optionsOf: () => SQLiteStoreOptions<Driver>;
  readonly inMemory: boolean;
  readonly mostBoundValues?: number;
}

export function sqliteLedgerOpened<Driver extends AnyDriver>(
  { optionsOf, inMemory, mostBoundValues = sqliteMostBoundValues }: SQLiteOpening<Driver>,
  kept: KeptTables = {},
  listeners: AppendListeners = {},
): OpenedLedger {
  if (mostBoundValues < mostValuesTheLedgerBindsOnSQLite) {
    throw new Error(
      `A SQLite that binds at most ${mostBoundValues} values in a statement holds no ledger, which binds up to ${mostValuesTheLedgerBindsOnSQLite} there`,
    );
  }
  const options = pooledOptionsOf(optionsOf);
  const onThePool = () => options;
  return {
    store: sqliteEventStore(onThePool, kept, listeners),
    connection: sqliteConnectionOn(options.pool, {
      inMemory,
      streams: sqliteEventStore(onThePool, {}, listeners),
      mostBoundValues,
    }),
  };
}

export function sqliteLedgerLayer<Driver extends AnyDriver>(
  opening: SQLiteOpening<Driver>,
  options: StoreLayerOptions = {},
): Layer.Layer<LedgerServices> {
  const { runOutcomes, projections, layoutSteps, factSchemas, appends, content } = options;
  return Layer.unwrap(
    Effect.map(Effect.context(), (context) => {
      const listeners = { ...listenersOf(options), watchFailed: watchFailuresLoggedWith(context) };
      return ledgerLayerOver(
        () => sqliteLedgerOpened(opening, { runOutcomes, projections, layoutSteps, factSchemas }, listeners),
        { appends, content },
      );
    }),
  );
}
