import { describe, expect, it } from 'vitest';

import { namesFound } from '../content/content-tables.ts';
import { structureIn } from '../structure/database-structure-behaviour.ts';
import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import { layoutWritten } from './layout-kept.ts';
import { layoutIn } from './ledger-layout-behaviour.ts';
import { ledgerLayout, ledgerLayoutFloor } from './ledger-layout.ts';
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

const theLayoutThatLeadsTheTreeAndTheIdByTheOrg = 22;

const theTreeByThePlaybook = 'ledger_messages_by_playbook_and_correlation';

const theIdAlone = 'ledger_messages_by_id';

const theTreeByTheOrg = 'ledger_messages_by_org_and_correlation';

const theIdByTheOrg = 'ledger_messages_by_org_and_id';

const theIndexesOfEither = new Set([theTreeByThePlaybook, theIdAlone, theTreeByTheOrg, theIdByTheOrg]);

async function aDatabaseOfTheLayoutBeforeTheOrgsIndexes(entry: LedgerEntry, database: string): Promise<void> {
  await aLedger(entry, database);
  await entry.queried(database, 'DROP TABLE definition_names_1');
  await entry.queried(database, `DROP INDEX ${theTreeByTheOrg}`);
  await entry.queried(database, `DROP INDEX ${theIdByTheOrg}`);
  await entry.queried(database, `CREATE INDEX ${theTreeByThePlaybook} ON emt_messages (stream_id)`);
  await entry.queried(database, `CREATE INDEX ${theIdAlone} ON emt_messages (message_id)`);
  await entry.queried(
    database,
    `UPDATE ledger_layout SET layout = ${String(theLayoutThatLeadsTheTreeAndTheIdByTheOrg - 1)}`,
  );
}

function theOrgsIndexesBehaviour(entry: LedgerEntry): void {
  describe("the ledger's own step to layout 22", () => {
    it("drops the indexes of the tree of a run and of an event's id led by the playbook, and the ledger makes those led by the org and the table of the names of definitions as it opens, as a new database holds them", async () => {
      const database = await entry.aDatabase();
      const made = await entry.aDatabase();
      await aLedger(entry, made);
      await aDatabaseOfTheLayoutBeforeTheOrgsIndexes(entry, database);

      await entry.carriedOn(database, { kept: ledgerLayout, floor: ledgerLayoutFloor, steps: ledgerLayoutSteps });
      const carried = {
        layout: (await layoutIn(entry, database)).layout,
        indexes: Object.keys((await structureIn(entry, database)).indexes),
      };
      await aLedger(entry, database);

      expect(carried.layout).toBe(ledgerLayout);
      expect(carried.indexes.filter((index) => theIndexesOfEither.has(index))).toEqual([]);
      expect(await structureIn(entry, database)).toEqual(await structureIn(entry, made));
    });
  });
}

export function ledgerStepsBehaviour(entry: LedgerEntry): void {
  theOrgsIndexesBehaviour(entry);
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
