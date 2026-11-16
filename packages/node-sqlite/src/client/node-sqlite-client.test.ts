import { join } from 'node:path';

import { JSONSerializer, SQL } from '@event-driven-io/dumbo';
import { describe, expect, it } from 'vitest';

import { aConnectedClient, rowsOf, settled } from '../testing/clients.ts';
import { aDatabaseFile, aTemporaryFolder } from '../testing/temporary-files.ts';
import { nodeSqliteClient } from './node-sqlite-client.ts';

describe('a client of node:sqlite, as it opens', () => {
  it('opens a database in memory when it is given no file, and is connected once however often it is asked', async () => {
    const client = await aConnectedClient({});
    await client.query(SQL`CREATE TABLE notes (note TEXT)`);
    await client.connect();

    expect(await rowsOf(client, "SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([{ name: 'notes' }]);
  });

  it('opens the file a connection string names, with the pragmas the string names', async () => {
    const fileName = aDatabaseFile();
    const client = await aConnectedClient({ connectionString: `file:${fileName}?journal_mode=DELETE` });
    await client.command(SQL`CREATE TABLE notes (note TEXT)`);

    expect(await rowsOf(client, 'PRAGMA journal_mode')).toEqual([{ journal_mode: 'delete' }]);
    expect(await rowsOf(await aConnectedClient({ fileName }), 'SELECT name FROM sqlite_master')).toEqual([
      { name: 'notes' },
    ]);
  });

  it('fails as the library maps a file it cannot open', async () => {
    const client = nodeSqliteClient({
      fileName: join(aTemporaryFolder(), 'missing', 'database.db'),
      serializer: JSONSerializer,
    });

    expect(await settled(client.connect())).toMatchObject({
      status: 'rejected',
      reason: { errorType: 'ConnectionError', message: 'SQLITE_CANTOPEN: unable to open database file' },
    });
  });

  it('answers no statement before it is connected or once it is closed, and closes once', async () => {
    const client = nodeSqliteClient({ serializer: JSONSerializer });
    await client.close();
    const before = await settled(client.query(SQL`SELECT 1`));
    await client.connect();
    await client.close();
    await client.close();

    const notOpen = { status: 'rejected', reason: { errorCode: 500, message: 'database is not open' } };
    expect([before, await settled(client.query(SQL`SELECT 1`))]).toMatchObject([notOpen, notOpen]);
  });
});
