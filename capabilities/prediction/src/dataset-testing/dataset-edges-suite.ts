import { describe, expect, it } from 'vitest';

import { weeklyOrders, weeklyOrdersWith } from '../testing/weekly-orders.ts';
import { handled, isLive, type Holds } from './dataset-predicates.ts';
import { questionRefusedOn } from './dataset-questions.ts';
import type { SettingsOf } from './dataset-stores.ts';
import { watchingDatasets } from './dataset-watch.ts';
import { keptRowsOf } from './kept-rows.ts';
import { orderPlaced } from './orders.ts';
import { alphaKey, projectedDatasets } from './projected-datasets.ts';

const anyText: unknown = expect.any(String);

const triedOnce: Holds = ({ phase, eventsFolded, tries }) =>
  phase === 'rebuilding' && eventsFolded === 1 && tries === 1;

const triedTwice: Holds = ({ tries }) => tries === 2;

const isStalled: Holds = ({ phase }) => phase === 'stalled';

function notedWith(detail: string): unknown {
  return expect.objectContaining({ detail });
}

const atTheRoot = weeklyOrdersWith(['  time: /placed_at', '  time: event'], ['  series: /region', "  series: ''"]);

const outOfMemory = weeklyOrdersWith([
  '    - type: order.placed',
  `    - type: order.placed\n      data: '\${ $data.total >= 0 || "x".repeat(2 ** 29).length > 0 }'`,
]);

const summed = weeklyOrdersWith(
  ['    - type: order.placed', '    - type: order.placed\n      subject: shop'],
  ['  target: { as: count }', '  target: { of: /total, as: sum }'],
);

const rootRefused = 'Its series at the root of its data is not text of 1 to 256 bytes';

const yearRefused =
  'Its time as an event is not an ISO 8601 time with its offset, on a day of the calendar from 0000 to 9999 and in no leap second';

const timedOrders = [
  orderPlaced({ region: 'north', at: 20_261_006 }),
  orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z' }),
  orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z' }, { time: '0000-01-01T00:00:00+01:00' }),
  orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z' }, { data: 'north' }),
];

const stalledWords: unknown = expect.stringMatching(
  /^Its data test was stopped 3 times without a page folded whole, the last at this event, by a limit of time or memory, which no event causes: /u,
);

const notReadyWords: unknown = expect.stringMatching(
  /^The dataset stopped at an event its data test could not get through/u,
);

const runsOutOfMemoryOnItsSecond = [
  orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z', total: 1 }),
  orderPlaced({ region: 'north', at: '2026-10-06T11:00:00Z', total: -1 }),
  orderPlaced({ region: 'north', at: '2026-10-06T12:00:00Z', total: 2 }),
];

function stoppedTest(settingsOf: SettingsOf): void {
  it('is tried again at each sweep when its data test runs out of memory, counting the tries on its row, and stalls after the tries it may have, never passing the event over', async () => {
    const datasets = await projectedDatasets(await settingsOf(), { triesBeforeStall: 3 });
    const document = await datasets.saved('orders', outOfMemory);
    const { dataSha256 } = document;
    await datasets.published(runsOutOfMemoryOnItsSecond);
    const watch = watchingDatasets();
    datasets.start({ through: watch.through });
    await watch.until(dataSha256, triedOnce);
    await watch.until(dataSha256, triedTwice);
    const row = await datasets.until(dataSha256, isStalled);
    await watch.untilSwept(watch.sweeps() + 2);

    expect(row).toMatchObject({
      eventsFolded: 1,
      passedOver: 0,
      tries: 3,
      stall: { record: anyText, detail: stalledWords },
    });
    expect(datasets.notes()).toEqual([
      { kind: 'dataset_stalled', playbook: alphaKey, dataSha256, record: row.stall?.record, detail: stalledWords },
    ]);
    expect(await questionRefusedOn(datasets.database, document)).toMatchObject({
      kind: 'dataset_not_ready',
      because: 'stalled',
      detail: notReadyWords,
    });
  });
}

