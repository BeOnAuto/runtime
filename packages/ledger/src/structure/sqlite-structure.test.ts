import { describe, expect, it, onTestFinished } from 'vitest';

import { inTurn } from '../projections/inline-projection.ts';
import { queried } from '../recorded/sqlite-checks.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { structureOfTheSQLiteFile } from './database-floors.ts';

async function aFileMadeBy(statements: readonly string[]): Promise<string> {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  await inTurn(statements, (statement) => queried(fileName, statement));
  return fileName;
}

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
