import { dumbo } from '@event-driven-io/dumbo';
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';

import { dataAsWritten, emmettEventStore } from './emmett/emmett-event-store.ts';
import type { AppendObserver, LedgerStore } from './event-store.ts';
import { sqliteLayoutKept, sqliteSchemaCreated } from './layout/sqlite-schema.ts';
import { sqliteRunOutcomesOf } from './outcomes/sqlite-run-outcomes.ts';
import type { KeptTables } from './projections/projection-parts.ts';
import { preparedOn, sqliteProjectionsOf } from './projections/sqlite-projections.ts';
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
  observer?: AppendObserver,
): LedgerStore {
  const options = pooledOptionsOf(optionsOf);
  const { pool } = options;
  const projections = sqliteProjectionsOf(kept);
  const store = getSQLiteEventStore({
    ...options,
    schema: { autoMigration: 'None' },
    projections: [...(options.projections ?? []), ...projections.registrations],
  });
  const streams = emmettEventStore(store, {
    data: dataAsWritten,
    mostEventsInOneAppend: eventsWithinAHundredParameters,
    observer,
  });
  return {
    ...streams,
    ...sqliteRecordedStoreOn(pool),
    ...projections.readerOn({
      query: async (sql) => (await pool.execute.query(sql)).rows,
      command: (sql) => pool.execute.command(sql),
    }),
    readRunOutcomes: sqliteRunOutcomesOf(kept.runOutcomes, pool.execute),
    migrate: async () => {
      await sqliteLayoutKept(pool, projections.projections);
      await streams.migrate();
      await sqliteSchemaCreated(pool.execute);
      await preparedOn(projections.prepare, pool);
    },
  };
}
