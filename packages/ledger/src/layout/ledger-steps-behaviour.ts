import { describe, expect, it } from 'vitest';

import { namesFound } from '../content/content-tables.ts';
import type { LedgerEntry } from '../testing/ledger-entry.ts';
import { layoutWritten } from './layout-kept.ts';
import { layoutIn } from './ledger-layout-behaviour.ts';
import { ledgerLayoutFloor } from './ledger-layout.ts';
import { ledgerLayoutSteps } from './ledger-steps.ts';

const theLayoutThatDropsTheTableOfMemories = 15;

const carryingToIt = {
  kept: theLayoutThatDropsTheTableOfMemories,
  floor: ledgerLayoutFloor,
  steps: ledgerLayoutSteps,
};

async function aDatabaseOfTheLayoutBefore(entry: LedgerEntry): Promise<string> {
  const database = await entry.aDatabase();
  await entry.executedOn(database, (execute) => layoutWritten(execute, theLayoutThatDropsTheTableOfMemories - 1));
  return database;
}

function tablesIn(entry: LedgerEntry, database: string): Promise<readonly string[]> {
  return entry.executedOn(database, (execute) => namesFound(execute, entry.layout.tablesOfTheSchema()));
}

export function ledgerStepsBehaviour(entry: LedgerEntry): void {
  describe("the ledger's own step to layout 15", () => {
    it('drops the table of memories with its index where a database of the layout before holds it, and carries one that holds none all the same', async () => {
      const [holding, without] = [await aDatabaseOfTheLayoutBefore(entry), await aDatabaseOfTheLayoutBefore(entry)];
      await entry.queried(holding, 'CREATE TABLE memories_1 (playbook_key TEXT NOT NULL, row_key TEXT NOT NULL)');
      await entry.queried(holding, 'CREATE INDEX memories_1_by_key ON memories_1 (playbook_key, row_key)');

      await entry.carriedOn(holding, carryingToIt);
      await entry.carriedOn(without, carryingToIt);

      expect(await tablesIn(entry, holding)).not.toContain('memories_1');
      expect([(await layoutIn(entry, holding)).layout, (await layoutIn(entry, without)).layout]).toEqual([
        theLayoutThatDropsTheTableOfMemories,
        theLayoutThatDropsTheTableOfMemories,
      ]);
    });
  });
}
