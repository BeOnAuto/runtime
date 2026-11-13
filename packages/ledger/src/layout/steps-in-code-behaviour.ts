import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { statement } from '../connection/statement.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
import { layoutFound } from './layout-found.ts';
import { layoutWritten } from './layout-kept.ts';
import type { LayoutStep } from './layout-steps.ts';
import { ledgerLayoutBehaviour } from './ledger-layout-behaviour.ts';

const decodeNotes = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ note: Schema.String })));

const notesDerived: LayoutStep = {
  layout: 7,
  statements: [
    statement`CREATE TABLE derived_notes (note TEXT NOT NULL, dialect TEXT NOT NULL)`,
    {
      inCode: async (execute, { dialect }) => {
        const notes = decodeNotes((await execute.query(SQL`SELECT note FROM source_notes ORDER BY note`)).rows);
        await inTurn(notes, ({ note }) =>
          execute.command(SQL`INSERT INTO derived_notes (note, dialect) VALUES (${note.toUpperCase()}, ${dialect})`),
        );
      },
    },
  ],
};

const derivedThenRefused: LayoutStep = {
  layout: 7,
  statements: [
    ...notesDerived.statements,
    { inCode: () => Promise.reject(new Error('The step written in code refused the database')) },
  ],
};

async function aDatabaseWithNotes(entry: LedgerEntry, notes: string): Promise<string> {
  const database = await entry.aDatabase();
  await entry.executedOn(database, (execute) => layoutWritten(execute, 6));
  await entry.queried(database, 'CREATE TABLE source_notes (note TEXT)');
  await entry.queried(database, `INSERT INTO source_notes (note) VALUES ${notes}`);
  return database;
}

function carriedTo7(entry: LedgerEntry, database: string, step: LayoutStep): Promise<void> {
  return entry.carriedOn(database, { kept: 7, floor: 6, steps: [step] });
}

async function layoutOf(entry: LedgerEntry, database: string): Promise<number | undefined> {
  return (await entry.executedOn(database, (execute) => layoutFound(execute, entry.layout, []))).layout;
}

function stepsInCodeBehaviour(entry: LedgerEntry): void {
  describe('a layout step written in code', () => {
    it("runs inside the step's own transaction, given the dialect of its database, so that what it reads and writes is part of the step, and once", async () => {
      const database = await aDatabaseWithNotes(entry, "('b'), ('a')");

      await carriedTo7(entry, database, notesDerived);
      await carriedTo7(entry, database, notesDerived);

      expect(await layoutOf(entry, database)).toBe(7);
      expect(await entry.queried(database, 'SELECT note, dialect FROM derived_notes ORDER BY note')).toEqual([
        { note: 'A', dialect: entry.layout.dialect },
        { note: 'B', dialect: entry.layout.dialect },
      ]);
    });

    it('keeps nothing of a step whose code fails, the statements before it in the same step included, and leaves the database at the step before', async () => {
      const database = await aDatabaseWithNotes(entry, "('a')");

      const refused = carriedTo7(entry, database, derivedThenRefused);

      await expect(refused).rejects.toThrow('The step written in code refused the database');
      expect(await layoutOf(entry, database)).toBe(6);
      await expect(entry.queried(database, 'SELECT note FROM derived_notes')).rejects.toThrow('derived_notes');
    });
  });
}

export function layoutStepsBehaviour(entry: LedgerEntry): void {
  ledgerLayoutBehaviour(entry);
  stepsInCodeBehaviour(entry);
}
