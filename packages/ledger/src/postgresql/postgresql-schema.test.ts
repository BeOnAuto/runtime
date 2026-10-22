import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import { describe, expect, it } from 'vitest';

import { contentTableNames } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { ledgerLayout } from '../layout/ledger-layout.ts';
import { emmettsMigrationLock } from './postgresql-run-outcomes.ts';
import { beforeTheSchema, postgresqlSchemaCreated } from './postgresql-schema.ts';

function described(sql: SQL): string {
  return SQL.describe(sql, pgFormatter).replaceAll(/\s+/gu, ' ').trim();
}

function executorFinding(names: readonly string[]): {
  readonly execute: StatementExecutor;
  readonly commands: string[];
} {
  const commands: string[] = [];
  return {
    commands,
    execute: {
      query: () => Promise.resolve({ rows: names.map((name) => ({ name })) }),
      command: (sql) => {
        commands.push(described(sql).split(' (')[0] ?? '');
        return Promise.resolve();
      },
    },
  };
}

const firstContentTable = 'CREATE TABLE IF NOT EXISTS recorded_content_chunks';

const theContentTables = [
  firstContentTable,
  'CREATE TABLE IF NOT EXISTS recorded_content_heads',
  'CREATE TABLE IF NOT EXISTS staged_content_chunks',
  'CREATE TABLE IF NOT EXISTS staged_content',
  'CREATE TABLE IF NOT EXISTS unstaged_runs',
];

const theContentIndexes = [
  'CREATE INDEX IF NOT EXISTS recorded_content_heads_by_upload ON recorded_content_heads',
  'CREATE INDEX IF NOT EXISTS staged_content_by_upload ON staged_content',
];

describe("the ledger's own schema on PostgreSQL", () => {
  it("creates the playbook's indexes, the tables of the content it keeps and their indexes, then the table of its kept secrets, each only when missing", async () => {
    const empty = executorFinding([]);
    const found = executorFinding([
      ...contentTableNames,
      'recorded_content_heads_by_upload',
      'staged_content_by_upload',
      'kept_secrets',
    ]);

    await postgresqlSchemaCreated(empty.execute);
    await postgresqlSchemaCreated(found.execute);
    const indexes = empty.commands.slice(0, empty.commands.indexOf(firstContentTable));

    expect(indexes.filter((command) => command.startsWith('CREATE INDEX IF NOT EXISTS ledger_'))).toHaveLength(7);
    expect(indexes.filter((command) => command.includes('content'))).toEqual([]);
    expect(empty.commands.slice(indexes.length)).toEqual([
      ...theContentTables,
      ...theContentIndexes,
      'CREATE TABLE IF NOT EXISTS kept_secrets',
    ]);
    expect(found.commands.filter((command) => /content|kept_secrets/u.test(command))).toEqual([]);
  });
});

interface Held {
  readonly tables: readonly string[];
  readonly layout?: number;
}

function rowsAnswering(statement: string, { tables, layout }: Held): readonly unknown[] {
  if (statement.includes('pg_try_advisory_xact_lock')) {
    return [{ locked: true }];
  }
  return statement.includes('pg_tables') ? tables.map((name) => ({ name })) : [{ layout }];
}

function aDatabaseHolding(held: Held): { readonly execute: StatementExecutor; readonly asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    execute: {
      query: (sql) => {
        const statement = described(sql);
        asked.push(statement);
        return Promise.resolve({ rows: rowsAnswering(statement, held) });
      },
      command: (sql) => {
        asked.push(described(sql));
        return Promise.resolve();
      },
    },
  };
}

const lockTaken = `SELECT pg_try_advisory_xact_lock(${emmettsMigrationLock}) AS locked`;

const tablesListed = 'SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema()';

describe('the layout of the ledger on PostgreSQL, as the migration begins', () => {
  it('takes the migration lock, then lists the tables of the schema, and writes the layout into a table of one row before any other table of a database that holds none', async () => {
    const { execute, asked } = aDatabaseHolding({ tables: [] });

    await beforeTheSchema({ execute });

    expect(asked).toEqual([
      lockTaken,
      tablesListed,
      'CREATE TABLE ledger_layout ( one_row BOOLEAN NOT NULL PRIMARY KEY DEFAULT TRUE CHECK (one_row), layout INTEGER NOT NULL )',
      `INSERT INTO ledger_layout (layout) VALUES (${ledgerLayout})`,
    ]);
  });

  it('reads the layout of a database that holds its table, and writes nothing when it is the layout kept', async () => {
    const { execute, asked } = aDatabaseHolding({ tables: ['emt_messages', 'ledger_layout'], layout: ledgerLayout });

    await beforeTheSchema({ execute });

    expect(asked).toEqual([lockTaken, tablesListed, 'SELECT layout FROM ledger_layout']);
  });
});
