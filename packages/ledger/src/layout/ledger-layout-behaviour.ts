import { describe, expect, it } from 'vitest';

import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import { layoutFound, layoutWritten, type FoundLayout } from './layout-kept.ts';
import { LedgerLayoutRefused } from './ledger-layout-refused.ts';
import { ledgerLayout } from './ledger-layout.ts';

const anotherLayout = ledgerLayout + 1;

const whatToDo =
  'Nothing stored before launch is carried over, so delete the local database and start the server again';

export function layoutIn(entry: LedgerEntry, database: string): Promise<FoundLayout> {
  return entry.executedOn(database, (execute) => layoutFound(execute, entry.layout));
}

function stampedWith(entry: LedgerEntry, database: string, layout: number): Promise<void> {
  return entry.executedOn(database, (execute) => layoutWritten(execute, layout));
}

function refusalOf(entry: LedgerEntry, database: string): Promise<unknown> {
  return aLedger(entry, database).catch((error: unknown) => error);
}

export function ledgerLayoutBehaviour(entry: LedgerEntry): void {
  describe('the layout of the ledger', () => {
    it('is written into a database that holds no table, which then opens again in that layout', async () => {
      const database = await entry.aDatabase();
      await aLedger(entry, database);

      await aLedger(entry, database);

      expect((await layoutIn(entry, database)).layout).toBe(ledgerLayout);
    });

    it('refuses a database in another layout, naming the layout found and the one kept, and leaves it as it was', async () => {
      const database = await entry.aDatabase();
      await stampedWith(entry, database, anotherLayout);
      const before = await layoutIn(entry, database);

      const refused = await refusalOf(entry, database);

      expect(refused).toBeInstanceOf(LedgerLayoutRefused);
      expect(refused).toMatchObject({
        found: anotherLayout,
        kept: ledgerLayout,
        message: `The ledger's database is in layout ${anotherLayout} of the ledger, where this server keeps layout ${ledgerLayout}. ${whatToDo}`,
      });
      expect(await layoutIn(entry, database)).toEqual(before);
    });

    it('refuses a database that holds a table but no layout number, and leaves it as it was', async () => {
      const database = await entry.aDatabase();
      await entry.queried(database, 'CREATE TABLE kept_notes (note TEXT)');

      const refused = await refusalOf(entry, database);

      expect(refused).toBeInstanceOf(LedgerLayoutRefused);
      expect(refused).toMatchObject({
        found: undefined,
        kept: ledgerLayout,
        message: `The ledger's database holds tables but no layout number of the ledger, where this server keeps layout ${ledgerLayout}. ${whatToDo}`,
      });
      expect(await layoutIn(entry, database)).toEqual({ layout: undefined, tables: 1 });
    });
  });
}
