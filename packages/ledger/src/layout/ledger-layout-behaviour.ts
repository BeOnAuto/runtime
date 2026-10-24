import { projectedTableOf, type KeyedProjection } from '@on.auto/operations';
import { runTallyRows } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import { layoutFound, layoutWritten, type FoundLayout } from './layout-kept.ts';
import { LedgerLayoutRefused } from './ledger-layout-refused.ts';
import { ledgerLayout } from './ledger-layout.ts';

const anotherLayout = ledgerLayout + 1;

const whatToDo =
  'Nothing stored before launch is carried over, so delete the local database and start the server again';

export function layoutIn(entry: LedgerEntry, database: string): Promise<FoundLayout> {
  return entry.executedOn(database, (execute) => layoutFound(execute, entry.layout, []));
}

function stampedWith(entry: LedgerEntry, database: string, layout: number): Promise<void> {
  return entry.executedOn(database, (execute) => layoutWritten(execute, layout));
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
  it('refuses a database in another layout, naming the layout found and the one kept, and leaves it as it was', async () => {
    const database = await entry.aDatabase();
    await stampedWith(entry, database, anotherLayout);
    const before = await layoutIn(entry, database);

    const refused = await refusalOf(entry, database, []);

    expect(refused).toBeInstanceOf(LedgerLayoutRefused);
    expect(refused).toMatchObject({
      found: anotherLayout,
      kept: ledgerLayout,
      message: `The ledger's database is in layout ${anotherLayout} of the ledger, where this server keeps layout ${ledgerLayout}. ${whatToDo}`,
    });
    expect(await layoutIn(entry, database)).toEqual(before);
  });

  it('refuses a database that holds a table of the store the ledger keeps its streams in, but no layout number, and leaves it as it was', async () => {
    const database = await entry.aDatabase();
    await entry.queried(database, 'CREATE TABLE emt_messages (note TEXT)');

    const refused = await refusalOf(entry, database, []);

    expect(refused).toBeInstanceOf(LedgerLayoutRefused);
    expect(refused).toMatchObject({
      found: undefined,
      kept: ledgerLayout,
      message: `The ledger's database holds tables of the ledger but no layout number, where this server keeps layout ${ledgerLayout}. ${whatToDo}`,
    });
    expect(await layoutIn(entry, database)).toEqual({ layout: undefined, tables: 1 });
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

export function ledgerLayoutBehaviour(entry: LedgerEntry): void {
  describe('the layout of the ledger', () => {
    newDatabasesBehaviour(entry);
    refusedDatabasesBehaviour(entry);
    projectionTablesBehaviour(entry);
  });
}
