import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { MessageLane } from '../projections/projection-dialect.ts';
import { sqliteProjectionsOf } from '../projections/sqlite-projections.ts';
import { sqliteEventStore } from '../sqlite-event-store.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';

const decodeBound = Schema.decodeUnknownSync(Schema.Array(Schema.Union([Schema.String, Schema.Number])));

async function aMigratedFile(): Promise<string> {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const store = sqliteEventStore(() => ({ driver: sqlite3EventStoreDriver, fileName }));
  await store.migrate();
  await store.close();
  return fileName;
}

function planOf(fileName: string, statement: SQL): string {
  const { query, params } = SQL.format(statement, sqliteFormatter);
  const database = new DatabaseSync(fileName, { readOnly: true });
  onTestFinished(() => {
    database.close();
  });
  const bound: readonly SQLInputValue[] = decodeBound(params);
  return database
    .prepare(`EXPLAIN QUERY PLAN ${query}`)
    .all(...bound)
    .map((row: Readonly<Record<string, unknown>>) => String(row['detail']))
    .join(' ');
}

describe('the read of the facts of a row a scrub folds again, on SQLite', () => {
  it('reads each lane through the index of its key, from the position after the cursor', async () => {
    const fileName = await aMigratedFile();
    const { dialect } = sqliteProjectionsOf({});
    const planOfALane = (lane: MessageLane) =>
      planOf(fileName, dialect.messagesInOrderAfter('41', 256, { of: 'lane', lane }, ['topic_noted']));

    expect(planOfALane({ by: 'prefix', key: 'playbook/acme/alpha/' })).toMatch(
      /^SEARCH emt_messages USING INDEX ledger_messages_by_playbook \(<expr>=\? AND global_position>\?\)/u,
    );
    expect(planOfALane({ by: 'stream', key: 'playbook/acme/alpha/notes/n1' })).toMatch(
      /^SEARCH emt_messages USING INDEX ledger_messages_by_stream \(stream_id=\? AND global_position>\?\)/u,
    );
  });
});
