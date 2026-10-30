import { projectedTableOf, type KeyedProjection } from '@on.auto/operations';
import { runTallyRows } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { statement } from '../connection/statement.ts';
import { namesFound } from '../content/content-tables.ts';
import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import { layoutFound, type FoundLayout } from './layout-found.ts';
import { layoutWritten } from './layout-kept.ts';
import type { LayoutCarrying, LayoutStep } from './layout-steps.ts';
import { ledgerLayout, ledgerLayoutFloor } from './ledger-layout.ts';

const aNewerLayout = ledgerLayout + 1;

const anOlderLayout = ledgerLayoutFloor - 1;

const goingForwardOnly = 'Upgrades go forward only, and a newer database wants a newer release of the server';

const notCarried =
  'A database older than that is not carried forward, so delete the local database and start the server again';

function keeping(kept: number, floor: number): string {
  return `where this server keeps layout ${kept} and carries forward no database older than layout ${floor}`;
}

export function layoutIn(entry: LedgerEntry, database: string): Promise<FoundLayout> {
  return entry.executedOn(database, (execute) => layoutFound(execute, entry.layout, []));
}

function stampedWith(entry: LedgerEntry, database: string, layout: number): Promise<void> {
  return entry.executedOn(database, (execute) => layoutWritten(execute, layout));
}

function tablesIn(entry: LedgerEntry, database: string): Promise<readonly string[]> {
  return entry.executedOn(database, (execute) => namesFound(execute, entry.layout.tablesOfTheSchema()));
}

function refusalOf(entry: LedgerEntry, database: string, projections: readonly KeyedProjection[]): Promise<unknown> {
  return aLedger(entry, database, undefined, projections).catch((error: unknown) => error);
}

const projectionsTable = `CREATE TABLE ${projectedTableOf(runTallyRows)} (note TEXT)`;

const earlierTallies = projectedTableOf({ name: runTallyRows.name, version: runTallyRows.version - 1 });

function newDatabasesBehaviour(entry: LedgerEntry): void {
  it('is written into a database that holds no table, which then opens again in that layout', async () => {
    const database = await entry.aDatabase();
    await aLedger(entry, database);

    await aLedger(entry, database);

    expect((await layoutIn(entry, database)).layout).toBe(ledgerLayout);
  });

  it("is written into a database that holds only the tables of others, which are not the ledger's business and stay as they were", async () => {
    const database = await entry.aDatabase();
    await entry.queried(database, 'CREATE TABLE host_bookkeeping (note TEXT)');
    await entry.queried(database, 'CREATE TABLE _platform_values (value TEXT)');
    await entry.queried(database, "INSERT INTO host_bookkeeping (note) VALUES ('kept')");

    await aLedger(entry, database);

    expect((await layoutIn(entry, database)).layout).toBe(ledgerLayout);
    expect(await entry.queried(database, 'SELECT note FROM host_bookkeeping')).toEqual([{ note: 'kept' }]);
    expect(await entry.queried(database, 'SELECT value FROM _platform_values')).toEqual([]);
  });
}

