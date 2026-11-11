import { Client } from 'pg';

import { executorOn } from './src/content/postgresql-content.ts';
import type { StatementExecutor } from './src/event-store.ts';
import { plainPoolsOn, postgresqlLedgerLayer } from './src/postgresql/postgresql-ledger.ts';
import { postgresqlProjectionsOf } from './src/postgresql/postgresql-projections.ts';
import type { KeptTables, ProjectionParts } from './src/projections/projection-parts.ts';
import { sqliteProjectionsOf } from './src/projections/sqlite-projections.ts';
import { executedOn } from './src/recorded/sqlite-checks.ts';
import { ledgerLayer } from './src/sqlite3.ts';

export type FilledIn =
  | { readonly store: 'sqlite'; readonly file: string }
  | { readonly store: 'postgresql'; readonly connectionString: string };

export interface FilledStore {
  readonly ledgerOn: (projections: KeptTables['projections']) => ReturnType<typeof ledgerLayer>;
  readonly executedOn: <A>(work: (execute: StatementExecutor) => Promise<A>) => Promise<A>;
  readonly projectionsOf: (kept: KeptTables) => Pick<ProjectionParts, 'prepare'>;
}

async function executedOnPostgreSQL<A>(
  connectionString: string,
  work: (execute: StatementExecutor) => Promise<A>,
): Promise<A> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await work(executorOn(client));
  } finally {
    await client.end();
  }
}

export function filledStoreOf(filledIn: FilledIn): FilledStore {
  if (filledIn.store === 'sqlite') {
    return {
      ledgerOn: (projections) => ledgerLayer({ fileName: filledIn.file, projections }),
      executedOn: (work) => executedOn(filledIn.file, work),
      projectionsOf: sqliteProjectionsOf,
    };
  }
  return {
    ledgerOn: (projections = []) =>
      postgresqlLedgerLayer({ pools: plainPoolsOn(filledIn.connectionString), projections }),
    executedOn: (work) => executedOnPostgreSQL(filledIn.connectionString, work),
    projectionsOf: postgresqlProjectionsOf,
  };
}
