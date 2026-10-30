import { DatabaseFailed, type HostDatabase } from '@on.auto/workflow-host';
import { Effect, Exit, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { parsePredictionDocument } from '../document/document-parsing.ts';
import { writtenDatasetFiles } from '../files/dataset-files.ts';
import { uploadedWeeklyOrders, weeklyOrdersWith } from '../testing/weekly-orders.ts';
import type { SettingsOf } from './dataset-stores.ts';
import { orderPlaced } from './orders.ts';
import { foldedFor, refusalOf } from './written-files.ts';

const thousandDays = weeklyOrdersWith(
  ['  period: week', '  period: day'],
  ['  season: 52', ''],
  ['  horizons: [1, 4]', '  horizons: [1]'],
  ['  target: { as: count }', '  target: { of: /total, as: last }'],
  ['  window: 156', '  window: 1000'],
  ['  holdout: 12', '  holdout: 8'],
);

const sixteenWeeks = weeklyOrdersWith(
  ['  season: 52', ''],
  ['  window: 156', '  window: 16'],
  ['  holdout: 12', '  holdout: 8'],
);

const sixteenDays = weeklyOrdersWith(
  ['  period: week', '  period: day'],
  ['  season: 52', ''],
  ['  horizons: [1, 4]', '  horizons: [1]'],
  ['  window: 156', '  window: 16'],
  ['  holdout: 12', '  holdout: 8'],
);

const uploaded = Result.getOrThrow(parsePredictionDocument(uploadedWeeklyOrders('c'.repeat(64))));

function daysOf(region: string) {
  return Array.from({ length: 9 }, (_, day) =>
    orderPlaced({ region, at: new Date(Date.UTC(2026, 9, 1 + day, 12)).toISOString(), total: day }),
  );
}

const manySeries = [
  ...Array.from({ length: 201 }, (_, region) => `r${String(region).padStart(3, '0')}`).flatMap((region) =>
    daysOf(region),
  ),
  orderPlaced({ region: 'rare', at: '2026-10-05T12:00:00Z', total: 1 }),
];

const moreSeriesThanABuildTakes = Array.from(
  { length: 1002 },
  (_, region) => `s${String(region).padStart(4, '0')}`,
).flatMap((region) => daysOf(region));

const nineWeeks = Array.from({ length: 9 }, (_, week) =>
  orderPlaced({ region: 'north', at: new Date(Date.UTC(2026, 6, 6 + week * 7, 10)).toISOString(), total: 1 }),
);

function failingAt(database: HostDatabase, start: string): HostDatabase {
  return {
    ...database,
    readConsistently: (reads) =>
      database.readConsistently((read) =>
        reads((statement) =>
          String(statement.strings[0]).startsWith(start)
            ? Effect.fail(new DatabaseFailed({ detail: 'The store was told to fail' }))
            : read(statement),
        ),
      ),
  };
}

function boundsTest(settingsOf: SettingsOf): void {
  it('refuses rows past the 200,000 a build takes, counting only the series observed often enough, and a function that names an uploaded dataset', async () => {
    const { request } = await foldedFor(await settingsOf(), thousandDays, manySeries);

    expect(await refusalOf(request)).toMatchObject({
      refusal: { kind: 'too_large', rows: 201_000, series: 201 },
      detail:
        'The dataset holds 201,000 rows over 201 series and a build takes 200,000 rows over at most 1,000 series; narrow the window or the series',
    });
    expect(await refusalOf({ ...request, document: uploaded })).toMatchObject({ refusal: { kind: 'uploaded' } });
  });
}

function seriesTest(settingsOf: SettingsOf): void {
  it('refuses more series than a build takes, with the figure it counted', async () => {
    const { request } = await foldedFor(await settingsOf(), sixteenDays, moreSeriesThanABuildTakes);

    expect(await refusalOf(request)).toMatchObject({
      refusal: { kind: 'too_large', rows: 16_032, series: 1002 },
      detail:
        'The dataset holds 16,032 rows over 1,002 series and a build takes 200,000 rows over at most 1,000 series; narrow the window or the series',
    });
  });
}

function failedTest(settingsOf: SettingsOf): void {
  it('fails when the store fails while the rows are counted, and while they are written', async () => {
    const { datasets, request } = await foldedFor(await settingsOf(), sixteenWeeks, nineWeeks);
    const failedAt = (start: string) =>
      Effect.runPromiseExit(writtenDatasetFiles({ ...request, database: failingAt(datasets.database, start) }));
    const counting = await failedAt('SELECT COUNT');
    const writing = await failedAt('SELECT period_index');

    expect([Exit.hasDies(counting), Exit.hasDies(writing)]).toEqual([true, true]);
  });
}

export function datasetFilesBoundsSuite(settingsOf: SettingsOf): void {
  describe('the bounds of the files a build reads', () => {
    boundsTest(settingsOf);
    seriesTest(settingsOf);
    failedTest(settingsOf);
  });
}
