import { JSONSerializer, SQL } from '@event-driven-io/dumbo';
import { describe, expect, it } from 'vitest';

import { aConnectedClient, rowsOf, settled } from '../testing/clients.ts';
import { aDatabaseFile } from '../testing/temporary-files.ts';
import { nodeSqliteClient } from './node-sqlite-client.ts';

const todaysPragmas = ['synchronous', 'cache_size', 'foreign_keys', 'temp_store', 'mmap_size', 'journal_mode'];

function messageOf(outcome: Readonly<PromiseSettledResult<unknown>>): string {
  return outcome.status === 'rejected' && outcome.reason instanceof Error ? outcome.reason.message : 'answered';
}

describe('a client of node:sqlite, as it connects', () => {
  it('sets the pragmas of the connection and the journal mode as the add-on’s client set them', async () => {
    const client = await aConnectedClient({
      fileName: aDatabaseFile(),
      pragmaOptions: { cache_size: -8192, mmap_size: 0 },
    });

    const pragmas = await Promise.all(todaysPragmas.map((pragma) => rowsOf(client, `PRAGMA ${pragma}`)));

    expect(pragmas).toEqual([
      [{ synchronous: 1 }],
      [{ cache_size: -8192 }],
      [{ foreign_keys: 1 }],
      [{ temp_store: 2 }],
      [{ mmap_size: 0 }],
      [{ journal_mode: 'wal' }],
    ]);
  });

  it('keeps SQLite’s own wait for a lock at nothing, and waits off the event loop instead', async () => {
    const client = await aConnectedClient({ fileName: aDatabaseFile() });

    expect(await rowsOf(client, 'PRAGMA busy_timeout')).toEqual([{ timeout: 0 }]);
  });

  it('leaves the journal mode of the file as it is when told to skip the pragmas of the database', async () => {
    const client = await aConnectedClient({ fileName: aDatabaseFile(), skipDatabasePragmas: true });

    expect(await rowsOf(client, 'PRAGMA journal_mode')).toEqual([{ journal_mode: 'delete' }]);
  });

  it('opens a file whose journal mode is already the one asked for', async () => {
    const fileName = aDatabaseFile();
    await aConnectedClient({ fileName });

    const again = await aConnectedClient({ fileName });

    expect(await rowsOf(again, 'PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }]);
  });
});

describe('the minimum SQLite a client of node:sqlite is given', () => {
  it('refuses an older SQLite in plain words that name both versions, and closes the file', async () => {
    const client = nodeSqliteClient({
      fileName: aDatabaseFile(),
      minimumSQLiteVersion: '999.0',
      serializer: JSONSerializer,
    });

    const refusal = await settled(client.connect());

    expect(refusal).toMatchObject({ status: 'rejected', reason: { errorCode: 500 } });
    expect(messageOf(refusal)).toMatch(
      /^This Node\.js carries SQLite 3\.\d+\.\d+, and SQLite 999\.0 or later is needed\. Use a Node\.js that carries SQLite 999\.0 or later\.$/u,
    );
    expect(await settled(client.query(SQL`SELECT 1`))).toMatchObject({ reason: { message: 'database is not open' } });
  });

  it('lets the client connect where SQLite is at least that minimum', async () => {
    const client = await aConnectedClient({ minimumSQLiteVersion: '3.43' });

    expect(await rowsOf(client, 'SELECT 1 AS one')).toEqual([{ one: 1 }]);
  });
});
