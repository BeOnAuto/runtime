import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import type { RunOutcomeMapping } from '@on.auto/operations';
import { memoryLedger, runTallies } from '@on.auto/operations/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { plainPoolsOn, postgresqlLedgerLayer } from '../postgresql/postgresql-ledger.ts';
import { sqliteProjectionsOf } from '../projections/sqlite-projections.ts';
import { openLedgerWith } from '../testing/open-ledger.ts';
import { postgresqlDatabasesOn } from '../testing/postgresql-databases.ts';
import { aRecordedFillOf, mebibyte, type RecordedFill, runIdsOf } from './recorded-fill.ts';
import { fourRuns, fourRunsKept, reading, runOutcomesBehaviour } from './run-outcomes-behaviour.ts';

async function filledOnSQLite(sizes: readonly number[]): Promise<RecordedFill> {
  const fill = aRecordedFillOf(
    sizes,
    (sql) => SQL.describe(sql, sqliteFormatter),
    (json) => json,
    (json) => json,
  );
  await sqliteProjectionsOf({ runOutcomes: runTallies }).prepare(fill.execute, (work) => work(fill.execute));
  return fill;
}

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

describe('the listings of the fill on SQLite', () => {
  it('ask for one run stream, then twice as many after each batch that took them all, up to 100', async () => {
    const fill = await filledOnSQLite(Array.from({ length: 300 }, () => 120));

    expect(fill.listings).toEqual([1, 2, 4, 8, 16, 32, 64, 100, 100]);
    expect(fill.keptRuns()).toEqual(runIdsOf(300));
  });

  it('ask for one again after a run stream that holds more than 16 MiB alone, and keep every run', async () => {
    const fill = await filledOnSQLite([120, 120, 120, 20 * mebibyte, 120, 120, 120, 120, 120, 120]);

    expect(fill.listings).toEqual([1, 2, 4, 1, 2, 4]);
    expect(fill.keptRuns()).toEqual(runIdsOf(10));
  });
});

describe('The in-memory ledger of the application layer', () => {
  runOutcomesBehaviour((runOutcomes) => Promise.resolve(memoryLedger(runOutcomes).service));
});

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
