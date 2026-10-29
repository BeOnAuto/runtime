import { Effect, Layer } from 'effect';

import { watchFailuresLoggedWith } from '../appended/append-watch.ts';
import { listenersOf, type AppendListeners } from '../event-store.ts';
import { ledgerLayerOver, type LedgerServices, type OpenedLedger, type StoreLayerOptions } from '../ledger-layer.ts';
import type { KeptTables } from '../projections/projection-parts.ts';
import { pooledOptionsOf, sqliteEventStore, type AnyDriver, type SQLiteStoreOptions } from '../sqlite-event-store.ts';
import { sqliteConnectionOn } from './sqlite-connection.ts';

export interface SQLiteOpening<Driver extends AnyDriver> {
  readonly optionsOf: () => SQLiteStoreOptions<Driver>;
  readonly inMemory: boolean;
}

export function sqliteLedgerOpened<Driver extends AnyDriver>(
  { optionsOf, inMemory }: SQLiteOpening<Driver>,
  kept: KeptTables = {},
  listeners: AppendListeners = {},
): OpenedLedger {
  const options = pooledOptionsOf(optionsOf);
  const onThePool = () => options;
  return {
    store: sqliteEventStore(onThePool, kept, listeners),
    connection: sqliteConnectionOn(options.pool, { inMemory, streams: sqliteEventStore(onThePool, {}, listeners) }),
  };
}

export function sqliteLedgerLayer<Driver extends AnyDriver>(
  opening: SQLiteOpening<Driver>,
  options: StoreLayerOptions = {},
): Layer.Layer<LedgerServices> {
  const { runOutcomes, projections, appends, content } = options;
  return Layer.unwrap(
    Effect.map(Effect.context(), (context) => {
      const listeners = { ...listenersOf(options), watchFailed: watchFailuresLoggedWith(context) };
      return ledgerLayerOver(() => sqliteLedgerOpened(opening, { runOutcomes, projections }, listeners), {
        appends,
        content,
      });
    }),
  );
}
