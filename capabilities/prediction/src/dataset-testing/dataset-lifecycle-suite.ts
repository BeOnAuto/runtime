import { describe, expect, it } from 'vitest';

import { weeklyOrders, weeklyOrdersWith } from '../testing/weekly-orders.ts';
import { anyRow, folded, handled, liveFolded } from './dataset-predicates.ts';
import type { SettingsOf } from './dataset-stores.ts';
import { watchingDatasets } from './dataset-watch.ts';
import { keptRowsOf } from './kept-rows.ts';
import { north, orderPlaced } from './orders.ts';
import { projectedDatasets } from './projected-datasets.ts';

const failedTestWords: unknown = expect.stringMatching(/^Its data test failed: /u);

const dataTestFailed: unknown = expect.objectContaining({ kind: 'record_passed_over', detail: failedTestWords });

const widened = weeklyOrdersWith(['  window: 156', '  window: 160']);

const summed = weeklyOrdersWith(['  target: { as: count }', '  target: { of: /total, as: sum }']);

const described = weeklyOrdersWith([
  'description: Predicts the orders of each region one and four weeks ahead',
  'description: Orders',
]);

const tested = weeklyOrdersWith([
  '    - type: order.placed',
  `    - type: order.placed\n      data: '\${ $data.total.toFixed(0) !== "0" }'`,
]);

function sharingTest(settingsOf: SettingsOf): void {
  it('keeps one dataset for the data part several definitions name, rebuilds nothing for an edit that leaves its rows alone, as a wider window does, builds another for an edit that changes them and drops one once no definition names it', async () => {
    const datasets = await projectedDatasets(await settingsOf());
    const first = await datasets.saved('orders', weeklyOrders);
    await datasets.saved('orders-again', weeklyOrders);
    await datasets.published([north('2026-10-06T10:00:00Z')]);
    datasets.start();
    const before = await datasets.until(first.dataSha256, folded(1));
    await datasets.saved('orders', described);
    const wider = await datasets.saved('orders', widened);
    const second = await datasets.saved('orders', summed);
    await datasets.until(second.dataSha256, liveFolded(1));
    const kept = await datasets.until(first.dataSha256, anyRow);
    await datasets.retired('orders-again');
    await datasets.gone(first.dataSha256);

    expect([before.saved, kept.saved, kept.phase, kept.eventsFolded, kept.rows]).toEqual([1, 1, 'live', 1, 1]);
    expect([wider.dataSha256 === first.dataSha256, second.dataSha256 === first.dataSha256]).toEqual([true, false]);
    expect(await keptRowsOf(datasets.database, first.dataSha256)).toEqual([]);
    expect((await datasets.datasets()).map(({ dataSha256 }) => dataSha256)).toEqual([second.dataSha256]);
  });
}

function slotsTest(settingsOf: SettingsOf): void {
  it('waits for a slot of the rebuilds at once, rebuilds in it and goes live, and keeps its checkpoint over a restart, folding only what came after it', async () => {
    const datasets = await projectedDatasets(await settingsOf(), { rebuildsAtOnce: 1 });
    const first = await datasets.saved('orders', weeklyOrders);
    const second = await datasets.saved('summed-orders', summed);
    await datasets.published([north('2026-10-06T10:00:00Z'), north('2026-10-07T10:00:00Z')]);
    const watch = watchingDatasets();
    datasets.start({ through: watch.through });
    await watch.until(second.dataSha256, liveFolded(2));
    await datasets.stop();
    await datasets.published([north('2026-10-08T10:00:00Z')]);
    const restarted = watchingDatasets();
    datasets.start({ through: restarted.through });
    const after = await datasets.until(first.dataSha256, folded(3));
    await restarted.until(first.dataSha256, folded(3));

    expect(watch.phasesOf(second.dataSha256)).toEqual(['waiting', 'rebuilding', 'live']);
    expect(restarted.phasesOf(first.dataSha256)).toEqual(['live']);
    expect([after.rows, after.series]).toEqual([1, 1]);
  });
}

function dataTestTest(settingsOf: SettingsOf): void {
  it('folds only the events its data test takes, and passes over one whose data test fails', async () => {
    const datasets = await projectedDatasets(await settingsOf());
    const { dataSha256 } = await datasets.saved('orders', tested);
    await datasets.published([
      orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z', total: 3 }),
      orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z', total: 0 }),
      orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z' }),
    ]);
    datasets.start();
    const row = await datasets.until(dataSha256, handled(2));

    expect([row.eventsFolded, row.passedOver]).toEqual([1, 1]);
    expect(await datasets.noted(1)).toEqual([dataTestFailed]);
  });
}

const testedByType = weeklyOrdersWith([
  '    - type: order.placed',
  [
    `    - type: order.placed\n      data: '\${ $data.total.toFixed(0) !== "0" }'`,
    `    - type: order.refunded\n      data: '\${ $data.refunded.toFixed(0) !== "0" }'`,
  ].join('\n'),
]);

function typedTestTest(settingsOf: SettingsOf): void {
  it('tests an event against the data tests of the filters of its own type alone', async () => {
    const datasets = await projectedDatasets(await settingsOf());
    const { dataSha256 } = await datasets.saved('orders', testedByType);
    await datasets.published([
      orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z', total: 0 }),
      orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z', total: 3 }),
    ]);
    datasets.start();
    const row = await datasets.until(dataSha256, liveFolded(1));

    expect([row.eventsFolded, row.passedOver, datasets.notes()]).toEqual([1, 0, []]);
  });
}

export function datasetLifecycleSuite(settingsOf: SettingsOf): void {
  describe('the datasets of prediction functions as their definitions change', () => {
    sharingTest(settingsOf);
    slotsTest(settingsOf);
    dataTestTest(settingsOf);
    typedTestTest(settingsOf);
  });
}
