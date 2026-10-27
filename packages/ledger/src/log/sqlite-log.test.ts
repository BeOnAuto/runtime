import { DatabaseSync } from 'node:sqlite';

import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { describe, expect, it, onTestFinished } from 'vitest';

import { sqliteLedgerOpened } from '../index.ts';
import { stamped } from '../testing/happenings.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { UnreadableEvent } from './unreadable-event.ts';

async function aLogWithOneEvent() {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const { store } = sqliteLedgerOpened({
    optionsOf: () => ({ driver: sqlite3EventStoreDriver, fileName }),
    inMemory: false,
  });
  onTestFinished(() => store.close());
  await store.migrate();
  await store.append('org/acme/notes', [{ type: 'noted', data: { n: 1 } }], { expectedVersion: 0, context: stamped });
  const database = new DatabaseSync(fileName);
  onTestFinished(() => {
    database.close();
  });
  return { log: store.log, database };
}

describe('the log of a ledger on SQLite', () => {
  it('refuses to read past an event whose stored data no longer parses, naming where it stopped', async () => {
    const { log, database } = await aLogWithOneEvent();
    database.prepare("UPDATE emt_messages SET message_data = '{not json'").run();

    await expect(log.after(undefined, 10)).rejects.toStrictEqual(new UnreadableEvent({ after: undefined }));
  });

  it('passes on any other failure to read as it is', async () => {
    const { log, database } = await aLogWithOneEvent();
    database.prepare('DROP TABLE emt_messages').run();

    await expect(log.after(['1'], 10)).rejects.toThrow('no such table');
  });
});
