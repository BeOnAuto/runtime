import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { describe, expect, it } from 'vitest';

import type { StatementExecutor } from '../event-store.ts';
import { layoutIn } from '../layout/ledger-layout-behaviour.ts';
import { structureIn } from '../structure/database-structure-behaviour.ts';
import { contentTablesOfPlaybooks } from '../testing/content-tables-of-playbooks.ts';
import { aLedger, type LedgerEntry } from '../testing/ledger-entry.ts';
import {
  alpha,
  aStoreOfPlaybooksContent,
  carryingThroughIt,
  chunkKept,
  countedIn,
  earlier,
  headKept,
  layoutBeforeSet,
} from './content-of-playbooks.ts';
import { orgContentCarried, orgContentLayout } from './org-content-step.ts';

function refusedWhereAKeyNamesNoPlaybook(entry: LedgerEntry): void {
  it('refuses a store whose content names a key that is not a playbook’s, and leaves it at the layout before, its heads as they were', async () => {
    const { database } = await aStoreOfPlaybooksContent(entry);
    await headKept(entry, database, { key: 'org/acme/', upload: earlier, keptAt: 10 });

    await expect(entry.carriedOn(database, carryingThroughIt)).rejects.toThrow(
      'The content of the store names org/acme/, which is not the key of a playbook, so it cannot be given to an org; the store stays at the layout before',
    );
    expect((await layoutIn(entry, database)).layout).toBe(orgContentLayout - 1);
    expect(await countedIn(entry, database, 'recorded_content_heads')).toBe(1);
  });
}

function countedAgain(execute: StatementExecutor, wrong: string): StatementExecutor {
  return {
    ...execute,
    query: (sql) =>
      SQL.describe(sql, sqliteFormatter).replaceAll(/\s+/gu, ' ').trim() === wrong
        ? Promise.resolve({ rows: [{ counted: 0 }] })
        : execute.query(sql),
  };
}

function refusedWhereACountDiffers(entry: LedgerEntry): void {
  it('refuses where its contents after the step are not the contents before but the copies it joined, as a statement that kept fewer would leave them', async () => {
    const { database } = await aStoreOfPlaybooksContent(entry);
    await headKept(entry, database, { key: alpha, upload: earlier, keptAt: 10 });
    await chunkKept(entry, database, alpha, earlier);

    const carried = entry.executedOn(database, (execute) =>
      orgContentCarried.inCode(
        countedAgain(execute, 'SELECT COUNT(*) AS counted FROM recorded_content_heads'),
        entry.layout,
      ),
    );

    await expect(carried).rejects.toStrictEqual(
      new Error(
        'The content of the orgs was carried with 0 contents where the store held 1; the store stays at the layout before',
      ),
    );
  });
}

function carriedFromNoContentTables(entry: LedgerEntry): void {
  it('carries a store whose first opening ended before the ledger made its content tables, making them as a new store holds them', async () => {
    const database = await entry.aDatabase();
    await aLedger(entry, database);
    const made = await structureIn(entry, database);
    await contentTablesOfPlaybooks(entry, database);
    await entry.queried(database, 'DROP TABLE recorded_content_heads');
    await entry.queried(database, 'DROP TABLE recorded_content_chunks');
    await layoutBeforeSet(entry, database);

    await entry.carriedOn(database, carryingThroughIt);
    await aLedger(entry, database);

    expect((await layoutIn(entry, database)).layout).toBe(carryingThroughIt.kept);
    expect(await structureIn(entry, database)).toEqual(made);
  });
}

export function orgContentRefusalsBehaviour(entry: LedgerEntry): void {
  describe("the step that gives a playbook's content to its org, where it cannot", () => {
    refusedWhereAKeyNamesNoPlaybook(entry);
    refusedWhereACountDiffers(entry);
  });
  describe("the step that gives a playbook's content to its org, where a store has no content tables", () => {
    carriedFromNoContentTables(entry);
  });
}
