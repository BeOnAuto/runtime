import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import type { StatementExecutor } from '../event-store.ts';

export interface FoundLayout {
  readonly layout: number | undefined;
  readonly tables: number;
}

export interface LayoutDialect {
  readonly found: (execute: StatementExecutor) => Promise<FoundLayout>;
  readonly written: (layout: number) => readonly SQL[];
}

const noLayout = 0;

const NumberedRow = Schema.Tuple([Schema.Struct({ tables: Schema.Number, layout: Schema.Number })]);

export const sqliteLayout: LayoutDialect = {
  found: async (execute) => {
    const { rows } = await execute.query(
      SQL`SELECT (SELECT count(*) FROM sqlite_master WHERE type = 'table') AS tables, user_version AS layout FROM pragma_user_version`,
    );
    const [{ tables, layout }] = Schema.decodeUnknownSync(NumberedRow)(rows);
    return { layout: layout === noLayout ? undefined : layout, tables };
  },
  written: (layout) => [SQL`PRAGMA user_version = ${SQL.plain(String(layout))}`],
};

const layoutTable = 'ledger_layout';

const TablesRow = Schema.Tuple([Schema.Struct({ tables: Schema.Number, numbered: Schema.Boolean })]);

const LayoutRow = Schema.Tuple([Schema.Struct({ layout: Schema.Number })]);

async function layoutKeptIn(execute: StatementExecutor): Promise<number> {
  const { rows } = await execute.query(SQL`SELECT layout FROM ${SQL.identifier(layoutTable)}`);
  const [{ layout }] = Schema.decodeUnknownSync(LayoutRow)(rows);
  return layout;
}

export const postgresqlLayout: LayoutDialect = {
  found: async (execute) => {
    const { rows } = await execute.query(
      SQL`SELECT count(*)::int AS tables, count(*) FILTER (WHERE tablename = ${layoutTable}) > 0 AS numbered
        FROM pg_tables WHERE schemaname = current_schema()`,
    );
    const [{ tables, numbered }] = Schema.decodeUnknownSync(TablesRow)(rows);
    return { layout: numbered ? await layoutKeptIn(execute) : undefined, tables };
  },
  written: (layout) => [
    SQL`CREATE TABLE ${SQL.identifier(layoutTable)} (
      one_row BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (one_row),
      layout INTEGER NOT NULL
    )`,
    SQL`INSERT INTO ${SQL.identifier(layoutTable)} (layout) VALUES (${layout})`,
  ],
};
