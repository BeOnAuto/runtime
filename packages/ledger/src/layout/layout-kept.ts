import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import { namesFound } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { LayoutDialect } from './layout-dialects.ts';
import { ledgerLayoutRefused } from './ledger-layout-refused.ts';
import { ledgerLayout } from './ledger-layout.ts';

export interface FoundLayout {
  readonly layout: number | undefined;
  readonly tables: number;
}

const layoutTable = 'ledger_layout';

const LayoutRow = Schema.Tuple([Schema.Struct({ layout: Schema.Number })]);

async function layoutKeptIn(execute: StatementExecutor): Promise<number> {
  const { rows } = await execute.query(SQL`SELECT layout FROM ${SQL.identifier(layoutTable)}`);
  const [{ layout }] = Schema.decodeUnknownSync(LayoutRow)(rows);
  return layout;
}

export async function layoutFound(execute: StatementExecutor, dialect: LayoutDialect): Promise<FoundLayout> {
  const tables = await namesFound(execute, dialect.tablesOfTheSchema());
  return { layout: tables.includes(layoutTable) ? await layoutKeptIn(execute) : undefined, tables: tables.length };
}

export function layoutWritten(execute: StatementExecutor, layout: number): Promise<void> {
  return inTurn(
    [
      SQL`CREATE TABLE ${SQL.identifier(layoutTable)} (
        one_row BOOLEAN NOT NULL PRIMARY KEY DEFAULT TRUE CHECK (one_row),
        layout INTEGER NOT NULL
      )`,
      SQL`INSERT INTO ${SQL.identifier(layoutTable)} (layout) VALUES (${layout})`,
    ],
    (statement) => execute.command(statement),
  );
}

function isNew({ layout, tables }: FoundLayout): boolean {
  return layout === undefined && tables === 0;
}

export async function requireTheLayoutKept(execute: StatementExecutor, dialect: LayoutDialect): Promise<void> {
  const found = await layoutFound(execute, dialect);
  if (found.layout === ledgerLayout) {
    return;
  }
  if (!isNew(found)) {
    throw ledgerLayoutRefused({ found: found.layout, kept: ledgerLayout });
  }
  await layoutWritten(execute, ledgerLayout);
}
