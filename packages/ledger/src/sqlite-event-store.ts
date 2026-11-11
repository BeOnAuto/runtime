import { dumbo, type SQL } from '@event-driven-io/dumbo';
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';

import { dataAsWritten, emmettEventStore, type RiddenAppends } from './emmett/emmett-event-store.ts';
import { inTransactionOf, type AppendListeners, type LedgerStore } from './event-store.ts';
import { sqliteLayoutKept, sqliteSchemaCreated } from './layout/sqlite-schema.ts';
import { sqliteLogOn } from './log/sqlite-log.ts';
import { sqliteRunOutcomesOf } from './outcomes/sqlite-run-outcomes.ts';
import type { KeptTables } from './projections/projection-parts.ts';
import { preparedOn, sqliteProjectionsOf, sqliteSizesAfter } from './projections/sqlite-projections.ts';
import { sqliteRecordedStoreOn } from './recorded/sqlite-recorded.ts';

export type AnyDriver = Parameters<typeof getSQLiteEventStore>[0]['driver'];

const eventsWithinAHundredParameters = 8;

export type SQLiteStoreOptions<Driver extends AnyDriver> = Parameters<typeof getSQLiteEventStore<Driver>>[0];

export function pooledOptionsOf<Driver extends AnyDriver>(optionsOf: () => SQLiteStoreOptions<Driver>) {
  const options = optionsOf();
  const pool =
    options.pool ?? dumbo({ serialization: options.serialization, ...options.driver.mapToDumboOptions(options) });
  return { ...options, pool };
}

export function sqliteEventStore<Driver extends AnyDriver>(
  optionsOf: () => SQLiteStoreOptions<Driver>,
  kept: KeptTables = {},
  listeners: AppendListeners = {},
): LedgerStore & RiddenAppends {
  const options = pooledOptionsOf(optionsOf);
  const { pool } = options;
  const projections = sqliteProjectionsOf(kept);
  const { riders } = projections.scrubs;
  const store = getSQLiteEventStore({
    ...options,
    schema: { autoMigration: 'None' },
    projections: [...(options.projections ?? []), ...projections.registrations],
    hooks: {
      ...options.hooks,
      onBeforeCommit: projections.scrubs.afterTheHook(options.hooks?.onBeforeCommit, riders.beforeCommit),
    },
  });
  const streams = emmettEventStore(store, {
    data: dataAsWritten,
    mostEventsInOneAppend: eventsWithinAHundredParameters,
    sizesAfter: sqliteSizesAfter(pool.execute),
    holders: kept.holders,
    riders,
    ...listeners,
  });
  const recorded = sqliteRecordedStoreOn(pool, listeners);
  const query = async (sql: SQL) => (await pool.execute.query(sql)).rows;
  const statements = { query, command: (sql: SQL) => pool.execute.command(sql), inTransaction: inTransactionOf(pool) };
  return {
    ...streams,
    ...recorded,
    ...projections.readerOn(statements),
    ...projections.scrubs.storeOver(streams, query),
    readRunOutcomes: sqliteRunOutcomesOf(kept.runOutcomes, pool.execute),
    unlessHeld: projections.references.unlessHeldOn(inTransactionOf(pool)),
    log: sqliteLogOn(pool.execute),
    migrate: async () => {
      await sqliteLayoutKept(pool, projections.named, kept);
      await streams.migrate();
      await sqliteSchemaCreated(pool.execute);
      await preparedOn(projections.prepare, pool);
    },
    close: async () => {
      recorded.endWaits();
      await streams.close();
    },
  };
}
