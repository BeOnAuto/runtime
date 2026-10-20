import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import { describe, expect, it } from 'vitest';

import { contentTables } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { columnsOrNames } from '../secrets/kept-table-columns.ts';
import { postgresqlSchemaCreated } from './postgresql-schema.ts';

function executorFinding(names: readonly string[]): {
  readonly execute: StatementExecutor;
  readonly commands: string[];
} {
  const commands: string[] = [];
  return {
    commands,
    execute: {
      query: (sql) => Promise.resolve({ rows: columnsOrNames(SQL.describe(sql, pgFormatter), names) }),
      command: (sql) => {
        commands.push(SQL.describe(sql, pgFormatter).replaceAll(/\s+/gu, ' ').split(' (')[0] ?? '');
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
      ...contentTables.map(({ name }) => name),
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
