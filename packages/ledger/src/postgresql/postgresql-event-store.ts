import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { pgEventStoreDriver } from '@event-driven-io/emmett-postgresql/pg';

import { emmettEventStore } from '../emmett/emmett-event-store.ts';
import { listenersOf, type AppendListeners, type LedgerStore } from '../event-store.ts';
import { formattedFor, postgresqlRecordedStoreOn, type Query } from '../postgresql-reads/postgresql-recorded.ts';
import { dataAsJsonText } from './json-text.ts';
import type { PostgreSQLOptions, PostgreSQLPools } from './postgresql-options.ts';
import { postgresqlProjectionsOf } from './postgresql-projections.ts';
import { postgresqlReadsOn } from './postgresql-reads.ts';
import { beforeTheSchemaOf } from './postgresql-schema.ts';

export interface PostgreSQLStoreOptions extends PostgreSQLOptions {
  readonly reportLostConnection: (error: Readonly<Error>) => void;
}

export type PostgreSQLPool = ReturnType<PostgreSQLPools>;

export type StoreKept = Pick<PostgreSQLOptions, 'runOutcomes' | 'projections'>;

const eventsInOneBoundedAppend = 64;

export const connectionsOfOneLedger = 10;

export function postgresqlStoreOn(
  pooled: () => PostgreSQLPool,
  kept: StoreKept,
  listeners: AppendListeners = {},
): LedgerStore {
  const pool = pooled();
  const projections = postgresqlProjectionsOf(kept);
  const store = emmettEventStore(
    getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionOptions: { pool },
      schema: { autoMigration: 'None' },
      projections: [...projections.registrations],
      hooks: {
        onBeforeSchemaCreated: beforeTheSchemaOf(projections.projections),
        onAfterSchemaCreated: projections.afterTheSchema,
      },
    }),
    { data: dataAsJsonText, mostEventsInOneAppend: eventsInOneBoundedAppend, ...listeners },
  );
  const query: Query = async (text, values) =>
    (await pool.query<Readonly<Record<string, unknown>>>(text, [...values])).rows;
  const recorded = postgresqlRecordedStoreOn(query, pool, listeners);
  return {
    ...store,
    ...recorded,
    ...projections.readerOn({ query: formattedFor(query), command: formattedFor(query) }),
    ...postgresqlReadsOn(kept, query),
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
