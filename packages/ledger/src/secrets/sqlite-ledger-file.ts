import { AsyncLocalStorage } from 'node:async_hooks';

import type { SecretRows } from '@on.auto/secrets';
import { Effect, Layer } from 'effect';

import { mostValuesTheLedgerBindsOnSQLite } from '../connection/bound-values.ts';
import { sqliteLedgerLayer, type SQLiteOpening } from '../connection/sqlite-opening.ts';
import type { ReturningExecutor } from '../event-store.ts';
import type { LedgerServices, StoreLayerOptions } from '../ledger-layer.ts';
import { pooledOptionsOf, type AnyDriver, type SQLiteStoreOptions } from '../sqlite-event-store.ts';
import { receivedWebhooksOn, type ReceivedWebhooks } from '../webhooks/received-webhooks.ts';
import { secretRowsOn } from './secret-rows.ts';

export interface SQLiteLedgerFile {
  readonly ledgerLayer: (options?: StoreLayerOptions) => Layer.Layer<LedgerServices>;
  readonly secretRows: Effect.Effect<SecretRows>;
  readonly receivedWebhooks: Effect.Effect<ReceivedWebhooks>;
}

interface SQLiteLedgerFileOpening<Driver extends AnyDriver> extends SQLiteOpening<Driver> {
  readonly optionsOf: () => SQLiteStoreOptions<Driver> & { readonly pool?: undefined };
}

export class LedgerNotOpen extends Error {}

type AsyncContext = ReturnType<typeof AsyncLocalStorage.snapshot>;

const closedByTheLedger = (): Promise<void> => Promise.resolve();

function issuedIn(context: AsyncContext, execute: ReturningExecutor): ReturningExecutor {
  return {
    query: (sql) => context(() => execute.query(sql)),
    command: (sql) => context(() => execute.command(sql)),
  };
}

export function sqliteLedgerFileOn<Driver extends AnyDriver>(
  opening: SQLiteLedgerFileOpening<Driver>,
  named: string,
): SQLiteLedgerFile {
  const open: { writing: ReturningExecutor | undefined } = { writing: undefined };
  const optionsOf = () => {
    const beforeThePool = AsyncLocalStorage.snapshot();
    const pooled = pooledOptionsOf(opening.optionsOf);
    open.writing = issuedIn(beforeThePool, pooled.pool.execute);
    return pooled;
  };
  const closed = Layer.effectDiscard(
    Effect.addFinalizer(() =>
      Effect.sync(() => {
        open.writing = undefined;
      }),
    ),
  );
  const onItsOpenLedger = <Rows>(rows: string, rowsOn: (writing: ReturningExecutor) => Rows): Effect.Effect<Rows> =>
    Effect.suspend(() =>
      open.writing === undefined
        ? Effect.die(
            new LedgerNotOpen(
              `The ${rows} of the ledger in ${named} run on the pool its ledger opens, and its ledger is not open`,
            ),
          )
        : Effect.succeed(rowsOn(open.writing)),
    );
  return {
    ledgerLayer: (options = {}) => Layer.merge(sqliteLedgerLayer({ ...opening, optionsOf }, options), closed),
    secretRows: onItsOpenLedger('secret rows', (writing) =>
      secretRowsOn(writing, closedByTheLedger, mostValuesTheLedgerBindsOnSQLite),
    ),
    receivedWebhooks: onItsOpenLedger('webhooks received', (writing) => receivedWebhooksOn(writing, closedByTheLedger)),
  };
}
