import { dumbo, type SQL } from '@event-driven-io/dumbo';
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';

import { dataAsWritten, emmettEventStore, type RiddenAppends } from './emmett/emmett-event-store.ts';
import { inTransactionOf, type AppendListeners, type LedgerStore } from './event-store.ts';
import { sqliteLayoutKept, sqliteSchemaCreated } from './layout/sqlite-schema.ts';
import { sqliteLogOn } from './log/sqlite-log.ts';
import { sqliteRunOutcomesOf } from './outcomes/sqlite-run-outcomes.ts';
import type { KeptTables, ProjectionParts } from './projections/projection-parts.ts';
import { preparedOn, sqliteProjectionsOf, sqliteSizesAfter } from './projections/sqlite-projections.ts';
import { sqliteRecordedStoreOn } from './recorded/sqlite-recorded.ts';

export type AnyDriver = Parameters<typeof getSQLiteEventStore>[0]['driver'];

const eventsWithinAHundredParameters = 8;

type EmmettOptions<Driver extends AnyDriver> = Parameters<typeof getSQLiteEventStore<Driver>>[0];

type BeforeCommit = Parameters<ProjectionParts['multiStreamAppendsOver']>[1]['beforeCommit'];

type LedgerHooks<Driver extends AnyDriver> = NonNullable<EmmettOptions<Driver>['hooks']> & {
  readonly onBeforeCommit?: BeforeCommit;
};

export type SQLiteStoreOptions<Driver extends AnyDriver> = EmmettOptions<Driver> & {
  readonly projections?: never;
  readonly hooks?: LedgerHooks<Driver>;
};

export function pooledOptionsOf<Driver extends AnyDriver>(optionsOf: () => SQLiteStoreOptions<Driver>) {
  const options = optionsOf();
  const pool =
    options.pool ?? dumbo({ serialization: options.serialization, ...options.driver.mapToDumboOptions(options) });
  return { ...options, pool };
}

function appendingOn<Driver extends AnyDriver>(
  pooled: () => ReturnType<typeof pooledOptionsOf<Driver>>,
  parts: () => ProjectionParts,
  kept: KeptTables,
  listeners: AppendListeners,
) {
  const options = pooled();
  const { registrations, scrubs, multiStreamAppendsOver } = parts();
  const beforeCommit: BeforeCommit = scrubs.afterTheHook(options.hooks?.onBeforeCommit, scrubs.riders.beforeCommit);
  const appending = {
    data: dataAsWritten,
    mostEventsInOneAppend: eventsWithinAHundredParameters,
    holders: kept.holders,
  };
  const store = getSQLiteEventStore({
    ...options,
    schema: { autoMigration: 'None' },
    projections: [...registrations],
    hooks: { ...options.hooks, onBeforeCommit: beforeCommit },
  });
  return {
    streams: emmettEventStore(store, {
      ...appending,
      sizesAfter: sqliteSizesAfter(options.pool.execute),
      riders: scrubs.riders,
      ...listeners,
    }),
    appends: multiStreamAppendsOver(
      (work) =>
        work(options.pool, (committing) =>
          getSQLiteEventStore({ ...options, schema: { autoMigration: 'None' }, hooks: { onBeforeCommit: committing } }),
        ),
      { ...appending, listeners, beforeCommit },
    ),
  };
}

export function sqliteEventStore<Driver extends AnyDriver>(
  optionsOf: () => SQLiteStoreOptions<Driver>,
  kept: KeptTables = {},
  listeners: AppendListeners = {},
): LedgerStore & RiddenAppends {
  const options = pooledOptionsOf(optionsOf);
  const { pool } = options;
  const projections = sqliteProjectionsOf(kept);
  const { streams, appends } = appendingOn(
    () => options,
    () => projections,
    kept,
    listeners,
  );
  const recorded = sqliteRecordedStoreOn(pool, listeners);
  const query = async (sql: SQL) => (await pool.execute.query(sql)).rows;
  const statements = { query, command: (sql: SQL) => pool.execute.command(sql), inTransaction: inTransactionOf(pool) };
  return {
    ...streams,
    ...appends,
    ...recorded,
    ...projections.readerOn(statements),
    ...projections.scrubs.storeOver(streams, query),
    readRunOutcomes: sqliteRunOutcomesOf(kept.runOutcomes, pool.execute),
    unlessHeld: projections.references.unlessHeldOn(inTransactionOf(pool)),
    heldHeads: projections.references.heldHeadsOn(query),
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
