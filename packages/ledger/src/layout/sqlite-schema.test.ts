import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { describe, expect, it } from 'vitest';

import { statement } from '../connection/statement.ts';
import type { StatementExecutor, TransactionalPool } from '../event-store.ts';
import type { LayoutStep } from './layout-steps.ts';
import { ledgerLayout } from './ledger-layout.ts';
import { sqliteLayoutCarried, sqliteLayoutKept } from './sqlite-schema.ts';

function described(sql: SQL): string {
  return SQL.describe(sql, sqliteFormatter).replaceAll(/\s+/gu, ' ').trim();
}

interface Held {
  readonly tables: readonly string[];
  readonly layoutsRead?: readonly number[];
}

function aPoolHolding({ tables, layoutsRead = [] }: Held): {
  readonly pool: TransactionalPool;
  readonly asked: string[];
} {
  const asked: string[] = [];
  const layouts = [...layoutsRead];
  const answerTo = (said: string): readonly unknown[] =>
    said.includes('sqlite_master') ? tables.map((name) => ({ name })) : [{ layout: layouts.shift() }];
  const recordedAs = (where: string): StatementExecutor => ({
    query: (sql) => {
      asked.push(`${where}${described(sql)}`);
      return Promise.resolve({ rows: answerTo(described(sql)) });
    },
    command: (sql) => {
      asked.push(`${where}${described(sql)}`);
      return Promise.resolve();
    },
  });
  return {
    asked,
    pool: {
      execute: recordedAs('outside the transaction: '),
      withTransaction: async (handle) => {
        asked.push('BEGIN');
        const done = await handle({ execute: recordedAs('') });
        asked.push('COMMIT');
        return done;
      },
    },
  };
}

const tablesListed = "SELECT name FROM sqlite_master WHERE type = 'table'";

const layoutRead = 'SELECT layout FROM ledger_layout';

function noted(layout: number): LayoutStep {
  return { layout, statements: [statement`INSERT INTO notes (layout) VALUES (${layout})`] };
}

describe('the layout of the ledger on SQLite, as the store migrates', () => {
  it('lists the tables of the schema and writes the layout into a table of one row of a database that holds none, all in one transaction', async () => {
    const { pool, asked } = aPoolHolding({ tables: [] });

    await sqliteLayoutKept(pool, []);

    expect(asked).toEqual([
      'BEGIN',
      tablesListed,
      'CREATE TABLE ledger_layout ( one_row BOOLEAN NOT NULL PRIMARY KEY DEFAULT TRUE CHECK (one_row), layout INTEGER NOT NULL )',
      `INSERT INTO ledger_layout (layout) VALUES (${ledgerLayout})`,
      'COMMIT',
    ]);
  });

  it('finds the layout of an earlier database in one transaction, then takes each step in a transaction of its own that reads the layout first and writes it last', async () => {
    const { pool, asked } = aPoolHolding({ tables: ['ledger_layout'], layoutsRead: [6, 6, 7] });

    await sqliteLayoutCarried(pool, [], { kept: 8, floor: 6, steps: [noted(8), noted(7)] });

    expect(asked).toEqual([
      'BEGIN',
      tablesListed,
      layoutRead,
      'COMMIT',
      'BEGIN',
      layoutRead,
      'INSERT INTO notes (layout) VALUES (7)',
      'UPDATE ledger_layout SET layout = 7',
      'COMMIT',
      'BEGIN',
      layoutRead,
      'INSERT INTO notes (layout) VALUES (8)',
      'UPDATE ledger_layout SET layout = 8',
      'COMMIT',
    ]);
  });

  it('leaves alone a step that another opening of the database took after the layout was found', async () => {
    const { pool, asked } = aPoolHolding({ tables: ['ledger_layout'], layoutsRead: [6, 7] });

    await sqliteLayoutCarried(pool, [], { kept: 7, floor: 6, steps: [noted(7)] });

    expect(asked.slice(4)).toEqual(['BEGIN', layoutRead, 'COMMIT']);
  });
});
