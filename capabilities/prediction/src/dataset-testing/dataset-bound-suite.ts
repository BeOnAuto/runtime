import { expect, it } from 'vitest';

import type { DatasetRow } from '../dataset/dataset-rows.ts';
import { weeklyOrders } from '../testing/weekly-orders.ts';
import { liveFolded } from './dataset-predicates.ts';
import type { SettingsOf } from './dataset-stores.ts';
import { keptRowsOf, type KeptRow } from './kept-rows.ts';
import { orderPlaced } from './orders.ts';
import { projectedDatasets } from './projected-datasets.ts';

const fewValues = 15;

const knownSeries = Array.from({ length: 16 }, (_, at) => `store-${String(at).padStart(2, '0')}`);

const newSeries = ['store-16', 'store-17', 'store-18', 'store-19'];

function ordersOf(series: readonly string[], mondays: readonly string[]) {
  return series.flatMap((region) => mondays.map((monday) => orderPlaced({ region, at: `${monday}T10:00:00Z` })));
}

const firstPage = ordersOf(knownSeries, ['2026-09-07', '2026-09-14']);

const secondPage = [
  ...ordersOf(knownSeries, ['2026-09-14', '2026-09-21']),
  ...ordersOf(newSeries, ['2026-09-14', '2026-09-21']),
];

interface Folded {
  readonly rows: readonly KeptRow[];
  readonly dataset: Pick<DatasetRow, 'rows' | 'series' | 'eventsFolded'>;
}

async function foldedOn(settingsOf: SettingsOf, mostBoundValues?: number): Promise<Folded> {
  const datasets = await projectedDatasets({ ...(await settingsOf()), mostBoundValues });
  const { dataSha256 } = await datasets.saved('orders', weeklyOrders);
  await datasets.published(firstPage);
  datasets.start();
  await datasets.until(dataSha256, liveFolded(firstPage.length));
  await datasets.published(secondPage);
  const { rows, series, eventsFolded } = await datasets.until(
    dataSha256,
    liveFolded(firstPage.length + secondPage.length),
  );
  expect(datasets.troubles()).toEqual([]);
  return { rows: await keptRowsOf(datasets.database, dataSha256), dataset: { rows, series, eventsFolded } };
}

export function datasetBoundSuite(settingsOf: SettingsOf): void {
  it('folds a page whose reads of stored rows and probe of known series each span several statements within a few bound values, as on the engine’s own bound', async () => {
    const withinFewValues = await foldedOn(settingsOf, fewValues);
    const withinTheEnginesOwn = await foldedOn(settingsOf);

    expect(withinFewValues.dataset).toEqual({ rows: 56, series: 20, eventsFolded: 72 });
    expect(withinFewValues).toEqual(withinTheEnginesOwn);
  });
}