function refusedDatabasesBehaviour(entry: LedgerEntry): void {
  it('refuses a database in a newer layout, naming the layout found and the one kept, and leaves it as it was', async () => {
    const database = await entry.aDatabase();
    await stampedWith(entry, database, aNewerLayout);
    const before = await layoutIn(entry, database);

    const refused = await refusalOf(entry, database, []);

    expect(refused).toMatchObject({
      _tag: 'ledger_layout_refused',
      found: aNewerLayout,
      kept: ledgerLayout,
      floor: ledgerLayoutFloor,
      message: `The ledger's database is in layout ${aNewerLayout} of the ledger, ${keeping(ledgerLayout, ledgerLayoutFloor)}. ${goingForwardOnly}`,
    });
    expect(await layoutIn(entry, database)).toEqual(before);
  });

  it('refuses a database in a layout older than the earliest it carries forward, and leaves it as it was', async () => {
    const database = await entry.aDatabase();
    await stampedWith(entry, database, anOlderLayout);

    const refused = await refusalOf(entry, database, []);

    expect(refused).toMatchObject({
      found: anOlderLayout,
      kept: ledgerLayout,
      floor: ledgerLayoutFloor,
      message: `The ledger's database is in layout ${anOlderLayout} of the ledger, ${keeping(ledgerLayout, ledgerLayoutFloor)}. ${notCarried}`,
    });
    expect((await layoutIn(entry, database)).layout).toBe(anOlderLayout);
  });

  it('refuses a database that holds a table of the store the ledger keeps its streams in, but no layout number, and leaves it as it was', async () => {
    const database = await entry.aDatabase();
    await entry.queried(database, 'CREATE TABLE emt_messages (note TEXT)');

    const refused = await refusalOf(entry, database, []);

    expect(refused).toMatchObject({
      _tag: 'ledger_layout_refused',
      found: undefined,
      kept: ledgerLayout,
      message: `The ledger's database holds tables of the ledger but no layout number, ${keeping(ledgerLayout, ledgerLayoutFloor)}. ${notCarried}`,
    });
    expect(await layoutIn(entry, database)).toEqual({ layout: undefined, tables: ['emt_messages'] });
  });
}

function projectionTablesBehaviour(entry: LedgerEntry): void {
  it('counts as its own the table of a projection it is opened with, and only then', async () => {
    const [refusing, opening] = [await entry.aDatabase(), await entry.aDatabase()];
    await entry.queried(refusing, projectionsTable);
    await entry.queried(opening, projectionsTable);

    const refused = await refusalOf(entry, refusing, [runTallyRows]);
    await aLedger(entry, opening);

    expect(refused).toMatchObject({ found: undefined, kept: ledgerLayout });
    expect((await layoutIn(entry, opening)).layout).toBe(ledgerLayout);
  });

  it('counts as its own the table of an earlier version of a projection it is opened with, and drops nothing of a database it refuses', async () => {
    const database = await entry.aDatabase();
    await entry.queried(database, 'CREATE TABLE host_bookkeeping (note TEXT)');
    await entry.queried(database, `CREATE TABLE ${earlierTallies} (note TEXT)`);
    await entry.queried(database, `INSERT INTO ${earlierTallies} (note) VALUES ('kept')`);

    const refused = await refusalOf(entry, database, [runTallyRows]);

    expect(refused).toMatchObject({ found: undefined, kept: ledgerLayout });
    expect(await entry.queried(database, `SELECT note FROM ${earlierTallies}`)).toEqual([{ note: 'kept' }]);
    expect((await layoutIn(entry, database)).layout).toBeUndefined();
  });
}

const notesMade: LayoutStep = {
  layout: 7,
  statements: [
    statement`CREATE TABLE carried_notes (note TEXT NOT NULL)`,
    statement`INSERT INTO carried_notes (note) VALUES (${'made at 7'})`,
  ],
};

const notesIndexed: LayoutStep = {
  layout: 8,
  statements: [statement`CREATE INDEX carried_notes_by_note ON carried_notes (note)`],
};

const retiredDropped: LayoutStep = { layout: 9, statements: [statement`DROP TABLE retired_notes`] };

const halfMade: LayoutStep = {
  layout: 8,
  statements: [
    statement`CREATE TABLE half_made (note TEXT)`,
    statement`INSERT INTO table_nobody_made (note) VALUES (${'lost'})`,
  ],
};

function carryingTo(kept: number, steps: readonly LayoutStep[]): LayoutCarrying {
  return { kept, floor: 6, steps };
}

async function aDatabaseInLayout(entry: LedgerEntry, layout: number): Promise<string> {
  const database = await entry.aDatabase();
  await stampedWith(entry, database, layout);
  return database;
}

