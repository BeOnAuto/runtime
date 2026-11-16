import { describe, expect, it, onTestFinished } from 'vitest';

import { mostValuesTheLedgerBindsOnSQLite } from '../connection/bound-values.ts';
import { sqliteProjectionsOf } from '../projections/sqlite-projections.ts';
import { executedOn } from '../recorded/sqlite-checks.ts';
import { ledgerLayer } from '../sqlite3.ts';
import { boundedExecutor } from '../testing/bounded-executor.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { temporaryDatabase } from '../testing/temporary-database.ts';
import {
  madeWithANumber,
  ofTheFirstKind,
  ofTheLastKind,
  projectionOfTwentyOneKinds,
  remarked,
  remarksRowsOf,
} from './fact-scrub-on-stores-behaviour.ts';
import { scrubWithin } from './scrubbed-facts.ts';

async function aLedgerOfTwentyOneKinds() {
  const { fileName, remove } = temporaryDatabase();
  onTestFinished(remove);
  const { ledger, dispose } = await openLedgerWith(
    ledgerLayer({ fileName, projections: [projectionOfTwentyOneKinds] }),
  );
  onTestFinished(dispose);
  return { fileName, ledger };
}

describe('the work of a scrub inside its append, on a SQLite that binds at most 100 values in a statement', () => {
  it('folds a row of twenty-one kinds again from the facts of every kind, in the order they were appended', async () => {
    const { fileName, ledger } = await aLedgerOfTwentyOneKinds();
    await remarked(ledger, ofTheFirstKind, { type: 'remark_made', data: { text: 'earlier' } });
    await remarked(ledger, ofTheLastKind, madeWithANumber);
    const scrub = scrubWithin(sqliteProjectionsOf({ projections: [projectionOfTwentyOneKinds] }), ofTheLastKind, {
      position: 1,
      data: { text: '' },
    });

    await executedOn(fileName, (execute) => scrub(boundedExecutor(execute, mostValuesTheLedgerBindsOnSQLite)));

    expect(await remarksRowsOf(ledger)).toMatchObject([{ text: '', remarks: 2, erasures: 0 }]);
  });
});
