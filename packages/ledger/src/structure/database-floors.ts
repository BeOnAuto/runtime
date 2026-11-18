import { Client } from 'pg';

import { executorOn } from '../content/postgresql-content.ts';
import { executedOn } from '../recorded/sqlite-checks.ts';
import type { DatabaseStructure } from './database-structure.ts';
import { postgresqlStructureOf } from './postgresql-structure.ts';
import { sqliteStructureOf } from './sqlite-structure.ts';

interface Answer {
  readonly rows: readonly unknown[];
}

interface Querying {
  query(text: string, values?: readonly unknown[]): Promise<Answer>;
}

async function onTheDatabase<A>(database: string, work: (client: Querying) => Promise<A>): Promise<A> {
  const client = new Client({ connectionString: database });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export function structureOfTheSQLiteFile(fileName: string): Promise<DatabaseStructure> {
  return executedOn(fileName, (execute) => sqliteStructureOf(execute));
}

export function structureOfThePostgreSQLDatabase(database: string): Promise<DatabaseStructure> {
  return onTheDatabase(database, (client: Querying) => postgresqlStructureOf(executorOn(client)));
}