function stalledTest(settingsOf: SettingsOf): void {
  it('holds back no other dataset of the playbook when it stalls, nor what the playbook records afterwards', async () => {
    const datasets = await projectedDatasets(await settingsOf(), { triesBeforeStall: 2 });
    const stalling = await datasets.saved('orders', outOfMemory);
    const counting = await datasets.saved(
      'counted',
      weeklyOrdersWith(['  target: { as: count }', '  target: { of: /total, as: sum }']),
    );
    await datasets.published(runsOutOfMemoryOnItsSecond);
    datasets.start();
    const before = await datasets.until(stalling.dataSha256, isStalled);
    await datasets.published([orderPlaced({ region: 'south', at: '2026-10-07T10:00:00Z', total: 4 })]);
    const kept = await datasets.until(counting.dataSha256, handled(4));
    const after = await datasets.until(stalling.dataSha256, isStalled);

    expect([kept.phase, kept.eventsFolded, after.eventsFolded, after.checkpointText]).toEqual([
      'live',
      4,
      1,
      before.checkpointText,
    ]);
  });
}

function attributeTest(settingsOf: SettingsOf): void {
  it('folds nothing an attribute of its filter does not hold, and passes over an event whose target is not a number', async () => {
    const datasets = await projectedDatasets(await settingsOf());
    const { dataSha256 } = await datasets.saved('orders', summed);
    await datasets.published([
      orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z', total: 1 }),
      orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z', total: 'one' }, { subject: 'shop' }),
      orderPlaced({ region: 'north', at: '2026-10-06T10:00:00Z', total: 2 }, { subject: 'shop' }),
    ]);
    datasets.start();
    const row = await datasets.until(dataSha256, handled(2));

    expect([row.eventsFolded, row.passedOver]).toEqual([1, 1]);
    expect(await datasets.noted(1)).toEqual([notedWith('Its target at /total is not a finite number')]);
    expect(await keptRowsOf(datasets.database, dataSha256)).toMatchObject([{ target: 2, target_count: 1 }]);
  });
}

function timeTest(settingsOf: SettingsOf): void {
  it('passes over a time that is not text, an event time before the year 0000 in UTC, and a series at the root of the data that is not text', async () => {
    const datasets = await projectedDatasets(await settingsOf());
    const own = await datasets.saved('orders', weeklyOrders);
    const rooted = await datasets.saved('rooted', atTheRoot);
    await datasets.published(timedOrders);
    datasets.start();
    const timed = await datasets.until(own.dataSha256, handled(4));
    const atRoot = await datasets.until(rooted.dataSha256, handled(4));

    expect([timed.eventsFolded, timed.passedOver, atRoot.eventsFolded, atRoot.passedOver]).toEqual([2, 2, 1, 3]);
    expect(await datasets.noted(5)).toEqual(expect.arrayContaining([notedWith(rootRefused), notedWith(yearRefused)]));
  });
}

function detailsTest(settingsOf: SettingsOf): void {
  it('keeps no dataset for a definition whose details name none, and the datasets of the others', async () => {
    const datasets = await projectedDatasets(await settingsOf());
    await datasets.keptWith('unread', { shape: 'series' });
    const { dataSha256 } = await datasets.saved('orders', weeklyOrders);
    datasets.start();
    await datasets.until(dataSha256, isLive);

    expect((await datasets.datasets()).map((row) => row.dataSha256)).toEqual([dataSha256]);
  });
}

export function datasetEdgesSuite(settingsOf: SettingsOf): void {
  describe('the datasets of prediction functions at their edges', () => {
    stoppedTest(settingsOf);
    stalledTest(settingsOf);
    attributeTest(settingsOf);
    timeTest(settingsOf);
    detailsTest(settingsOf);
  });
}
