import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { pgEventStoreDriver } from '@event-driven-io/emmett-postgresql/pg';

import { emmettEventStore } from '../emmett/emmett-event-store.ts';
import type { LedgerStore } from '../event-store.ts';
import { formattedFor, postgresqlRecordedStoreOn, type Query } from '../postgresql-reads/postgresql-recorded.ts';
import { dataAsJsonText } from './json-text.ts';
import type { PostgreSQLOptions } from './postgresql-options.ts';
import { postgresqlProjectionsOf } from './postgresql-projections.ts';
import { postgresqlRunOutcomesOf } from './postgresql-run-outcomes.ts';
import { beforeTheSchema } from './postgresql-schema.ts';

export interface PostgreSQLStoreOptions extends PostgreSQLOptions {
  readonly reportLostConnection: (error: Readonly<Error>) => void;
}

const eventsInOneBoundedAppend = 64;

const connectionsOfOneLedger = 10;

export function postgresqlEventStore({
  pools,
  reportLostConnection,
  runOutcomes,
  projections,
  observer,
}: PostgreSQLStoreOptions): LedgerStore {
  const pool = pools({ max: connectionsOfOneLedger });
  pool.on('error', reportLostConnection);
  const kept = postgresqlProjectionsOf({ runOutcomes, projections });
  const store = emmettEventStore(
    getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      connectionOptions: { pool },
      schema: { autoMigration: 'None' },
      projections: [...kept.registrations],
      hooks: { onBeforeSchemaCreated: beforeTheSchema, onAfterSchemaCreated: kept.afterTheSchema },
    }),
    { data: dataAsJsonText, mostEventsInOneAppend: eventsInOneBoundedAppend, observer },
  );
  const query: Query = async (text, values) =>
    (await pool.query<Readonly<Record<string, unknown>>>(text, [...values])).rows;
  return {
    ...store,
    ...postgresqlRecordedStoreOn(query, pool),
    ...kept.readerOn({ query: formattedFor(query), command: formattedFor(query) }),
    readRunOutcomes: postgresqlRunOutcomesOf(runOutcomes, query),
    close: async () => {
      await store.close();
      await pool.end();
    },
  };
}
