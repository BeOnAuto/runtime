import { SQL } from '@event-driven-io/dumbo';
import { pgFormatter } from '@event-driven-io/dumbo/pg';
import { describe, expect, it } from 'vitest';

import { contentTableNames } from '../content/content-tables.ts';
import type { StatementExecutor } from '../event-store.ts';
import { postgresqlSchemaCreated } from './postgresql-schema.ts';

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

const theContentTables = [firstContentTable, 'CREATE TABLE IF NOT EXISTS recorded_content_heads'];

const theContentIndexes = [
  'CREATE INDEX IF NOT EXISTS recorded_content_heads_by_upload ON recorded_content_heads',
  'CREATE INDEX IF NOT EXISTS recorded_content_heads_expiring ON recorded_content_heads',
];

describe("the ledger's own schema on PostgreSQL", () => {
  it("creates the playbook's indexes, the tables of the content it keeps and their indexes, then the tables of its kept secrets, of the webhooks it received and of the names of definitions, each only when missing", async () => {
    const empty = executorFinding([]);
    const found = executorFinding([
      ...contentTableNames,
      'recorded_content_heads_by_upload',
      'recorded_content_heads_expiring',
      'kept_secrets',
      'webhooks_received',
      'webhooks_received_kept_until',
      'definition_names_1',
      'definition_names_1_by_definition',
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
      'CREATE TABLE IF NOT EXISTS webhooks_received',
      'CREATE INDEX IF NOT EXISTS webhooks_received_kept_until ON webhooks_received',
      'CREATE TABLE IF NOT EXISTS definition_names_1',
      'CREATE UNIQUE INDEX IF NOT EXISTS definition_names_1_by_definition ON definition_names_1',
    ]);
    expect(
      found.commands.filter((command) => /content|kept_secrets|webhooks_received|definition_names/u.test(command)),
    ).toEqual([]);
  });
});
