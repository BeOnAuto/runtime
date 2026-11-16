import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { nodeSqliteDumboDriver } from '@on.auto/node-sqlite';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { MessageLane } from '../projections/projection-dialect.ts';
import { sqliteProjectionsOf } from '../projections/sqlite-projections.ts';
import { sqliteEventStore } from '../sqlite-event-store.ts';
import { onEachSQLiteDriver, type OnASQLiteDriver } from '../testing/sqlite-drivers.ts';

const decodeBound = Schema.decodeUnknownSync(Schema.Array(Schema.Union([Schema.String, Schema.Number])));

async function aMigratedFile({ optionsOf, aDatabaseFile }: OnASQLiteDriver): Promise<string> {
  const fileName = aDatabaseFile();
  const store = sqliteEventStore(() => optionsOf(fileName));
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

describe.each(onEachSQLiteDriver(() => nodeSqliteDumboDriver))(
  'the read of the facts of a row a scrub folds again, on SQLite through $through',
  (sqlite) => {
    it('reads each lane through the index of its key, from the position after the cursor', async () => {
      const fileName = await aMigratedFile(sqlite);
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
  },
);
