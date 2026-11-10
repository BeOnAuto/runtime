import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { pgEventStoreDriver } from '@event-driven-io/emmett-postgresql/pg';

import { emmettEventStore, type RiddenAppends } from '../emmett/emmett-event-store.ts';
import { listenersOf, type AppendListeners, type LedgerStore } from '../event-store.ts';
import { formattedFor, postgresqlRecordedStoreOn, type Query } from '../postgresql-reads/postgresql-recorded.ts';
import { dataAsJsonText } from './json-text.ts';
import { migrationLockTaken, postgresqlLayoutKept } from './postgresql-layout.ts';
import type { PostgreSQLOptions, PostgreSQLPools } from './postgresql-options.ts';
import { postgresqlProjectionsOf, postgresqlSizesAfter } from './postgresql-projections.ts';
import { postgresqlReadsOn } from './postgresql-reads.ts';

export interface PostgreSQLStoreOptions extends PostgreSQLOptions {
  readonly reportLostConnection: (error: Readonly<Error>) => void;
}

export type PostgreSQLPool = ReturnType<PostgreSQLPools>;

export type StoreKept = Pick<
  PostgreSQLOptions,
  'runOutcomes' | 'projections' | 'holders' | 'layoutSteps' | 'factSchemas'
>;

const eventsInOneBoundedAppend = 64;

export const connectionsOfOneLedger = 10;

export function postgresqlStoreOn(
  pooled: () => PostgreSQLPool,
  kept: StoreKept,
  listeners: AppendListeners = {},
): LedgerStore & RiddenAppends {
  const pool = pooled();
  const projections = postgresqlProjectionsOf(kept);
  const { riders } = projections.scrubs;
  const query: Query = async (text, values) =>
    (await pool.query<Readonly<Record<string, unknown>>>(text, [...values])).rows;
  const store = emmettEventStore(
    getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionOptions: { pool },
      schema: { autoMigration: 'None' },
      projections: [...projections.registrations],
      hooks: {
        onBeforeSchemaCreated: migrationLockTaken,
        onAfterSchemaCreated: projections.afterTheSchema,
        onBeforeCommit: riders.beforeCommit,
      },
    }),
    {
      data: dataAsJsonText,
      mostEventsInOneAppend: eventsInOneBoundedAppend,
      sizesAfter: postgresqlSizesAfter(query),
      holders: kept.holders,
      riders,
      ...listeners,
    },
  );
  const recorded = postgresqlRecordedStoreOn(query, pool, listeners);
  return {
    ...store,
    ...recorded,
    ...projections.readerOn({ query: formattedFor(query), command: formattedFor(query) }),
    ...projections.scrubs.storeOver(store, formattedFor(query)),
    ...postgresqlReadsOn(kept, query),
    unlessHeld: projections.unlessHeldOn(pool),
    migrate: async () => {
      await postgresqlLayoutKept(pool, projections.named, kept);
      await store.migrate();
    },
    close: async () => {
      recorded.endWaits();
      await store.close();
      await pool.end();
    },
  };
}

export function poolOf({ pools, reportLostConnection }: PostgreSQLStoreOptions, max: number): PostgreSQLPool {
  const pool = pools({ max });
  pool.on('error', reportLostConnection);
  return pool;
}

export function postgresqlEventStore(options: PostgreSQLStoreOptions): LedgerStore {
  return postgresqlStoreOn(() => poolOf(options, connectionsOfOneLedger), options, listenersOf(options));
}
