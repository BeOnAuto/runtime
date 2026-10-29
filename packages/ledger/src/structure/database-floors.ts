import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { pgEventStoreDriver } from '@event-driven-io/emmett-postgresql/pg';
import { Schema } from 'effect';
import { Client, Pool } from 'pg';

import { executorOn } from '../content/postgresql-content.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { executedOn } from '../recorded/sqlite-checks.ts';
import type { DatabaseStructure } from './database-structure.ts';
import { postgresqlStructureOf } from './postgresql-structure.ts';
import { sqliteStructureOf } from './sqlite-structure.ts';

const RowsSchema = Schema.Array(Schema.Record(Schema.String, Schema.Unknown));

export const DatabaseDumpSchema = Schema.Struct({
  layout: Schema.Number,
  made: Schema.Array(Schema.String),
  kept: Schema.Array(Schema.Struct({ table: Schema.String, rows: RowsSchema })),
});

export type DatabaseDump = typeof DatabaseDumpSchema.Type;

const tablesOfTheLayoutsOwnBookkeeping: readonly string[] = ['ledger_layout'];

const tablesMade = `SELECT c.relname AS name, format('CREATE TABLE %I (%s)', c.relname, concat_ws(', ',
    (SELECT string_agg(format('%I %s', a.attname, format_type(a.atttypid, a.atttypmod))
        || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
        || COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), ''), ', ' ORDER BY a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
    (SELECT string_agg(format('CONSTRAINT %I %s', k.conname, pg_get_constraintdef(k.oid)), ', ' ORDER BY k.conname)
      FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype <> 'n'))) AS made
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND c.relkind = 'r' AND NOT c.relispartition
  ORDER BY c.relname`;

const indexesMade = `SELECT c.relname AS name, replace(pg_get_indexdef(c.oid), ' ON ONLY ', ' ON ') AS made
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND c.relkind IN ('i', 'I') AND NOT c.relispartition
    AND NOT EXISTS (SELECT FROM pg_constraint k WHERE k.conindid = c.oid)
  ORDER BY c.relname`;

const MadeSchema = Schema.Array(Schema.Struct({ name: Schema.String, made: Schema.String }));

const LayoutSchema = Schema.Tuple([Schema.Struct({ layout: Schema.Number })]);

interface Answer {
  readonly rows: readonly unknown[];
}

interface Querying {
  query(text: string, values?: readonly unknown[]): Promise<Answer>;
}

interface KeptRow {
  readonly table: string;
  readonly row: Readonly<Record<string, unknown>>;
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

export async function aPostgreSQLDatabaseOfTheStore(database: string): Promise<void> {
  const pool = new Pool({ connectionString: database });
  const store = getPostgreSQLEventStore({
    driver: pgEventStoreDriver,
    connectionOptions: { pool },
    schema: { autoMigration: 'None' },
  });
  try {
    await store.schema.migrate();
  } finally {
    await store.close();
    await pool.end();
  }
}

async function madeIn(client: Querying): Promise<typeof MadeSchema.Type> {
  const tables = Schema.decodeUnknownSync(MadeSchema)((await client.query(tablesMade)).rows);
  const indexes = Schema.decodeUnknownSync(MadeSchema)((await client.query(indexesMade)).rows);
  return [...tables, ...indexes];
}

export async function postgresqlLayoutDumpOf(database: string, ofTheStoreAlone: string): Promise<DatabaseDump> {
  const theStores = new Set((await onTheDatabase(ofTheStoreAlone, madeIn)).map(({ name }) => name));
  return onTheDatabase(database, async (client: Querying) => {
    const made = (await madeIn(client)).filter(({ name }) => !theStores.has(name)).map((each) => each.made);
    const [{ layout }] = Schema.decodeUnknownSync(LayoutSchema)(
      (await client.query('SELECT layout FROM ledger_layout')).rows,
    );
    const kept = await Promise.all(
      tablesOfTheLayoutsOwnBookkeeping.map(async (table) => ({
        table,
        rows: Schema.decodeUnknownSync(RowsSchema)((await client.query(`SELECT * FROM ${table}`)).rows),
      })),
    );
    return { layout, made, kept };
  });
}

function insertOf(table: string, columns: readonly string[]): string {
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`;
}

export async function aPostgreSQLDatabaseFrom({ made, kept }: DatabaseDump, database: string): Promise<void> {
  await aPostgreSQLDatabaseOfTheStore(database);
  await onTheDatabase(database, async (client: Querying) => {
    await inTurn(made, (statement) => client.query(statement));
    await inTurn(
      kept.flatMap(({ table, rows }): readonly KeptRow[] => rows.map((row) => ({ table, row }))),
      ({ table, row }: KeptRow) => client.query(insertOf(table, Object.keys(row)), Object.values(row)),
    );
  });
}

export function structureOfTheSQLiteFile(fileName: string): Promise<DatabaseStructure> {
  return executedOn(fileName, (execute) => sqliteStructureOf(execute));
}

export function structureOfThePostgreSQLDatabase(database: string): Promise<DatabaseStructure> {
  return onTheDatabase(database, (client: Querying) => postgresqlStructureOf(executorOn(client)));
}
