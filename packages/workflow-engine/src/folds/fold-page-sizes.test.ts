import { describe, expect, it } from 'vitest';

import type { Json, JsonObject } from '../dsl/json.ts';
import type { InstanceSource } from '../instances/instance-source.ts';
import { folded, pageOf, viewOf } from '../pool-testing/fold-pages.ts';
import { sourcesUnderTest } from '../pool-testing/test-pools.ts';

interface Folding {
  readonly view: Json;
  readonly work: number;
  readonly works: readonly number[];
  readonly stalledAt?: number;
}

const sizesTestTimeoutMs = 120_000;

const startedAt = Date.parse('2026-10-01T09:00:00.000Z');

const rowsAcrossTwoPagesOfAHundred = 201;

const rowsAcrossThreePagesOfSeven = 22;

const recorded: readonly JsonObject[] = Array.from({ length: rowsAcrossTwoPagesOfAHundred }, (_, index) => ({
  type: 'run_succeeded',
  subject: 'reasoning/review-brief',
  source: '/runs/run',
  time: new Date(startedAt + index * 1000).toISOString(),
  data: { output: { n: index } },
}));

const working = [
  'export function fold(view, event) {',
  '  const { n } = event.data.output;',
  '  let spent = 0;',
  '  for (let step = 0; step < 7000 + (n % 13) * 500; step++) spent += step % 3;',
  '  return { folds: view.folds + 1, spent: (view.spent + spent) % 1000003 };',
  '}',
].join('\n');

const swelling = [
  'export function fold(view, event) {',
  '  const { n } = event.data.output;',
  '  return n === 150 ? { folds: view.folds + 1, swell: "x".repeat(600000) } : { folds: view.folds + 1 };',
  '}',
].join('\n');

const before: Folding = { view: { folds: 0, spent: 0 }, work: 0, works: [] };

interface Paging {
  readonly source: InstanceSource;
  readonly fold: string;
  readonly size: number;
  readonly count: number;
}

function pagesOf(source: InstanceSource, fold: string, size: number, count = rowsAcrossTwoPagesOfAHundred): Paging {
  return { source, fold, size, count };
}

async function pageFolded(source: InstanceSource, fold: string, view: Json, events: readonly JsonObject[]) {
  const page = await folded(
    source,
    pageOf([viewOf(fold, { view, events: events.map((_, index) => index) })], { events }),
  );
  return page.views[0];
}

async function foldedInPages(paging: Paging, from = before, start = 0): Promise<Folding> {
  if (start >= paging.count) {
    return from;
  }
  const events = recorded.slice(start, Math.min(start + paging.size, paging.count));
  const result = await pageFolded(paging.source, paging.fold, from.view, events);
  const pageWork = result?.work ?? 0;
  const spent = { work: from.work + pageWork, works: [...from.works, pageWork] };
  return result?.stall === undefined
    ? foldedInPages(paging, { view: result?.view ?? null, ...spent }, start + paging.size)
    : { view: result.view, ...spent, stalledAt: start + result.stall.at };
}

function sumsOf(works: readonly number[], size: number): readonly number[] {
  return Array.from({ length: Math.ceil(works.length / size) }, (_, page) =>
    works.slice(page * size, page * size + size).reduce((sum, work) => sum + work, 0),
  );
}

describe.each(sourcesUnderTest)(
  'the folds of one view over 201 events on $name instances',
  { timeout: sizesTestTimeoutMs },
  ({ source }) => {
    it('give the same view and spend the same checkpoints in pages of 7 as in pages of 100', async () => {
      const [seven, hundred] = [
        await foldedInPages(pagesOf(source, working, 7)),
        await foldedInPages(pagesOf(source, working, 100)),
      ];

      expect(hundred.work).toBeGreaterThan(rowsAcrossTwoPagesOfAHundred);
      expect([seven.view, seven.work]).toEqual([hundred.view, hundred.work]);
      expect(hundred.view).toMatchObject({ folds: rowsAcrossTwoPagesOfAHundred });
    });

    it('spend in each page of 7 and of 100 what its folds spend in pages of one event each, more than nothing for every fold', async () => {
      const eachFold = (await foldedInPages(pagesOf(source, working, 1, rowsAcrossThreePagesOfSeven))).works;
      const sevens = (await foldedInPages(pagesOf(source, working, 7, rowsAcrossThreePagesOfSeven))).works;
      const hundred = (await foldedInPages(pagesOf(source, working, 100, rowsAcrossThreePagesOfSeven))).works;

      expect(Math.min(...eachFold)).toBeGreaterThan(0);
      expect([sevens, hundred]).toEqual([sumsOf(eachFold, 7), sumsOf(eachFold, 100)]);
    });

    it('stall at the event whose view outgrew its bound, at every size of page, though the next fold would shrink it back', async () => {
      const stalls = [
        await foldedInPages(pagesOf(source, swelling, 7)),
        await foldedInPages(pagesOf(source, swelling, 100)),
        await foldedInPages(pagesOf(source, swelling, 300)),
      ].map(({ view, stalledAt }) => ({ view, stalledAt }));

      expect(stalls).toEqual([1, 2, 3].map(() => ({ view: { folds: 150 }, stalledAt: 150 })));
    });
  },
);
