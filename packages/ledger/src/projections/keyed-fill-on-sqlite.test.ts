import { nodeSqliteDumboDriver } from '@on.auto/node-sqlite';
import { describe, onTestFinished } from 'vitest';

import { onEachSQLiteDriver } from '../testing/sqlite-drivers.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { keyedFillBehaviour } from './keyed-fill-behaviour.ts';
import { sqliteProjectionsOf } from './sqlite-projections.ts';

function aDatabase(): Promise<string> {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return Promise.resolve(fileName);
}

describe.each(onEachSQLiteDriver(() => nodeSqliteDumboDriver))(
  'The fills of a ledger on SQLite through $through',
  ({ executedOn, ledgerLayer }) => {
    keyedFillBehaviour({
      aDatabase,
      executedOn,
      ledgerOn: (fileName, { projections, holders }) => ledgerLayer({ fileName, projections, holders }),
      projectionsOf: sqliteProjectionsOf,
    });
  },
);
