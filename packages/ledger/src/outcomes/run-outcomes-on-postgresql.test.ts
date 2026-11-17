import type { RunOutcomeMapping } from '@on.auto/operations';
import { runTallies } from '@on.auto/operations/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { plainPoolsOn, postgresqlLedgerLayer } from '../postgresql/postgresql-ledger.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { postgresqlDatabasesOn } from '../testing/postgresql-databases.ts';
import { fourRuns, fourRunsKept, reading } from './run-outcomes-behaviour.ts';

const server = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const { skipped, notice, anEmptyDatabase: aDatabase } = postgresqlDatabasesOn(server);

interface Counting {
  readonly mapping: RunOutcomeMapping;
  readonly count: () => number;
}

function counting(): Counting {
  const seen = { count: 0 };
  return {
    mapping: {
      ...runTallies,
      rowAfter: (row, event) => {
        seen.count += 1;
        return runTallies.rowAfter(row, event);
      },
    },
    count: () => seen.count,
  };
}

describe.skipIf(skipped)(`The outcomes of runs on PostgreSQL${notice}`, () => {
  it('are filled once by ledgers that start together, under the lock of the migration', async () => {
    const database = await aDatabase();
    const writing = await openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database) }));
    await fourRuns(writing.ledger);
    await writing.dispose();
    const { mapping, count } = counting();

    const opened = await Promise.all(
      [1, 2, 3].map(() =>
        openLedgerWith(postgresqlLedgerLayer({ pools: plainPoolsOn(database), runOutcomes: mapping })),
      ),
    );
    onTestFinished(async () => {
      await Promise.all(opened.map(({ dispose }) => dispose()));
    });

    expect(count()).toBe(7);
    expect(await Promise.all(opened.map(({ ledger }) => reading(ledger)))).toEqual([
      fourRunsKept,
      fourRunsKept,
      fourRunsKept,
    ]);
  });
});
