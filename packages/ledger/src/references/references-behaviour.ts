import { sha256Of } from '@on.auto/content';
import type { LedgerPorts } from '@on.auto/operations';
import { heldNotes, noteHolders, type HeldNote } from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { chunksOf } from '../connection/bound-values.ts';
import { namesFound } from '../content/content-tables.ts';
import { inTurn } from '../projections/inline-projection.ts';
import { aLedger, aLedgerHolding, type LedgerEntry } from '../testing/ledger-entry.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const firstNotes = 'playbook/acme/alpha/notes/n1';

const secondNotes = 'playbook/acme/alpha/notes/n2';

const notesOfTheOrg = 'org/acme/notes/n1';

const HeldStreamRows = Schema.Array(Schema.Struct({ stream: Schema.String, rows: Schema.Number, held: Schema.Number }));

const heldByStream = `SELECT stream, CAST(count(*) AS INTEGER) AS rows, CAST(sum(held) AS INTEGER) AS held
  FROM content_references_1 GROUP BY stream ORDER BY stream`;

function kept(sha256: string): HeldNote {
  return { type: 'note_kept', data: { sha256 } };
}

function noted(ledger: LedgerPorts, stream: string, facts: readonly HeldNote[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, heldNotes, facts));
}

async function heldIn(entry: LedgerEntry, database: string): Promise<typeof HeldStreamRows.Type> {
  return Schema.decodeUnknownSync(HeldStreamRows)(await entry.queried(database, heldByStream));
}

async function referenceTablesIn(entry: LedgerEntry, database: string): Promise<readonly string[]> {
  const tables = await entry.executedOn(database, (execute) => namesFound(execute, entry.layout.tablesOfTheSchema()));
  return tables.filter((table) => table.startsWith('content_references')).toSorted();
}

function filledAsItOpens(entry: LedgerEntry): void {
  it("fills the holds of every fact a database recorded before the ledger was given the facts that hold content, of a playbook's streams alone, as it opens", async () => {
    const database = await entry.aDatabase();
    const before = await aLedger(entry, database);
    const notes = Array.from({ length: 300 }, (_, at) => kept(sha256Of(`note ${String(at)}`)));
    const released = sha256Of('released');
    await inTurn(chunksOf(notes, entry.mostEventsInOneAppend), (facts) => noted(before, firstNotes, facts));
    await noted(before, notesOfTheOrg, [kept(released)]);
    await noted(before, secondNotes, [kept(released), { type: 'notes_closed', data: {} }]);

    const after = await aLedgerHolding(entry, noteHolders, database);

    expect(await heldIn(entry, database)).toEqual([{ stream: 'notes/n1', rows: 300, held: 300 }]);
    expect(await Effect.runPromise(after.removeUnheld(alpha, sha256Of('note 299')))).toBe('held');
    expect(await Effect.runPromise(after.removeUnheld(alpha, released))).toBe('removed');
  });

  it('drops the table of an earlier version of the holds as it makes and fills the one it keeps', async () => {
    const database = await entry.aDatabase();
    await aLedger(entry, database);
    await entry.queried(database, 'CREATE TABLE content_references_0 (playbook_key TEXT)');

    await aLedgerHolding(entry, noteHolders, database);

    expect(await referenceTablesIn(entry, database)).toEqual(['content_references_1']);
  });

  it('finds the table of holds it made and filled before as it opens again, and folds into it', async () => {
    const database = await entry.aDatabase();
    const first = await aLedgerHolding(entry, noteHolders, database);
    await noted(first, firstNotes, [kept(sha256Of('before'))]);

    const again = await aLedgerHolding(entry, noteHolders, database);
    await noted(again, firstNotes, [kept(sha256Of('after'))]);

    expect(await heldIn(entry, database)).toEqual([{ stream: 'notes/n1', rows: 2, held: 2 }]);
  });
}

function keptWithoutHolders(entry: LedgerEntry): void {
  it('keeps an empty table of holds for a ledger told that no fact holds content, and holds nothing', async () => {
    const database = await entry.aDatabase();
    const ledger = await aLedgerHolding(entry, new Map(), database);
    await noted(ledger, firstNotes, [kept(sha256Of('kept'))]);

    expect(await referenceTablesIn(entry, database)).toEqual(['content_references_1']);
    expect(await heldIn(entry, database)).toEqual([]);
    expect(await Effect.runPromise(ledger.removeUnheld(alpha, sha256Of('kept')))).toBe('removed');
  });

  it('makes no table of holds for a ledger opened without the facts that hold content, and removes no content there, as a defect', async () => {
    const database = await entry.aDatabase();
    const ledger = await aLedger(entry, database);

    const removal = await Effect.runPromise(
      Effect.catchDefect(ledger.removeUnheld(alpha, sha256Of('kept')), (defect) => Effect.succeed(String(defect))),
    );

    expect(await referenceTablesIn(entry, database)).toEqual([]);
    expect(removal).toBe(
      'Error: The ledger was opened without the facts that hold content, so it cannot tell a held content from an unheld one and removes none',
    );
  });
}

export function referencesBehaviour(entry: LedgerEntry): void {
  describe('the holds on the content of a playbook, kept in the ledger', () => {
    filledAsItOpens(entry);
    keptWithoutHolders(entry);
  });
}
