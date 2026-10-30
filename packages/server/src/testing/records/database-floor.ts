import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { Schema } from 'effect';

const ValueSchema = Schema.Union([Schema.String, Schema.Number, Schema.Null]);

const RowsSchema = Schema.Array(Schema.Record(Schema.String, ValueSchema));

const DatabaseDumpSchema = Schema.Struct({
  layout: Schema.Number,
  made: Schema.Array(Schema.String),
  kept: Schema.Array(Schema.Struct({ table: Schema.String, rows: RowsSchema })),
});

export type DatabaseDump = typeof DatabaseDumpSchema.Type;

export function theSQLiteFloor(): DatabaseDump {
  return Schema.decodeUnknownSync(Schema.fromJsonString(DatabaseDumpSchema))(
    readFileSync(new URL('../../database/database-floor-sqlite.json', import.meta.url), 'utf8'),
  );
}

const tablesOfTheStoresOwnBookkeeping: readonly string[] = ['ledger_layout', 'dmb_migrations'];

const MadeSchema = Schema.Array(Schema.Struct({ sql: Schema.String }));

const LayoutSchema = Schema.Tuple([Schema.Struct({ layout: Schema.Number })]);

const everyTableAndIndexInTheOrderMade =
  "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY rowid";

function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function insertOf(table: string, columns: readonly string[]): string {
  return `INSERT INTO ${quoted(table)} (${columns.map((column) => quoted(column)).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
}

export function databaseDumpOf(file: string): DatabaseDump {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const made = Schema.decodeUnknownSync(MadeSchema)(database.prepare(everyTableAndIndexInTheOrderMade).all());
    const [{ layout }] = Schema.decodeUnknownSync(LayoutSchema)(
      database.prepare('SELECT layout FROM ledger_layout').all(),
    );
    return {
      layout,
      made: made.map(({ sql }) => sql),
      kept: tablesOfTheStoresOwnBookkeeping.map((table) => ({
        table,
        rows: Schema.decodeUnknownSync(RowsSchema)(
          database.prepare(`SELECT * FROM ${quoted(table)} ORDER BY rowid`).all(),
        ),
      })),
    };
  } finally {
    database.close();
  }
}

export function aDatabaseFrom({ made, kept }: DatabaseDump, file: string): void {
  const database = new DatabaseSync(file);
  try {
    for (const sql of made) {
      database.exec(sql);
    }
    for (const { table, rows } of kept) {
      for (const row of rows) {
        database.prepare(insertOf(table, Object.keys(row))).run(...Object.values(row));
      }
    }
  } finally {
    database.close();
  }
}
