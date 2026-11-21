import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aSQLiteFile, onPostgreSQLAt, openedOn, type SettingsOf } from '../testing/host-files.ts';
import { describeOnPostgreSQL } from '../testing/postgresql-databases.ts';
import { rowsOf, WholeNumber, type HostDatabase, type ReadStatement } from './host-database.ts';

const rowsTable = statement`CREATE TABLE IF NOT EXISTS read_rows (name TEXT NOT NULL PRIMARY KEY, amount BIGINT NOT NULL)`;

const Figures = Schema.Struct({ amount: WholeNumber, counted: WholeNumber });

const figuresRead = statement`SELECT amount, (SELECT COUNT(*) FROM read_rows) AS counted FROM read_rows WHERE name = ${'north'}`;

function figuresOf(read: ReadStatement) {
  return rowsOf(Figures, read(figuresRead));
}

const raised = statement`UPDATE read_rows SET amount = ${2} WHERE name = ${'north'}`;

const added = statement`INSERT INTO read_rows (name, amount) VALUES (${'south'}, ${5})`;

const inAFile: SettingsOf = () => Promise.resolve({ store: 'sqlite', file: aSQLiteFile() });

async function withOneRow(settings: SettingsOf): Promise<HostDatabase> {
  const database = await openedOn(await settings(), [rowsTable]);
  await Effect.runPromise(database.write(statement`INSERT INTO read_rows (name, amount) VALUES (${'north'}, ${1})`));
  return database;
}

function readsBesideWrites(settings: SettingsOf): void {
  it('reads what was committed when its first read began, and none of what is written while it reads', async () => {
    const database = await withOneRow(settings);

    const read = await Effect.runPromise(
      database.readConsistently((reading) =>
        Effect.gen(function* () {
          const before = yield* figuresOf(reading);
          yield* database.write(raised);
          yield* database.write(added);
          return [...before, ...(yield* figuresOf(reading))];
        }),
      ),
    );

    expect([...read, ...(await Effect.runPromise(figuresOf(database.read)))]).toEqual([
      { amount: 1, counted: 1 },
      { amount: 1, counted: 1 },
      { amount: 2, counted: 2 },
    ]);
  });

  it('fails as its reads fail, and answers what its reads answer', async () => {
    const database = await withOneRow(settings);

    const failure = await Effect.runPromise(
      Effect.flip(database.readConsistently((reading) => reading(statement`SELECT amount FROM nowhere`))),
    );
    const answered = await Effect.runPromise(database.readConsistently(() => Effect.succeed('nothing read')));

    expect([failure.detail, answered]).toEqual([expect.stringContaining('nowhere'), 'nothing read']);
  });
}

describe('the reads of the host database in one snapshot, on SQLite', () => {
  readsBesideWrites(inAFile);
});

describe('the reads of the host database in one snapshot, on SQLite in memory', () => {
  it('hold the one connection of a private database, so a write asked meanwhile lands once they end', async () => {
    const database = await withOneRow(() => Promise.resolve({ store: 'sqlite', file: ':memory:' }));
    const firstRead = Promise.withResolvers<void>();
    const writeAsked = Promise.withResolvers<void>();

    const reading = Effect.runPromise(
      database.readConsistently((read) =>
        Effect.gen(function* () {
          const before = yield* figuresOf(read);
          firstRead.resolve();
          yield* Effect.promise(() => writeAsked.promise);
          return [...before, ...(yield* figuresOf(read))];
        }),
      ),
    );
    await firstRead.promise;
    const writing = Effect.runPromise(database.write(raised));
    writeAsked.resolve();
    const read = await reading;
    await writing;

    expect([...read, ...(await Effect.runPromise(figuresOf(database.read)))]).toEqual([
      { amount: 1, counted: 1 },
      { amount: 1, counted: 1 },
      { amount: 2, counted: 1 },
    ]);
  });
});

describeOnPostgreSQL('the reads of the host database in one snapshot', (aDatabase) => {
  readsBesideWrites(async () => onPostgreSQLAt(await aDatabase()));
});
