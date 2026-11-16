import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it, onTestFinished } from 'vitest';

import { aDatabaseFile } from '../testing/temporary-files.ts';
import { isBusy, sqliteErrorOf } from './result-codes.ts';

function failureOf(work: () => unknown): unknown {
  try {
    work();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('The work did not fail');
}

function anOpenDatabase(location: string): DatabaseSync {
  const database = new DatabaseSync(location, { timeout: 0 });
  onTestFinished(() => {
    database.close();
  });
  return database;
}

function aUniqueViolation(): unknown {
  const database = anOpenDatabase(':memory:');
  database.exec("CREATE TABLE notes (note TEXT UNIQUE); INSERT INTO notes VALUES ('kept')");
  return failureOf(() => {
    database.exec("INSERT INTO notes VALUES ('kept')");
  });
}

function aBusyFile(): unknown {
  const file = aDatabaseFile();
  const holder = anOpenDatabase(file);
  holder.exec('PRAGMA journal_mode = WAL; CREATE TABLE notes (note TEXT); BEGIN IMMEDIATE');
  return failureOf(() => {
    anOpenDatabase(file).exec('BEGIN IMMEDIATE');
  });
}

function aLockedTable(): unknown {
  const database = anOpenDatabase(':memory:');
  database.exec("CREATE TABLE notes (note TEXT); INSERT INTO notes VALUES ('kept')");
  const reading = database.prepare('SELECT note FROM notes').iterate();
  reading.next();
  const failure = failureOf(() => {
    database.exec('DROP TABLE notes');
  });
  reading.return?.();
  return failure;
}

describe('an error of a statement', () => {
  it('names the primary result code first and keeps what SQLite said, as the add-on did', () => {
    const failure = aUniqueViolation();

    expect(sqliteErrorOf(failure)).toMatchObject({
      message: 'SQLITE_CONSTRAINT: UNIQUE constraint failed: notes.note',
      code: 'SQLITE_CONSTRAINT',
      errno: 19,
      cause: failure,
    });
  });

  it('reads a busy file as SQLITE_BUSY, and a locked table as SQLITE_LOCKED, which is not busy', () => {
    const [busy, locked] = [aBusyFile(), aLockedTable()];

    expect([sqliteErrorOf(busy), sqliteErrorOf(locked)]).toMatchObject([
      { message: 'SQLITE_BUSY: database is locked', code: 'SQLITE_BUSY', errno: 5 },
      { message: 'SQLITE_LOCKED: database table is locked', code: 'SQLITE_LOCKED', errno: 6 },
    ]);
    expect([isBusy(busy), isBusy(locked)]).toEqual([true, false]);
  });

  it('leaves an error that is not a failed statement of SQLite as it is', () => {
    const refused = failureOf(() => anOpenDatabase(':memory:').prepare(''));
    const thrown = new TypeError('not SQLite');

    expect([sqliteErrorOf(refused), sqliteErrorOf(thrown), sqliteErrorOf('a reason')]).toEqual([
      refused,
      thrown,
      'a reason',
    ]);
    expect([isBusy(refused), isBusy(thrown)]).toEqual([false, false]);
  });

  it('leaves a failed statement whose result code SQLite does not list as it is', () => {
    const unlisted = Object.assign(new Error('unlisted'), { code: 'ERR_SQLITE_ERROR', errcode: 99 });

    expect(sqliteErrorOf(unlisted)).toBe(unlisted);
  });
});
