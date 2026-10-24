import { DatabaseSync } from 'node:sqlite';

import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { describe, expect, it, onTestFinished } from 'vitest';

import { sqliteEventStore } from '../sqlite-event-store.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import type { IndexExecutor } from './missing-indexes.ts';
import { createSQLitePlaybookIndexes } from './sqlite-indexes.ts';

const playbookIndexes = [
  'ledger_definition_streams',
  'ledger_first_messages_by_kind',
  'ledger_messages_by_id',
  'ledger_messages_by_playbook',
  'ledger_messages_by_playbook_and_correlation',
  'ledger_messages_by_playbook_and_time',
  'ledger_messages_by_stream',
];

function aDatabaseFile(): string {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return fileName;
}

function indexesOf(fileName: string): readonly string[] {
  const database = new DatabaseSync(fileName, { readOnly: true });
  onTestFinished(() => {
    database.close();
  });
  const listed = database
    .prepare(
      "SELECT group_concat(name, ' ') AS names FROM (SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'ledger%' ORDER BY name)",
    )
    .get()?.['names'];
  return String(listed).split(' ');
}

function executorFinding(names: readonly string[]): { readonly execute: IndexExecutor; readonly commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    execute: {
      query: () => Promise.resolve({ rows: names.map((name) => ({ name })) }),
      command: (sql) => {
        commands.push(SQL.describe(sql, sqliteFormatter).replaceAll(/\s+/gu, ' '));
        return Promise.resolve();
      },
    },
  };
}

async function migratedOnce(fileName: string): Promise<void> {
  const store = sqliteEventStore(() => ({ driver: sqlite3EventStoreDriver, fileName }));
  await store.migrate();
  await store.close();
}

describe("the playbook's indexes on SQLite", () => {
  it('are created when the store migrates, as the ledger opens, once however often it migrates', async () => {
    const fileName = aDatabaseFile();
    await migratedOnce(fileName);
    await migratedOnce(fileName);

    expect(indexesOf(fileName)).toEqual(playbookIndexes);
  });

  it('are created only when missing, so a start that finds them issues no CREATE', async () => {
    const present = executorFinding(playbookIndexes);
    const oneMissing = executorFinding(playbookIndexes.filter((name) => name !== 'ledger_messages_by_stream'));

    await createSQLitePlaybookIndexes(present.execute);
    await createSQLitePlaybookIndexes(oneMissing.execute);

    expect([present.commands, oneMissing.commands]).toEqual([
      [],
      ['CREATE INDEX IF NOT EXISTS ledger_messages_by_stream ON emt_messages (stream_id, global_position)'],
    ]);
  });
});

describe('an event store on SQLite given hooks of its own', () => {
  it('keeps its hook, which runs after the schema is created, and still creates the indexes', async () => {
    const fileName = aDatabaseFile();
    const hooked: string[] = [];
    const store = sqliteEventStore(() => ({
      driver: sqlite3EventStoreDriver,
      fileName,
      hooks: {
        onAfterSchemaCreated: () => {
          hooked.push('after the schema');
        },
      },
    }));
    onTestFinished(() => store.close());

    await store.migrate();

    expect([hooked, indexesOf(fileName)]).toEqual([['after the schema'], playbookIndexes]);
  });
});

describe('the read of one message by its id on SQLite', () => {
  it('walks the index on the message id', async () => {
    const fileName = aDatabaseFile();
    await migratedOnce(fileName);
    const database = new DatabaseSync(fileName, { readOnly: true });
    onTestFinished(() => {
      database.close();
    });

    const plan = database
      .prepare(
        "EXPLAIN QUERY PLAN SELECT global_position FROM emt_messages WHERE message_id = 'id' AND partition = 'emt:default'",
      )
      .all()
      .map((row: Readonly<Record<string, unknown>>) => String(row['detail']));

    expect(plan.join(' ')).toContain('USING INDEX ledger_messages_by_id');
  });
});
