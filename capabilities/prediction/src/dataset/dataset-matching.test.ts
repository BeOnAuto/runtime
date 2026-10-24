import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { filterSandboxOf, freshInstances, sandboxModuleIn, sandboxShippedRoots } from '@on.auto/workflow-engine/dsl';
import type { PageEvent } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DatasetData } from './dataset-data.ts';
import { datasetMatchingOf } from './dataset-matching.ts';

const sandboxFiles = shippedFilesOnDisk(sandboxShippedRoots());

const dataNamedFirst: DatasetData = {
  period: 'week',
  events: [
    { data: '${ $data.total > 0 }', type: 'order.placed' },
    { data: '${ $data.refunded.toFixed(0) !== "0" }', type: 'order.refunded' },
  ],
  time: 'event',
  series: '/region',
  target: { as: 'count' },
  features: [],
};

const placed: PageEvent = {
  point: ['1'],
  recordedAt: '2026-10-06T10:00:00.000Z',
  record: 'r-1',
  event: {
    specversion: '1.0',
    id: 'order-1',
    source: '/shop',
    type: 'order.placed',
    time: '2026-10-06T10:00:00Z',
    data: { region: 'north', total: 0 },
  },
};

describe('the matching of a dataset whose filters name their data before their type', () => {
  it('tests an event against the data tests of the filters of its own type alone, matching each type first', async () => {
    const matching = datasetMatchingOf(
      dataNamedFirst,
      filterSandboxOf(freshInstances(await sandboxModuleIn(sandboxFiles)), () => 0),
    );

    const match = await Effect.runPromise(matching.matchOf(placed));
    await matching.close();

    expect(match).toEqual({ kind: 'not_taken' });
  });
});
