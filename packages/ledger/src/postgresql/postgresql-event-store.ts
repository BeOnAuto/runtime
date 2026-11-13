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
  | 'runOutcomes'
  | 'projections'
  | 'streamProjections'
  | 'mostBytesFilledAtOnce'
  | 'holders'
  | 'layoutSteps'
  | 'factSchemas'
  | 'floor'
  | 'definitionNames'
>;

const eventsInOneBoundedAppend = 64;

type Projections = ReturnType<typeof postgresqlProjectionsOf>;

type TransactionsJoined = Parameters<Projections['multiStreamAppendsOver']>[0];

function transactionsOnThePool(pooled: () => PostgreSQLPool): TransactionsJoined {
  const connections = pgEventStoreDriver.dumboDriver.createPool(
    pgEventStoreDriver.mapToDumboOptions({ connectionOptions: { pool: pooled() } }),
  );
  return async (work) => {
    const connection = await connections.connection();
    try {
      await work(connection, (committing) =>
        getPostgreSQLEventStore({
          driver: pgEventStoreDriver,
          connectionOptions: { connection },
          schema: { autoMigration: 'None' },
          hooks: { onBeforeCommit: committing },
        }),
      );
    } finally {
      await connection.close();
    }
  };
}

interface Opened {
  readonly pool: PostgreSQLPool;
  readonly projections: Projections;
}

function multiStreamAppendsOn(
  opened: () => Opened,
  { holders }: StoreKept,
  listeners: AppendListeners,
): ReturnType<Projections['multiStreamAppendsOver']> {
  const { pool, projections } = opened();
  const { multiStreamAppendsOver, scrubs } = projections;
  return multiStreamAppendsOver(
    transactionsOnThePool(() => pool),
    {
      data: dataAsJsonText,
      mostEventsInOneAppend: eventsInOneBoundedAppend,
      holders,
      listeners,
      beforeCommit: scrubs.riders.beforeCommit,
    },
  );
}

export const connectionsOfOneLedger = 10;

export function postgresqlStoreOn(
  pooled: () => PostgreSQLPool,
  kept: StoreKept,
  listeners: AppendListeners = {},
): LedgerStore & RiddenAppends {
  const pool = pooled();
  const projections = postgresqlProjectionsOf(kept);
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
        onBeforeCommit: projections.scrubs.riders.beforeCommit,
      },
    }),
    {
      data: dataAsJsonText,
      mostEventsInOneAppend: eventsInOneBoundedAppend,
      sizesAfter: postgresqlSizesAfter(query),
      holders: kept.holders,
      riders: projections.scrubs.riders,
      ...listeners,
    },
  );
  const recorded = postgresqlRecordedStoreOn(query, pool, listeners);
  return {
    ...store,
    ...multiStreamAppendsOn(() => ({ pool, projections }), kept, listeners),
    ...recorded,
    ...projections.readerOnThePool(pool, formattedFor(query)),
    ...projections.scrubs.storeOver(store, formattedFor(query)),
    ...postgresqlReadsOn(kept, query),
    ...projections.holdsOn(pool, formattedFor(query)),
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
