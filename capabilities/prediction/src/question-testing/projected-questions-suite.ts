import { describe, expect, it } from 'vitest';

import type { SettingsOf } from '../dataset-testing/dataset-stores.ts';
import { periodForm } from '../periods/grains.ts';
import {
  gappedVisits,
  meanVisits,
  monthlyTotals,
  newVisits,
  olderVisits,
  orders,
  quarterlyTotals,
  seasonlessVisits,
  tenthVisits,
  totals,
  visits,
  youngMonthlyTotals,
} from './projected-fixtures.ts';
import { projectedSales } from './projected-sales.ts';
import { today } from './suite-clock.ts';

const testTimeoutMs = 120_000;

const someCheckpoint: unknown = expect.any(String);

function dayOf(ago: number): string {
  return periodForm('day', today - ago);
}

function answers(settingsOf: SettingsOf): void {
  it('answers the last periods of its history and every horizon from the dataset as folded now, its record naming the method, the coverage, the season and the history it backtested', async () => {
    const projected = await projectedSales(settingsOf, tenthVisits);

    expect(await projected.asked({ series: 'north' })).toMatchObject({
      status: 'succeeded',
      output: {
        output: {
          unit: 'visits',
          period: 'day',
          origin: dayOf(1),
          lines: [
            {
              name: 'observed',
              points: [4, 3, 2, 1].map((ago) => ({ at: dayOf(ago), value: tenthVisits.valueOf(10, today - ago) })),
            },
            { name: 'predicted', points: [{ at: dayOf(0) }, { at: periodForm('day', today + 1) }] },
          ],
        },
        record: {
          method: 'level-adjusted-seasonal-naive',
          coverage: 0.8,
          season: 7,
          k: 2,
          history: { periods: 24, first_period: dayOf(24), last_period: dayOf(1), origins: 14 },
          decimals: 1,
          origin: dayOf(1),
          dataset_checkpoint: someCheckpoint,
        },
      },
    });
  });
}

function refusals(settingsOf: SettingsOf): void {
  it('is refused for a series its dataset does not hold, and for one whose history is too short to backtest, naming the periods it has and the period from which it answers', async () => {
    const known = await projectedSales(settingsOf, visits);
    const young = await projectedSales(settingsOf, newVisits);

    expect([
      await known.asked({ series: 'east', horizon: 1 }),
      await young.asked({ series: 'north', horizon: 1 }),
    ]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', detail: 'The dataset holds no series "east" in its window' },
      {
        status: 'rejected',
        reason: 'conflict',
        kind: 'history_too_short',
        detail: `The series "north" has 3 periods of history up to ${dayOf(1)}, too few for the forecaster to backtest an answer; ask again from ${dayOf(-2)}`,
      },
    ]);
  });

  it('is refused for a total of the month asked part way through it, naming the first day from which it answers', async () => {
    const young = await projectedSales(settingsOf, youngMonthlyTotals);

    expect(await young.asked({ series: 'north' })).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'history_too_short',
      detail: `The series "north" has 49 periods of history up to ${dayOf(1)}, too few for the forecaster to backtest an answer; ask again from 2026-12-01`,
    });
  });

  it('is refused while its dataset is not made, and fails when its database fails', async () => {
    const projected = await projectedSales(settingsOf, visits);
    projected.read('empty');
    const notReady = await projected.asked({ series: 'north', horizon: 1 });
    projected.read('failing');
    const failed = await projected.asked({ series: 'north', horizon: 1 });

    expect([notReady, failed]).toMatchObject([
      { status: 'rejected', reason: 'unavailable', kind: 'dataset_not_ready' },
      { status: 'failed' },
    ]);
  });
}

function totalsAndWeeks(settingsOf: SettingsOf): void {
  it('answers a total to the end of the enclosing week, backtested as a total at the same day of past weeks', async () => {
    const projected = await projectedSales(settingsOf, totals);

    expect(await projected.asked({ series: 'north' })).toMatchObject({
      status: 'succeeded',
      output: { output: { lines: [{ name: 'observed' }, { name: 'total', points: [{}] }] }, record: {} },
    });
  });

  it('answers a total to the end of the enclosing month and of the enclosing quarter, each backtested at three past ones at the same day', async () => {
    const monthly = await projectedSales(settingsOf, monthlyTotals);
    const quarterly = await projectedSales(settingsOf, quarterlyTotals);

    expect([await monthly.asked({ series: 'north' }), await quarterly.asked({ series: 'north' })]).toMatchObject([
      {
        status: 'succeeded',
        output: {
          output: { lines: [{ name: 'observed' }, { name: 'total', points: [{ at: '2026-10-31' }] }] },
          record: { total_to: '2026-10', history: { periods: 124 } },
        },
      },
      {
        status: 'succeeded',
        output: {
          output: { lines: [{ name: 'observed' }, { name: 'total', points: [{ at: '2026-12-31' }] }] },
          record: { total_to: '2026-Q4', history: { periods: 368 } },
        },
      },
    ]);
  });

  it('carries the last week forward for a weekly function whose history is shorter than its season', async () => {
    const projected = await projectedSales(settingsOf, orders);

    expect(await projected.asked({ series: 'north', horizon: 4 })).toMatchObject({
      status: 'succeeded',
      output: {
        output: { lines: [{}, { points: [{ value: 1, low: 1, high: 1 }] }] },
        record: { method: 'persistence' },
      },
    });
  });
}

const goal = [{ label: 'Goal', value: 12 }];

function seasonsAndGaps(settingsOf: SettingsOf): void {
  it('carries the last value forward for a function that names no season, its record naming none, and answers the marks its question names', async () => {
    const projected = await projectedSales(settingsOf, seasonlessVisits);

    expect(await projected.asked({ series: 'north', horizon: 1, marks: goal })).toMatchObject({
      status: 'succeeded',
      output: { output: { marks: goal }, record: { method: 'persistence', season: null } },
    });
  });

  it('reads a sum from the first day of its window where its series has a row before the window, a day without an event as 0', async () => {
    const projected = await projectedSales(settingsOf, olderVisits);

    expect(await projected.asked({ series: 'north' })).toMatchObject({
      status: 'succeeded',
      output: { record: { history: { periods: 24, first_period: dayOf(24), last_period: dayOf(1) } } },
    });
  });

  it('reads a day without an event as 0 for a sum and as nothing for a mean, and shows no point for nothing', async () => {
    const summed = await projectedSales(settingsOf, gappedVisits);
    const meant = await projectedSales(settingsOf, meanVisits);

    expect([await summed.asked({ series: 'north' }), await meant.asked({ series: 'north' })]).toMatchObject([
      {
        output: {
          output: {
            lines: [{ points: [{ at: dayOf(4) }, { at: dayOf(3) }, { at: dayOf(2), value: 0 }, { at: dayOf(1) }] }, {}],
          },
        },
      },
      { output: { output: { lines: [{ points: [{ at: dayOf(4) }, { at: dayOf(1) }] }, {}] } } },
    ]);
  });
}

export function projectedQuestionsSuite(settingsOf: SettingsOf): void {
  describe('a question over a projected dataset', { timeout: testTimeoutMs }, () => {
    answers(settingsOf);
  });

  describe('a question over a projected dataset that cannot be answered', { timeout: testTimeoutMs }, () => {
    refusals(settingsOf);
  });

  describe('a total and a weekly function over a projected dataset', { timeout: testTimeoutMs }, () => {
    totalsAndWeeks(settingsOf);
  });

  describe('a question over a projected dataset without a season or with gaps', { timeout: testTimeoutMs }, () => {
    seasonsAndGaps(settingsOf);
  });
}
