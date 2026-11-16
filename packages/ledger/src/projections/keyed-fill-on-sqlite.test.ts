import { describe, onTestFinished } from 'vitest';

import { executedOn } from '../recorded/sqlite-checks.ts';
import { ledgerLayer } from '../sqlite3.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import { keyedFillBehaviour } from './keyed-fill-behaviour.ts';
import { sqliteProjectionsOf } from './sqlite-projections.ts';

function aDatabase(): Promise<string> {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  return Promise.resolve(fileName);
}

describe('The fills of a ledger on SQLite', () => {
  keyedFillBehaviour({
    aDatabase,
    executedOn,
    ledgerOn: (fileName, { projections, holders }) => ledgerLayer({ fileName, projections, holders }),
    projectionsOf: sqliteProjectionsOf,
  });
});
