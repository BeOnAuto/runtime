import { describe, expect, it } from 'vitest';

import { weeklyOrders, weeklyOrdersWith } from '../testing/weekly-orders.ts';
import { folded, liveFolded } from './dataset-predicates.ts';
import type { SettingsOf } from './dataset-stores.ts';
import { keptRowsOf, type KeptRow } from './kept-rows.ts';
import { orderPlaced } from './orders.ts';
import { alphaKey, projectedDatasets } from './projected-datasets.ts';

const anyText: unknown = expect.any(String);

const timeRefused =
  'Its time at /placed_at is not an ISO 8601 time with its offset, on a day of the calendar from 0000 to 9999 and in no leap second';

const seriesRefused = 'Its series at /region is not text of 1 to 256 bytes';

const foldedRows: readonly KeptRow[] = [
  {
    series: 'north',
    period: '2026-W41',
    target: 2,
    target_count: 2,
    events: 2,
    features: [
      [30, 2, null],
      [1, 2, Date.UTC(2026, 9, 6, 10)],
    ],
  },
  {
    series: 'north',
    period: '2026-W42',
    target: 1,
    target_count: 1,
    events: 1,
    features: [
      [30, 1, null],
      [null, 0, null],
    ],
  },
  {
    series: 'south',
    period: '2026-W41',
    target: 1,
    target_count: 1,
    events: 1,
    features: [
      [5, 1, null],
      [null, 0, null],
    ],
  },
];

const ordersOfTwoWeeks = [
  orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z', total: 20, promotion: 1 }),
  orderPlaced({ region: 'north', at: '2026-10-05T10:00:00Z', total: 10, promotion: 0 }),
  orderPlaced({ region: 'south', at: '2026-10-12T00:30:00+01:00', total: 5 }),
  orderPlaced({ region: 'north', at: '2026-10-12T09:00:00Z', total: 30 }),
  orderPlaced({ region: 'west', at: '2026-10-12T09:00:00Z' }, { type: 'order.cancelled' }),
];

const faultyOrders = [
  orderPlaced({ region: 7, at: '2026-10-06T10:00:00Z' }),
  orderPlaced({ region: '', at: '2026-10-06T10:00:00Z' }),
  orderPlaced({ region: 'north', at: 'yesterday' }),
  orderPlaced({ region: 'north', at: '2026-10-06' }),
  orderPlaced({ region: 'north', at: '2016-12-31T23:59:60Z' }),
  orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z', total: 'ten' }),
  orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z', total: 4, promotion: [1] }),
  orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z', total: null }),
];

function noted(dataSha256: string, detail: string) {
  return {
    kind: 'record_passed_over',
    playbook: alphaKey,
    record: anyText,
    reason: 'refused',
    by: `the dataset ${dataSha256.slice(0, 12)}`,
    detail,
  };
}

function foldingTest(settingsOf: SettingsOf): void {
  it('folds the events its filters name into rows by series and week in UTC, counting the target and keeping each feature’s mean and latest value', async () => {
    const datasets = await projectedDatasets(await settingsOf());
    const { dataSha256 } = await datasets.saved('orders', weeklyOrders);
    await datasets.published(ordersOfTwoWeeks);
    datasets.start();
    const row = await datasets.until(dataSha256, liveFolded(4));

    expect(row).toMatchObject({ rows: 3, series: 2, firstPeriod: '2026-W41', lastPeriod: '2026-W42', passedOver: 0 });
    expect(await keptRowsOf(datasets.database, dataSha256)).toEqual(foldedRows);
    expect(datasets.notes()).toEqual([]);
  });
}

function passingOverTest(settingsOf: SettingsOf): void {
  it('passes over an event whose series is not text, whose time is not one, is a day without its time or names a leap second, or whose value is not a finite number, counting and noting each', async () => {
    const datasets = await projectedDatasets(await settingsOf());
    const { dataSha256 } = await datasets.saved('orders', weeklyOrders);
    await datasets.published(faultyOrders);
    datasets.start();
    const row = await datasets.until(dataSha256, folded(1));

    expect([row.passedOver, row.rows]).toEqual([7, 1]);
    expect(await datasets.noted(7)).toEqual([
      noted(dataSha256, seriesRefused),
      noted(dataSha256, seriesRefused),
      noted(dataSha256, timeRefused),
      noted(dataSha256, timeRefused),
      noted(dataSha256, timeRefused),
      noted(dataSha256, 'Its feature basket at /total is not a finite number'),
      noted(dataSha256, 'Its feature promotion at /promotion is not a finite number'),
    ]);
  });
}

function latestTest(settingsOf: SettingsOf): void {
  it('takes the value of the latest event by its time for last, whatever order they were recorded in, and the time of the event itself when told to', async () => {
    const datasets = await projectedDatasets(await settingsOf());
    const { dataSha256 } = await datasets.saved('orders', weeklyOrdersWith(['  time: /placed_at', '  time: event']));
    const later = orderPlaced({ region: 'north', at: 'unread', promotion: 2 }, { time: '2026-10-07T10:00:00Z' });
    const earlier = orderPlaced({ region: 'north', at: 'unread', promotion: 1 }, { time: '2026-10-06T10:00:00Z' });
    await datasets.published([later, earlier]);
    datasets.start();
    await datasets.until(dataSha256, folded(2));

    expect(await keptRowsOf(datasets.database, dataSha256)).toMatchObject([
      {
        series: 'north',
        period: '2026-W41',
        features: [
          [0, 0, null],
          [2, 2, Date.UTC(2026, 9, 7, 10)],
        ],
      },
    ]);
  });
}

export function datasetFoldingSuite(settingsOf: SettingsOf): void {
  describe('the dataset of a prediction function', () => {
    foldingTest(settingsOf);
    passingOverTest(settingsOf);
    latestTest(settingsOf);
  });
}
