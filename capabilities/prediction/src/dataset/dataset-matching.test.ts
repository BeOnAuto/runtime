import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { pageFiltersOn, type JudgedEvent, type MatchedFilter, type PageFilters } from '@on.auto/workflow-engine';
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

const orderOf = (record: string, total: number, type = 'order.placed'): PageEvent => ({
  ...placed,
  record,
  event: { ...placed.event, id: record, type, data: { region: 'north', total } },
});

interface Asked {
  readonly filters: readonly MatchedFilter[];
  readonly events: readonly JudgedEvent[];
}

function answeredBy(answer: PageFilters['verdictsOf']): { readonly filters: PageFilters; readonly asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    filters: {
      verdictsOf: (filters, events) => {
        asked.push({ filters, events });
        return answer(filters, events);
      },
    },
    asked,
  };
}

describe('the matching of a dataset whose filters name their data before their type', () => {
  it('tests an event against the data tests of the filters of its own type alone, matching each type first', async () => {
    const matching = datasetMatchingOf(
      dataNamedFirst,
      pageFiltersOn(filterSandboxOf(freshInstances(await sandboxModuleIn(sandboxFiles)), () => 0)),
    );

    const matched = await Effect.runPromise(matching.matchesOf([placed]));

    expect(matched).toEqual([{ placed, match: { kind: 'not_taken' } }]);
  });
});

describe('the matching of a page of a dataset', () => {
  it('asks the host’s filters for the verdicts of the page’s tested events as one, at the times they were recorded', async () => {
    const host = answeredBy((_, events) => Promise.resolve(events.map(() => [true, false])));
    const page = [orderOf('r-1', 1), orderOf('r-2', 2, 'order.shipped'), orderOf('r-3', 3)];

    const matched = await Effect.runPromise(datasetMatchingOf(dataNamedFirst, host.filters).matchesOf(page));

    expect(matched.map(({ match }) => match.kind)).toEqual(['taken', 'not_taken', 'taken']);
    expect(host.asked).toEqual([
      {
        filters: [
          { reference: '/data/events/0', attributes: { type: 'order.placed', data: '${ $data.total > 0 }' } },
          {
            reference: '/data/events/1',
            attributes: { type: 'order.refunded', data: '${ $data.refunded.toFixed(0) !== "0" }' },
          },
        ],
        events: [page[0], page[2]].map((order) => ({ event: order?.event, now: Date.parse(placed.recordedAt) })),
      },
    ]);
  });

  it('asks nothing of the host for a page none of whose events its data tests judge', async () => {
    const host = answeredBy(() => Promise.reject(new Error('No page is judged')));

    const matched = await Effect.runPromise(
      datasetMatchingOf(dataNamedFirst, host.filters).matchesOf([orderOf('r-1', 1, 'order.shipped')]),
    );

    expect([matched.map(({ match }) => match.kind), host.asked]).toEqual([['not_taken'], []]);
  });
});

describe('the matching of a page of a dataset the host’s filters were stopped at', () => {
  it('ends the page at the first event the host’s filters were stopped at, or answered no verdict of', async () => {
    const stoppedAtTheSecond = answeredBy(() =>
      Promise.resolve([
        [true],
        [{ error: { type: 'about:blank', status: 500, instance: '/data/events/0', title: 'Stopped' }, stopped: true }],
      ]),
    );
    const answeredTheFirst = answeredBy(() => Promise.resolve([[true]]));
    const page = [orderOf('r-1', 1), orderOf('r-2', 2), orderOf('r-3', 3)];

    const stopped = await Effect.runPromise(
      datasetMatchingOf(dataNamedFirst, stoppedAtTheSecond.filters).matchesOf(page),
    );
    const unjudged = await Effect.runPromise(
      datasetMatchingOf(dataNamedFirst, answeredTheFirst.filters).matchesOf(page),
    );

    expect(stopped.map(({ placed: { record }, match }) => [record, match])).toEqual([
      ['r-1', { kind: 'taken' }],
      ['r-2', { kind: 'stopped', detail: 'Stopped' }],
    ]);
    expect(unjudged.map(({ placed: { record }, match }) => [record, match])).toEqual([
      ['r-1', { kind: 'taken' }],
      ['r-2', { kind: 'stopped', detail: 'The filters that test the page were stopped before they judged this event' }],
    ]);
  });
});