function carriedForwardBehaviour(entry: LedgerEntry): void {
  it('carries a database in an earlier layout forward by each step in turn, to the layout kept, and then has nothing more to do', async () => {
    const database = await aDatabaseInLayout(entry, 6);
    await entry.queried(database, 'CREATE TABLE retired_notes (note TEXT)');
    const carrying = carryingTo(9, [retiredDropped, notesIndexed, notesMade]);

    await entry.carriedOn(database, carrying);
    await entry.carriedOn(database, carrying);

    expect((await layoutIn(entry, database)).layout).toBe(9);
    expect(await entry.queried(database, 'SELECT note FROM carried_notes')).toEqual([{ note: 'made at 7' }]);
    expect(await tablesIn(entry, database)).not.toContain('retired_notes');
  });

  it('takes each step in a transaction of its own, so a step the database refuses leaves it at the step before, with none of that step done', async () => {
    const database = await aDatabaseInLayout(entry, 6);

    const refused = entry.carriedOn(database, carryingTo(9, [notesMade, halfMade, retiredDropped]));

    await expect(refused).rejects.toThrow('table_nobody_made');
    expect((await layoutIn(entry, database)).layout).toBe(7);
    expect(await tablesIn(entry, database)).toContain('carried_notes');
    expect(await tablesIn(entry, database)).not.toContain('half_made');
  });

  it('runs the statement a step writes for the dialect of its database where the dialects differ', async () => {
    const database = await aDatabaseInLayout(entry, 6);
    const marked: LayoutStep = {
      layout: 7,
      statements: [
        statement`CREATE TABLE marks (dialect TEXT)`,
        {
          sqlite: statement`INSERT INTO marks (dialect) VALUES (${'sqlite'})`,
          postgresql: statement`INSERT INTO marks (dialect) VALUES (${'postgresql'})`,
        },
      ],
    };

    await entry.carriedOn(database, carryingTo(7, [marked]));

    expect(await entry.queried(database, 'SELECT dialect FROM marks')).toEqual([{ dialect: entry.layout.dialect }]);
  });
}

function carriedForwardOnlyBehaviour(entry: LedgerEntry): void {
  it('takes each step once when two open the database together', async () => {
    const database = await aDatabaseInLayout(entry, 6);
    await entry.queried(database, 'CREATE TABLE counted (n INTEGER)');
    const counting: LayoutStep = { layout: 7, statements: [statement`INSERT INTO counted (n) VALUES (${7})`] };
    const carrying = carryingTo(7, [counting]);

    await Promise.all([entry.carriedOn(database, carrying), entry.carriedOn(database, carrying)]);

    expect(await entry.queried(database, 'SELECT n FROM counted')).toEqual([{ n: 7 }]);
  });

  it('takes no step when it misses one it needs, and says which', async () => {
    const database = await aDatabaseInLayout(entry, 6);

    const refused = entry.carriedOn(database, carryingTo(9, [notesMade, retiredDropped]));

    await expect(refused).rejects.toThrow(
      'The ledger was given 0 steps to layout 8 of its database, where it takes exactly one',
    );
    expect((await layoutIn(entry, database)).layout).toBe(6);
    expect(await tablesIn(entry, database)).not.toContain('carried_notes');
  });

  it('refuses a database newer than the layout kept, or older than the earliest it carries forward, and leaves it as it was', async () => {
    const [newer, older] = [await aDatabaseInLayout(entry, 10), await aDatabaseInLayout(entry, 5)];
    const carrying = carryingTo(9, [notesMade, notesIndexed, retiredDropped]);

    const refusals = await Promise.all(
      [newer, older].map((database) => entry.carriedOn(database, carrying).catch((error: unknown) => error)),
    );

    expect(refusals).toMatchObject([
      {
        found: 10,
        kept: 9,
        floor: 6,
        message: `The ledger's database is in layout 10 of the ledger, ${keeping(9, 6)}. ${goingForwardOnly}`,
      },
      {
        found: 5,
        kept: 9,
        floor: 6,
        message: `The ledger's database is in layout 5 of the ledger, ${keeping(9, 6)}. ${notCarried}`,
      },
    ]);
    expect([(await layoutIn(entry, newer)).layout, (await layoutIn(entry, older)).layout]).toEqual([10, 5]);
  });
}

export function ledgerLayoutBehaviour(entry: LedgerEntry): void {
  describe('the layout of the ledger', () => {
    newDatabasesBehaviour(entry);
    refusedDatabasesBehaviour(entry);
    projectionTablesBehaviour(entry);
    carriedForwardBehaviour(entry);
    carriedForwardOnlyBehaviour(entry);
  });
}
