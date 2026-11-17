import { runTallyRows } from '@on.auto/operations/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { ledgerLayout } from '../layout/ledger-layout.ts';
import { plainPoolsOn, postgresqlLedgerLayer } from '../postgresql/postgresql-ledger.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { queried } from '../recorded/sqlite-checks.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { postgresqlDatabasesOn } from '../testing/postgresql-databases.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import {
  aPostgreSQLDatabaseFrom,
  aPostgreSQLDatabaseOfTheStore,
  postgresqlLayoutDumpOf,
  structureOfThePostgreSQLDatabase,
  structureOfTheSQLiteFile,
} from './database-floors.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase: aDatabase } = postgresqlDatabasesOn(server);

async function aLedgerOpenedOn(database: string): Promise<void> {
  const { dispose } = await openLedgerWith(
    postgresqlLedgerLayer({ pools: plainPoolsOn(database), projections: [runTallyRows] }),
  );
  await dispose();
}

async function aFileMadeBy(statements: readonly string[]): Promise<string> {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  await inTurn(statements, (statement) => queried(fileName, statement));
  return fileName;
}

describe.skipIf(skipped)(`The floor of a ledger on PostgreSQL${notice}`, () => {
  it('holds the tables and indexes of the layout apart from those of the store, and makes the database again in the structure the ledger left', async () => {
    const [ledger, storeAlone, made] = [await aDatabase(), await aDatabase(), await aDatabase()];
    await aLedgerOpenedOn(ledger);
    await aPostgreSQLDatabaseOfTheStore(storeAlone);

    const floor = await postgresqlLayoutDumpOf(ledger, storeAlone);
    await aPostgreSQLDatabaseFrom(floor, made);

    expect(floor).toMatchObject({
      layout: ledgerLayout,
      kept: [{ table: 'ledger_layout', rows: [{ layout: ledgerLayout }] }],
    });
    expect(floor.made.filter((statement) => statement.startsWith('CREATE TABLE emt_'))).toEqual([]);
    expect(floor.made.some((statement) => statement.startsWith(`CREATE TABLE ${runTallyRows.name}_`))).toBe(true);
    expect(await structureOfThePostgreSQLDatabase(made)).toEqual(await structureOfThePostgreSQLDatabase(ledger));
    expect(await postgresqlLayoutDumpOf(made, storeAlone)).toEqual(floor);
  });
});

describe('the structure of a SQLite database', () => {
  it('is the same for a table a step rebuilt under its name, which SQLite keeps quoted, and an index made again if missing', async () => {
    const [rebuilt, made] = [
      await aFileMadeBy([
        'CREATE TABLE notes_rebuilt (id TEXT NOT NULL PRIMARY KEY, note TEXT, UNIQUE (note))',
        'ALTER TABLE notes_rebuilt RENAME TO notes',
        'CREATE INDEX IF NOT EXISTS notes_by_note ON notes (note)',
      ]),
      await aFileMadeBy([
        'CREATE TABLE notes (id TEXT NOT NULL PRIMARY KEY, note TEXT, UNIQUE (note))',
        'CREATE INDEX notes_by_note ON notes (note)',
      ]),
    ];

    const structure = await structureOfTheSQLiteFile(made);

    expect(await queried(rebuilt, "SELECT sql FROM sqlite_master WHERE name = 'notes'")).toEqual([
      { sql: 'CREATE TABLE "notes" (id TEXT NOT NULL PRIMARY KEY, note TEXT, UNIQUE (note))' },
    ]);
    expect(await structureOfTheSQLiteFile(rebuilt)).toEqual(structure);
    expect(structure).toEqual({
      tables: {
        notes: {
          columns: [
            { name: 'id', type: 'TEXT', required: true, fallback: null },
            { name: 'note', type: 'TEXT', required: false, fallback: null },
          ],
          primaryKey: ['id'],
        },
      },
      indexes: {
        notes_by_note: 'CREATE INDEX notes_by_note ON notes (note)',
        sqlite_autoindex_notes_1: 'UNIQUE (id)',
        sqlite_autoindex_notes_2: 'UNIQUE (note)',
      },
    });
  });
});
