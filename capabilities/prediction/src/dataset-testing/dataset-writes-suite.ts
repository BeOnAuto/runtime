import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { datasetsPortOn } from '../dataset/datasets-port.ts';
import { uploadedWeeklyOrders, weeklyOrders, weeklyOrdersWith } from '../testing/weekly-orders.ts';
import { isLive, liveFolded } from './dataset-predicates.ts';
import type { SettingsOf } from './dataset-stores.ts';
import { north } from './orders.ts';
import { alphaKey, projectedDatasets, testDatasetFolder } from './projected-datasets.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const refunds = weeklyOrdersWith(['    - type: order.placed', '    - type: order.refunded']);

function staleWriteTest(settingsOf: SettingsOf): void {
  it('writes nothing once another projector moved its checkpoint first, and keeps no dataset for a function that names an uploaded one', async () => {
    const datasets = await projectedDatasets(await settingsOf());
    const { dataSha256 } = await datasets.saved('orders', weeklyOrders);
    const idle = await datasets.saved('refunds', refunds);
    await datasets.saved('uploaded', uploadedWeeklyOrders('c'.repeat(64)));
    await datasets.published([north('2026-10-06T10:00:00Z')]);
    datasets.start();
    const row = await datasets.until(dataSha256, liveFolded(1));
    const untouched = await datasets.until(idle.dataSha256, isLive);
    await datasets.stop();
    const folder = testDatasetFolder();
    const unchanged = folder.unchanged(row);
    const stale = {
      row: Object.assign({}, row, { checkpointText: '["0"]' }),
      next: Object.assign({}, unchanged.next, { eventsFolded: 9 }),
      upserts: [],
      passedOver: [],
    };
    const writing = { database: datasets.database, playbook: alphaKey, note: datasets.note };

    expect([untouched.firstPeriod, untouched.rows, (await datasets.datasets()).length]).toEqual([null, 0, 2]);
    expect(folder.hasChanged(unchanged)).toBe(false);
    expect(await Effect.runPromise(folder.write(writing, stale))).toBeUndefined();
  });
}

function portTest(settingsOf: SettingsOf): void {
  it('reads a dataset by its digest for the standing of a function', async () => {
    const datasets = await projectedDatasets(await settingsOf());
    const { dataSha256 } = await datasets.saved('orders', weeklyOrders);
    await datasets.published([north('2026-10-06T10:00:00Z')]);
    datasets.start();
    await datasets.until(dataSha256, liveFolded(1));
    const port = datasetsPortOn(datasets.database);

    expect(await Effect.runPromise(port.datasetOf(alpha, dataSha256))).toMatchObject({ eventsFolded: 1 });
    expect(await Effect.runPromise(port.datasetOf(alpha, 'f'.repeat(64)))).toBeUndefined();
  });
}

export function datasetWritesSuite(settingsOf: SettingsOf): void {
  describe('the writes and reads of the datasets of prediction functions', () => {
    staleWriteTest(settingsOf);
    portTest(settingsOf);
  });
}
