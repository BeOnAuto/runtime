import type { AppendObserver } from '../event-store.ts';
import { ledgerLayerOver, type OpenedLedger, type StoreLayerOptions } from '../ledger-layer.ts';
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
  observer?: AppendObserver,
): OpenedLedger {
  const options = pooledOptionsOf(optionsOf);
  const onThePool = () => options;
  return {
    store: sqliteEventStore(onThePool, kept, observer),
    connection: sqliteConnectionOn(options.pool, { inMemory, streams: sqliteEventStore(onThePool, {}, observer) }),
  };
}

export function sqliteLedgerLayer<Driver extends AnyDriver>(
  opening: SQLiteOpening<Driver>,
  { runOutcomes, projections, appends, content, observer }: StoreLayerOptions = {},
) {
  return ledgerLayerOver(() => sqliteLedgerOpened(opening, { runOutcomes, projections }, observer), {
    appends,
    content,
  });
}
