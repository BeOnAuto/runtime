import {
  LedgerConnection,
  statement,
  statementOf,
  type ConnectionPorts,
  type Statement,
  type StatementValue,
} from '@on.auto/ledger';
import { sqliteLedgerReads } from '@on.auto/ledger/sqlite3';
import { Effect, ManagedRuntime, Schema } from 'effect';

import { sqliteLedgerDatabase } from '../../database/sqlite-ledger-database.ts';

const decodeNames = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })));

export function namesIn(rows: unknown): readonly string[] {
  return decodeNames(rows).map(({ name }) => name);
}

export async function onTheLedgerIn<A>(file: string, use: (connection: ConnectionPorts) => Promise<A>): Promise<A> {
  const runtime = ManagedRuntime.make(sqliteLedgerDatabase(file).ledgerLayer({}));
  try {
    return await use(await runtime.runPromise(Effect.service(LedgerConnection)));
  } finally {
    await runtime.dispose();
  }
}

export async function readOfTheLedgerIn(file: string, asked: Statement): Promise<readonly unknown[]> {
  const reads = sqliteLedgerReads({ fileName: file });
  try {
    return await reads.read(asked);
  } finally {
    await reads.close();
  }
}

const CatalogRowsSchema = Schema.Array(Schema.Struct({ name: Schema.String, sql: Schema.String }));

export type CatalogRows = typeof CatalogRowsSchema.Type;

const everyRelationButTheStores = statement`SELECT name, sql FROM sqlite_master
  WHERE type IN ('table', 'index') AND name NOT GLOB 'emt_*' AND name NOT GLOB 'dmb_*' AND name NOT GLOB 'sqlite_*'
  ORDER BY name`;

function onOneLine(sql: string): string {
  return sql.replaceAll(/\s+/gu, ' ').replaceAll('( ', '(').replaceAll(' )', ')');
}

export async function catalogOfTheLedgerIn(file: string): Promise<CatalogRows> {
  const rows = Schema.decodeUnknownSync(CatalogRowsSchema)(await readOfTheLedgerIn(file, everyRelationButTheStores));
  return rows.map(({ name, sql }) => ({ name, sql: onOneLine(sql) }));
}

type Assignment = readonly [string, StatementValue];

export function everyRowSet(table: string, set: Readonly<Record<string, StatementValue>>): Statement {
  const assignments: readonly Assignment[] = Object.entries(set);
  return statementOf(
    [
      ...assignments.map(([column]: Assignment, index) => `${index === 0 ? `UPDATE ${table} SET` : ','} ${column} = `),
      '',
    ],
    assignments.map(([, value]: Assignment) => value),
  );
}

export function tableDropped(table: string): Statement {
  return statementOf([`DROP TABLE ${table}`], []);
}

export async function tablesNamedIn(file: string, pattern: string): Promise<readonly string[]> {
  return namesIn(
    await readOfTheLedgerIn(
      file,
      statement`SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB ${pattern} ORDER BY name`,
    ),
  );
}
