import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { templateLimits } from '@on.auto/definitions/template';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import { enclosings, longestSpanOf, type Enclosing } from '../periods/enclosing.ts';
import { uploading } from '../testing/upload-calls.ts';
import { weeklyOrders, weeklyOrdersLines } from '../testing/weekly-orders.ts';
import { parsePredictionDocument } from './document-parsing.ts';

const page = readFileSync(new URL('../../../../docs/reference/prediction-format.md', import.meta.url), 'utf8');

const fencedBlocks = [...page.matchAll(/```(\w+)\n([\s\S]*?)```/gu)].map(
  ([, language = '', body = '']: readonly string[]) => ({ language, body }),
);

const counted = new Intl.NumberFormat('en');

const mebibyte = 1_048_576;

function valueOf(bound: string): string {
  return String(
    page
      .split('\n')
      .find((line) => line.startsWith(`| ${bound} `))
      ?.split('|')[2],
  );
}

function withDataPart(data: string): string {
  const from = weeklyOrdersLines.indexOf('data:');
  const to = weeklyOrdersLines.indexOf('evaluation:');
  return [...weeklyOrdersLines.slice(0, from), data.trimEnd(), ...weeklyOrdersLines.slice(to)].join('\n');
}

describe('the examples on the reference page of prediction functions', () => {
  it('are, byte for byte, the document the tests run', () => {
    const [example] = fencedBlocks;

    expect(example?.language).toBe('markdown');
    expect(example?.body).toBe(`${weeklyOrders}\n`);
  });

  it('show rows a build reads that an upload takes, with the header of the example', async () => {
    const [, rows] = fencedBlocks;
    const body = String(rows?.body).replaceAll('\n', '\r\n');
    const sha256 = createHash('sha256').update(body).digest('hex');

    expect(rows?.language).toBe('text');
    expect(await uploading().upload(body, sha256)).toMatchObject({
      status: 'succeeded',
      output: { rows: 4, series: 2, columns: ['orders', 'basket', 'promotion'], period: 'week' },
    });
  });

  it('name an uploaded dataset in a data part the example takes in place of its projection', () => {
    const [, , data] = fencedBlocks;
    const parsed = Result.getOrThrow(parsePredictionDocument(withDataPart(String(data?.body))));

    expect(data?.language).toBe('yaml');
    expect(parsed.data).toMatchObject({
      dataset: '3f2ac1d0e4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d',
      given: ['promotion'],
      window: 156,
    });
  });
});

const bounds = predictionBounds;

describe('the bounds on the reference page of the document of a prediction function', () => {
  it('are the bounds the code holds a document to', () => {
    expect([
      valueOf('Horizons'),
      valueOf('History'),
      valueOf('Holdout'),
      valueOf('Window'),
      valueOf('Season'),
      valueOf('Shadow periods'),
      valueOf('Filters, features, rules'),
      valueOf('The brief'),
      valueOf('The brief'),
    ]).toEqual([
      expect.stringContaining(`1 to ${bounds.mostHorizons}, each 1 to ${bounds.mostHorizon} periods`),
      expect.stringContaining(`0 to ${bounds.mostHistory} periods, at most the window`),
      expect.stringContaining(`at least ${bounds.leastHoldout}`),
      expect.stringContaining(`at most ${counted.format(bounds.mostWindow)}`),
      expect.stringContaining(`${bounds.leastSeason} to ${bounds.mostSeason} periods`),
      expect.stringContaining(`0 to ${bounds.mostShadowPeriods}`),
      expect.stringContaining(
        `${bounds.mostFilters} filters; ${bounds.mostFeatures} features; ${bounds.mostRules} rules of ${bounds.mostRuleBytes} bytes each`,
      ),
      expect.stringContaining(`${bounds.mostBriefBytes / 1024} KiB`),
      expect.stringContaining(`within the ${templateLimits.renderMilliseconds} ms a template renders in`),
    ]);
  });
});

describe('the bounds on the reference page of the dataset and the runs of a prediction function', () => {
  it('are the bounds the code holds a dataset, a playbook and a run to', () => {
    expect([
      valueOf('A series'),
      valueOf('A dataset'),
      valueOf('Functions a playbook'),
      valueOf("A question's run"),
      valueOf("A build's wait"),
      valueOf("A build's run"),
    ]).toEqual([
      expect.stringContaining(`1 to ${bounds.mostSeriesBytes} bytes`),
      expect.stringContaining(
        `${counted.format(bounds.mostDatasetRows)} rows over ${counted.format(bounds.mostDatasetSeries)} series, ${bounds.mostDatasetBytes / mebibyte} MiB`,
      ),
      expect.stringContaining(`${bounds.mostFunctions} active`),
      expect.stringContaining(`${bounds.questionMs / 1000} seconds`),
      expect.stringContaining('One minute to 30 days'),
      expect.stringContaining('eight candidates at ten minutes each, and a minute to start'),
    ]);
    expect([
      bounds.shortestExpiryMs,
      bounds.longestExpiryMs,
      bounds.candidatesInABuild,
      bounds.scoringACandidateMs,
      bounds.buildStartMs,
    ]).toEqual([60_000, 2_592_000_000, 8, 600_000, 60_000]);
  });
});

type Grain = Parameters<typeof longestSpanOf>[0];

const grains: readonly Grain[] = ['day', 'week', 'month', 'quarter', 'year'];

const summedGrains: readonly (readonly [Grain, string])[] = [
  ['day', 'days'],
  ['week', 'weeks'],
  ['month', 'months'],
];

function inTurn(items: readonly string[]): string {
  return `${items.slice(0, -1).join(', ')} or ${String(items.at(-1))}`;
}

function enclosingsOf(grain: Grain): readonly Enclosing[] {
  return enclosings.filter((enclosing) => longestSpanOf(grain, enclosing) !== undefined);
}

function spansOf(grain: Grain): string {
  return inTurn(enclosingsOf(grain).map((enclosing) => String(longestSpanOf(grain, enclosing))));
}

function totalOf([grain, periods]: readonly [Grain, string]): string {
  const summed = inTurn(enclosingsOf(grain).map((enclosing) => `a ${enclosing}`));
  return `a ${grain} to ${summed}, at most ${spansOf(grain)} ${periods}`;
}

describe('the totals on the reference page of prediction functions', () => {
  it('are the pairs of periods the code sums, each with the most periods its enclosing period holds', () => {
    expect(grains.filter((grain) => enclosingsOf(grain).length > 0)).toEqual(summedGrains.map(([grain]) => grain));
    expect([valueOf('A total').toLowerCase(), page]).toEqual([
      expect.stringContaining(summedGrains.map((summed) => totalOf(summed)).join('; ')),
      expect.stringContaining(`${spansOf('day')} days, ${spansOf('week')} weeks, or ${spansOf('month')} months`),
    ]);
  });
});
