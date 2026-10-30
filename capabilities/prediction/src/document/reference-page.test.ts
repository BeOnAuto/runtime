import { readFileSync } from 'node:fs';

import { shapeNamed } from '@on.auto/definitions/testing';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { predictionBounds } from '../capability/prediction-bounds.ts';
import { enclosings, longestSpanOf, type Enclosing } from '../periods/enclosing.ts';
import { weeklyOrders } from '../testing/weekly-orders.ts';
import { parsePredictionDocument } from './document-parsing.ts';

const page = readFileSync(new URL('../../../../docs/reference/prediction-format.md', import.meta.url), 'utf8');

const fencedBlocks = [...page.matchAll(/```(\w+)\n([\s\S]*?)```/gu)].map(
  ([, language = '', body = '']: readonly string[]) => ({ language, body }),
);

const counted = new Intl.NumberFormat('en');

function valueOf(bound: string): string {
  return String(
    page
      .split('\n')
      .find((line) => line.startsWith(`| ${bound} `))
      ?.split('|')[2],
  );
}

describe('the example on the reference page of prediction functions', () => {
  it('is, byte for byte, the document the tests run', () => {
    const [example] = fencedBlocks;

    expect(example?.language).toBe('markdown');
    expect(example?.body).toBe(`${weeklyOrders}\n`);
  });
});

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

describe('the answer to a question on the reference page of prediction functions', () => {
  it('is a series of the example’s grain, with its default history and its horizons', () => {
    const [, answerBlock] = fencedBlocks;
    const answer = decodeJson(String(answerBlock?.body));
    const { predicts } = Result.getOrThrow(parsePredictionDocument(weeklyOrders));

    expect(shapeNamed('series').check(answer)).toEqual([]);
    expect(answer).toMatchObject({
      unit: predicts.unit,
      period: predicts.period,
      lines: [
        { name: 'observed', points: Array.from({ length: predicts.history }, () => ({})) },
        { name: 'predicted', points: predicts.horizons.map(() => ({})) },
      ],
    });
  });
});

const bounds = predictionBounds;

describe('the bounds on the reference page of prediction functions', () => {
  it('are the bounds the code holds a document, a playbook and a run to', () => {
    expect([
      valueOf('Horizons'),
      valueOf('History'),
      valueOf('Window'),
      valueOf('Season'),
      valueOf('Coverage'),
      valueOf('Filters'),
      valueOf('A series'),
      valueOf('Functions a playbook'),
      valueOf("A question's run"),
    ]).toEqual([
      expect.stringContaining(`1 to ${bounds.mostHorizons}, each 1 to ${bounds.mostHorizon} periods`),
      expect.stringContaining(`0 to ${bounds.mostHistory} periods, at most the window`),
      expect.stringContaining(`at most ${counted.format(bounds.mostWindow)}`),
      expect.stringContaining(`${bounds.leastSeason} to ${bounds.mostSeason} periods`),
      expect.stringContaining(`${bounds.leastCoverage} to ${bounds.mostCoverage}, ${bounds.coverage} when left out`),
      expect.stringContaining(`1 to ${bounds.mostFilters}`),
      expect.stringContaining(`1 to ${bounds.mostSeriesBytes} bytes`),
      expect.stringContaining(`${bounds.mostFunctions} active`),
      expect.stringContaining(`${bounds.questionMs / 1000} seconds`),
    ]);
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
