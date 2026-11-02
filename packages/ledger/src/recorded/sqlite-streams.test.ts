import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { describe, expect, it, onTestFinished } from 'vitest';

import { sqliteEventStore } from '../sqlite-event-store.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { executedOn, planOf } from './sqlite-checks.ts';
import { sqliteRecordedStore } from './sqlite-recorded.ts';

function aDatabaseFile(): string {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return fileName;
}

const sixStreams = {
  kind: 'streams',
  streams: [
    'org/acme/playbooks',
    'org/acme/playbooks/',
    'org/acme/connections',
    'org/acme/connections/',
    'org/acme/comments',
    'org/acme/comments/',
  ],
} as const;

async function appendedInTurn(fileName: string, streams: readonly string[]): Promise<void> {
  const store = sqliteEventStore(() => ({ driver: sqlite3EventStoreDriver, fileName }));
  await store.migrate();
  await streams.reduce(async (before: Promise<unknown>, stream) => {
    await before;
    return store.append(stream, [{ type: 'noted', data: {} }], {
      expectedVersion: 0,
      context: { at: '2026-11-02T09:00:00.000Z', by: 'tester' },
    });
  }, Promise.resolve());
  await store.close();
}

describe('a read of several streams on SQLite', () => {
  it('reads six streams, whole names and kinds, in one select of no compound, each through its index, in the order they were appended to', async () => {
    const fileName = aDatabaseFile();
    await appendedInTurn(fileName, [
      'org/acme/playbooks',
      'org/acme/connections/first',
      'org/acme/activity/seen',
      'org/acme/comments/first',
      'org/beta/comments/first',
      'org/acme/connections',
      'org/acme/comments/second',
    ]);
    const asked: string[] = [];

    const read = await executedOn(fileName, (execute) =>
      sqliteRecordedStore({
        ...execute,
        query: (sql) => {
          asked.push(SQL.describe(sql, sqliteFormatter));
          return execute.query(sql);
        },
      }).readAppendedFacts(sixStreams, { after: null, most: 100, dataOf: [] }),
    );
    const ofTheStreams = asked.filter((text) => text.includes('stream_id = '));
    const plan = await planOf(fileName, (store) =>
      store.readAppendedFacts(sixStreams, { after: null, most: 100, dataOf: [] }),
    );

    expect(read).toMatchObject({
      held: true,
      facts: [
        { stream: 'org/acme/playbooks' },
        { stream: 'org/acme/connections/first' },
        { stream: 'org/acme/comments/first' },
        { stream: 'org/acme/connections' },
        { stream: 'org/acme/comments/second' },
      ],
    });
    expect(ofTheStreams).toHaveLength(1);
    expect(ofTheStreams.join()).not.toContain('UNION');
    expect(ofTheStreams.join().split('FROM emt_messages')).toHaveLength(2);
    expect(ofTheStreams.join().match(/ = "org\/acme\/[a-z]+\/?"(?: OR|\))/gu)).toHaveLength(6);
    expect(plan).toContain('MULTI-INDEX OR');
    expect(plan.match(/USING INDEX ledger_messages_by_(?:stream|playbook) /gu)).toHaveLength(6);
  });
});
