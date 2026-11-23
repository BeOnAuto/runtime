import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { pgEventStoreDriver } from '@event-driven-io/emmett-postgresql/pg';

import { emmettEventStore, type RiddenAppends } from '../emmett/emmett-event-store.ts';
import { listenersOf, type AppendListeners, type LedgerStore } from '../event-store.ts';
import {
  countedIn,
  formattedFor,
  postgresqlRecordedStoreOn,
  type Query,
} from '../postgresql-reads/postgresql-recorded.ts';
import { dataAsJsonText } from './json-text.ts';
import { migrationLockTakenWithin, postgresqlLayoutKept, type MigrationLockTaken } from './postgresql-layout.ts';
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
  | 'mostBytesFilledAtOnce'
  | 'holders'
  | 'layoutSteps'
  | 'factSchemas'
  | 'floor'
  | 'definitionNames'
  | 'runIds'
  | 'tableMadeAgain'
  | 'pageFailed'
  | 'migrationLockWaiting'
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

interface Migrating extends Opened {
  readonly store: { readonly migrate: () => Promise<void> };
  readonly lockTaken: MigrationLockTaken;
}

function migrationOf(migrating: () => Migrating, kept: StoreKept): () => Promise<void> {
  const { pool, projections, store, lockTaken } = migrating();
  return async () => {
    await postgresqlLayoutKept(pool, projections.named, kept, lockTaken);
    await store.migrate();
    await projections.caughtUpOn(pool);
  };
}

export const connectionsOfOneLedger = 10;

function countedQueryOn(pool: { readonly query: PostgreSQLPool['query'] }): Query {
  return countedIn(
    async (text, values) => (await pool.query<Readonly<Record<string, unknown>>>(text, [...values])).rows,
  );
}

export function postgresqlStoreOn(
  pooled: () => PostgreSQLPool,
  kept: StoreKept,
  listeners: AppendListeners = {},
): LedgerStore & RiddenAppends {
  const pool = pooled();
  const projections = postgresqlProjectionsOf(kept);
  const lockTaken = migrationLockTakenWithin(kept.migrationLockWaiting);
  const query = countedQueryOn(pool);
  const store = emmettEventStore(
    getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionOptions: { pool },
      schema: { autoMigration: 'None' },
      projections: [...projections.registrations],
      hooks: {
        onBeforeSchemaCreated: lockTaken,
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
    ...projections.readerOnThePool(pool, formattedFor(query), connectionsOfOneLedger - 1),
    ...projections.scrubs.storeOver(store, formattedFor(query)),
    ...postgresqlReadsOn(kept, query, projections.catchingUp),
    ...projections.holdsOn(pool, formattedFor(query)),
    migrate: migrationOf(() => ({ pool, projections, store, lockTaken }), kept),
    catchUpSlice: () => projections.caughtUpOn(pool),
    catchUpState: () => projections.catchingUp.state(),
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
