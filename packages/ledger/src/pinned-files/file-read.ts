import { createHash } from 'node:crypto';

import { Schema } from 'effect';

import type { LedgerReads } from '../connection/ledger-connection.ts';
import { statement, statementOf } from '../connection/statement.ts';
import { sqliteLedgerReads } from '../sqlite.ts';
import { canonicalJsonOf } from './canonical-json.ts';

const TableReadSchema = Schema.Struct({ rows: Schema.Number, sha256: Schema.String });

export const FileReadSchema = Schema.Struct({
  integrity: Schema.Array(Schema.String),
  header: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number])),
  tables: Schema.Record(Schema.String, TableReadSchema),
});

type FileRead = typeof FileReadSchema.Type;

type TableRead = typeof TableReadSchema.Type;

const decodeNames = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })));

const decodeIntegrity = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ integrity_check: Schema.String })));

const decodeHeader = Schema.decodeUnknownSync(
  Schema.Tuple([Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number]))]),
);

const decodeCells = Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)));

const theSchema = 'sqlite_schema';

const columnsOfTheSchema: readonly string[] = ['type', 'name', 'tbl_name', 'sql'];

function quoted(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function columnsOf(reads: LedgerReads, table: string): Promise<readonly string[]> {
  if (table === theSchema) {
    return columnsOfTheSchema;
  }
  return decodeNames(await reads.read(statement`SELECT name FROM pragma_table_info(${table}) ORDER BY cid`)).map(
    ({ name }) => name,
  );
}

function rowOf(cells: Readonly<Record<string, unknown>>, columns: readonly string[]): string {
  return canonicalJsonOf(columns.map((_column, index) => [cells[`t${index}`], cells[`v${index}`]]));
}

async function tableRead(reads: LedgerReads, table: string): Promise<TableRead> {
  const columns = await columnsOf(reads, table);
  const selected = columns.map(
    (column, index) => `typeof(${quoted(column)}) AS t${index}, ${quoted(column)} AS v${index}`,
  );
  const cells = decodeCells(await reads.read(statementOf([`SELECT ${selected.join(', ')} FROM ${quoted(table)}`], [])));
  const rows = cells.map((row) => rowOf(row, columns)).toSorted();
  return { rows: rows.length, sha256: createHash('sha256').update(rows.join('\n')).digest('hex') };
}

const headerRead = statement`SELECT
  (SELECT journal_mode FROM pragma_journal_mode) AS journal_mode,
  (SELECT page_size FROM pragma_page_size) AS page_size,
  (SELECT encoding FROM pragma_encoding) AS encoding,
  (SELECT auto_vacuum FROM pragma_auto_vacuum) AS auto_vacuum,
  (SELECT user_version FROM pragma_user_version) AS user_version`;

async function readThrough(reads: LedgerReads): Promise<FileRead> {
  const integrity = decodeIntegrity(await reads.read(statement`SELECT integrity_check FROM pragma_integrity_check`));
  const [header] = decodeHeader(await reads.read(headerRead));
  const names = decodeNames(
    await reads.read(statement`SELECT name FROM sqlite_schema WHERE type = ${'table'} ORDER BY name`),
  ).map(({ name }) => name);
  const tables = [theSchema, ...names];
  const read = await Promise.all(
    tables.map(async (table): Promise<readonly [string, TableRead]> => [table, await tableRead(reads, table)]),
  );
  return {
    integrity: integrity.map(({ integrity_check }) => integrity_check),
    header,
    tables: Object.fromEntries(read),
  };
}

async function readOf<A>(fileName: string, read: (reads: LedgerReads) => Promise<A>): Promise<A> {
  const reads = sqliteLedgerReads({ fileName });
  try {
    return await read(reads);
  } finally {
    await reads.close();
  }
}

export function fileReadOf(fileName: string): Promise<FileRead> {
  return readOf(fileName, readThrough);
}

interface Writer {
  readonly layout: number;
  readonly sqlite: string;
}

const decodeWriter = Schema.decodeUnknownSync(
  Schema.Tuple([Schema.Struct({ layout: Schema.Number, sqlite: Schema.String })]),
);

export function writerOf(fileName: string): Promise<Writer> {
  return readOf(fileName, async (reads) => {
    const [writer] = decodeWriter(
      await reads.read(statement`SELECT (SELECT layout FROM ledger_layout) AS layout, sqlite_version() AS sqlite`),
    );
    return writer;
  });
}

export function rowCountsOf({ tables }: FileRead): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(tables).map(([table, { rows }]: readonly [string, TableRead]) => [table, rows]),
  );
}
