import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { describe, expect, it } from 'vitest';

import type { StatementExecutor, TransactionalPool } from '../event-store.ts';
import { ledgerLayout } from './ledger-layout.ts';
import { sqliteLayoutKept } from './sqlite-schema.ts';

function described(sql: SQL): string {
  return SQL.describe(sql, sqliteFormatter).replaceAll(/\s+/gu, ' ').trim();
}

function aPoolHolding(tables: readonly string[]): { readonly pool: TransactionalPool; readonly asked: string[] } {
  const asked: string[] = [];
  const recordedAs = (where: string): StatementExecutor => ({
    query: (sql) => {
      asked.push(`${where}${described(sql)}`);
      return Promise.resolve({ rows: tables.map((name) => ({ name })) });
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
        await handle({ execute: recordedAs('') });
        asked.push('COMMIT');
      },
    },
  };
}

describe('the layout of the ledger on SQLite, as the store migrates', () => {
  it('lists the tables of the schema and writes the layout into a table of one row of a database that holds none, all in one transaction', async () => {
    const { pool, asked } = aPoolHolding([]);

    await sqliteLayoutKept(pool);

    expect(asked).toEqual([
      'BEGIN',
      "SELECT name FROM sqlite_master WHERE type = 'table'",
      'CREATE TABLE ledger_layout ( one_row BOOLEAN NOT NULL PRIMARY KEY DEFAULT TRUE CHECK (one_row), layout INTEGER NOT NULL )',
      `INSERT INTO ledger_layout (layout) VALUES (${ledgerLayout})`,
      'COMMIT',
    ]);
  });
});
