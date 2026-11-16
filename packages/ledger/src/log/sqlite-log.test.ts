import { DatabaseSync } from 'node:sqlite';

import { nodeSqliteDumboDriver } from '@on.auto/node-sqlite';
import { describe, expect, it, onTestFinished } from 'vitest';

import { sqliteLedgerOpened } from '../index.ts';
import { stamped } from '../testing/happenings.ts';
import { onEachSQLiteDriver, type OnASQLiteDriver } from '../testing/sqlite-drivers.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { UnreadableEvent } from './unreadable-event.ts';

async function aLogWithOneEvent({ optionsOf }: OnASQLiteDriver) {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const { store } = sqliteLedgerOpened({
    optionsOf: () => optionsOf(fileName),
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

const sqliteDrivers = onEachSQLiteDriver(() => nodeSqliteDumboDriver);

describe.each(sqliteDrivers)('the log of a ledger on SQLite through $through', (sqlite) => {
  it('refuses to read past an event whose stored data no longer parses, naming where it stopped', async () => {
    const { log, database } = await aLogWithOneEvent(sqlite);
    database.prepare("UPDATE emt_messages SET message_data = '{not json'").run();

    await expect(log.after(undefined, 10)).rejects.toStrictEqual(new UnreadableEvent({ after: undefined }));
  });

  it('passes on any other failure to read as it is', async () => {
    const { log, database } = await aLogWithOneEvent(sqlite);
    database.prepare('DROP TABLE emt_messages').run();

    await expect(log.after(['1'], 10)).rejects.toThrow('no such table');
  });
});
