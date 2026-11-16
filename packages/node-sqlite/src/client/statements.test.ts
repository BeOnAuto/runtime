import { SQL } from '@event-driven-io/dumbo';
import { describe, expect, it } from 'vitest';

import { aConnectedClient, rowsOf, settled } from '../testing/clients.ts';

describe('the values a client of node:sqlite binds', () => {
  it('are stored as the add-on stored them, a whole number within 32 bits as an integer', async () => {
    const client = await aConnectedClient({});
    await client.command(SQL`CREATE TABLE notes (note TEXT, kept)`);
    await client.command(SQL`INSERT INTO notes (note, kept) VALUES (${5}, ${5})`);
    await client.command(SQL`INSERT INTO notes (note, kept) VALUES (${2 ** 31}, ${true})`);

    expect(await rowsOf(client, 'SELECT note, typeof(note) AS stored, kept, typeof(kept) AS type FROM notes')).toEqual([
      { note: '5', stored: 'text', kept: 5, type: 'integer' },
      { note: '2147483648.0', stored: 'text', kept: 1, type: 'integer' },
    ]);
  });
});

describe('the commands of a client of node:sqlite', () => {
  it('count the rows a statement changed, and none for a statement that changed none', async () => {
    const client = await aConnectedClient({});
    const created = await client.command(SQL`CREATE TABLE notes (note TEXT)`);
    const two = await client.command(SQL`INSERT INTO notes (note) VALUES ('a'), ('b')`);

    const noneMatched = await client.command(SQL`UPDATE notes SET note = 'c' WHERE note = 'z'`);
    const indexed = await client.command(SQL`CREATE INDEX notes_by_note ON notes (note)`);
    const returned = await client.command(SQL`UPDATE notes SET note = upper(note) RETURNING note`);

    expect([created, two, noneMatched, indexed, returned]).toEqual([
      { rowCount: 0, rows: [] },
      { rowCount: 2, rows: [] },
      { rowCount: 0, rows: [] },
      { rowCount: 0, rows: [] },
      { rowCount: 2, rows: [{ note: 'A' }, { note: 'B' }] },
    ]);
  });

  it('answer no count and no rows where told to ignore the count, as the add-on did', async () => {
    const client = await aConnectedClient({});
    await client.command(SQL`CREATE TABLE notes (note TEXT)`);

    const answer = await client.command(SQL`INSERT INTO notes (note) VALUES ('a') RETURNING note`, {
      ignoreChangesCount: true,
    });

    expect(answer).toEqual({ rowCount: 0, rows: [] });
    expect(await rowsOf(client, 'SELECT note FROM notes')).toEqual([{ note: 'a' }]);
  });
});

describe('the batches and failures of the commands of a client of node:sqlite', () => {
  it('run a batch in turn, and refuse it at the first statement that changed nothing where changes are asserted', async () => {
    const client = await aConnectedClient({});
    await client.command(SQL`CREATE TABLE notes (note TEXT)`);
    const nothingDeleted = SQL`DELETE FROM notes WHERE note = 'z'`;
    const changes = await client.batchCommand([SQL`INSERT INTO notes VALUES ('a')`, nothingDeleted]);

    const refusal = await settled(
      client.batchCommand([SQL`INSERT INTO notes VALUES ('b')`, nothingDeleted], { assertChanges: true }),
    );

    expect(changes).toEqual([
      { rowCount: 1, rows: [] },
      { rowCount: 0, rows: [] },
    ]);
    expect(refusal).toMatchObject({
      status: 'rejected',
      reason: { errorType: 'BatchCommandNoChangesError', statementIndex: 1 },
    });
  });

  it('fail as the library maps the error, with the words of the add-on', async () => {
    const client = await aConnectedClient({});
    await client.command(SQL`CREATE TABLE notes (note TEXT UNIQUE)`);
    await client.command(SQL`INSERT INTO notes VALUES ('a')`);

    expect(await settled(client.command(SQL`INSERT INTO notes VALUES ('a')`))).toMatchObject({
      status: 'rejected',
      reason: {
        errorType: 'UniqueConstraintError',
        message: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: notes.note',
      },
    });
  });
});
