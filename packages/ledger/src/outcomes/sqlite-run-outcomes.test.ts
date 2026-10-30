import { SQL } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { runTallies } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { sqliteProjectionsOf } from '../projections/sqlite-projections.ts';
import { aRecordedFillOf, mebibyte, runIdsOf, type RecordedFill } from './recorded-fill.ts';

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
