import { describe, expect, it, onTestFinished } from 'vitest';

import { executedOn } from '../recorded/sqlite-checks.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { sqliteLayout } from './layout-dialects.ts';
import { layoutFound } from './layout-kept.ts';
import { ledgerLayout } from './ledger-layout.ts';
import { aSQLiteFileInLayout } from './sqlite-file-in-layout.ts';

describe('a SQLite file put in a layout of the ledger', () => {
  it('holds that layout in the table that keeps it, and no other table', async () => {
    const { fileName, remove } = temporaryDatabase();
    onTestFinished(remove);

    await aSQLiteFileInLayout(fileName, ledgerLayout + 1);

    expect(await executedOn(fileName, (execute) => layoutFound(execute, sqliteLayout))).toEqual({
      layout: ledgerLayout + 1,
      tables: 1,
    });
  });
});
