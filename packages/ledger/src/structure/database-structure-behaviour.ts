import { describe, expect, it } from 'vitest';

import type { Dialect } from '../connection/ledger-connection.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
import type { DatabaseStructure, StructureRead } from './database-structure.ts';
import { postgresqlStructureOf } from './postgresql-structure.ts';
import { sqliteStructureOf } from './sqlite-structure.ts';

const structureReads: Readonly<Record<Dialect, StructureRead>> = {
  sqlite: sqliteStructureOf,
  postgresql: postgresqlStructureOf,
};

async function aDatabaseMadeBy(entry: LedgerEntry, statements: readonly string[]): Promise<DatabaseStructure> {
  const database = await entry.aDatabase();
  await inTurn(statements, (statement) => entry.queried(database, statement));
  return entry.executedOn(database, structureReads[entry.layout.dialect]);
}

const variants: readonly string[] = [
  'CREATE TABLE base (a TEXT, b INTEGER)',
  'CREATE TABLE of_another_type (a TEXT, b TEXT)',
  'CREATE TABLE required (a TEXT, b INTEGER NOT NULL)',
  'CREATE TABLE defaulted (a TEXT, b INTEGER DEFAULT 1)',
  'CREATE TABLE keyed (a TEXT NOT NULL, b INTEGER, PRIMARY KEY (a))',
];

function readBehaviour(entry: LedgerEntry): void {
  it('reads of each table its columns in order, whether each is required and its default, and its primary key', async () => {
    const structure = await aDatabaseMadeBy(entry, [
      'CREATE TABLE notes (playbook TEXT NOT NULL, id TEXT NOT NULL, n INTEGER DEFAULT 0, note TEXT, PRIMARY KEY (playbook, id))',
      'CREATE INDEX notes_by_n ON notes (n)',
    ]);

    expect(structure.tables['notes']).toMatchObject({
      columns: [
        { name: 'playbook', required: true, fallback: null },
        { name: 'id', required: true, fallback: null },
        { name: 'n', required: false, fallback: '0' },
        { name: 'note', required: false, fallback: null },
      ],
      primaryKey: ['playbook', 'id'],
    });
    expect(structure.indexes['notes_by_n']).toContain('notes_by_n');
  });

  it('is the same for a table a step added a column to and the table a new database makes with that column last', async () => {
    const [stepped, made] = [
      await aDatabaseMadeBy(entry, [
        'CREATE TABLE calls (id TEXT NOT NULL PRIMARY KEY, bytes BIGINT)',
        'ALTER TABLE calls ADD COLUMN tool TEXT',
        'CREATE INDEX calls_by_tool ON calls (tool)',
      ]),
      await aDatabaseMadeBy(entry, [
        'CREATE TABLE calls (id TEXT NOT NULL PRIMARY KEY, bytes BIGINT, tool TEXT)',
        'CREATE INDEX calls_by_tool ON calls (tool)',
      ]),
    ];

    expect(stepped).toEqual(made);
  });
}

function toldApartBehaviour(entry: LedgerEntry): void {
  it('tells a column of another type, nullability or default, and a primary key, from the table without it', async () => {
    const { tables } = await aDatabaseMadeBy(entry, variants);
    const { base, ...others } = tables;

    expect(Object.values(others).filter((table) => JSON.stringify(table) === JSON.stringify(base))).toEqual([]);
    expect(Object.keys(others)).toHaveLength(variants.length - 1);
  });

  it('tells an index of other columns from the index of the same name', async () => {
    const [byA, byB] = [
      await aDatabaseMadeBy(entry, ['CREATE TABLE notes (a TEXT, b TEXT)', 'CREATE INDEX by_note ON notes (a)']),
      await aDatabaseMadeBy(entry, ['CREATE TABLE notes (a TEXT, b TEXT)', 'CREATE INDEX by_note ON notes (b)']),
    ];

    expect(byA.indexes['by_note']).not.toBe(byB.indexes['by_note']);
    expect(byA.tables).toEqual(byB.tables);
  });
}

export function databaseStructureBehaviour(entry: LedgerEntry): void {
  describe('the structure of a database', () => {
    readBehaviour(entry);
    toldApartBehaviour(entry);
  });
}
