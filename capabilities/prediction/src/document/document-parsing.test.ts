import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/document-problems.ts';
import {
  basketLine,
  promotionLine,
  uploadedWeeklyOrders,
  weeklyOrders,
  weeklyOrdersWith,
} from '../testing/weekly-orders.ts';
import { parsePredictionDocument } from './document-parsing.ts';

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const periodRefused: unknown = expect.stringMatching(/^Line 5, \/predicts\/period: Expected "day" \| "week"/u);

function documentOf(source: string) {
  return Result.getOrThrow(parsePredictionDocument(source));
}

function digestOf(source: string): string {
  return documentOf(source).dataSha256;
}

describe('a prediction function document', () => {
  it('reads what it predicts, its data, its evaluation with the defaults, where its builds go and its rules', () => {
    expect(documentOf(weeklyOrders)).toMatchObject({
      description: 'Predicts the orders of each region one and four weeks ahead',
      predicts: { target: 'orders', period: 'week', season: 52, horizons: [1, 4], unit: 'orders', history: 8 },
      data: {
        events: [{ type: 'order.placed' }],
        time: '/placed_at',
        series: '/region',
        target: { as: 'count' },
        features: [
          { name: 'basket', of: '/total', as: 'mean' },
          { name: 'promotion', of: '/promotion', as: 'last' },
        ],
        given: ['promotion'],
        window: 156,
      },
      dataSha256: aDigest,
      source: { to: 'trainer', expires: 'P7D', expiresMs: 604_800_000 },
      rules: ['Train on the rows given and on nothing else'],
      dataExpressions: [],
    });
  });

  it('takes the evaluation’s defaults, with the seasonal baseline beside persistence when a season is named', () => {
    expect(documentOf(weeklyOrders).evaluation).toEqual({
      holdout: 12,
      metric: 'mase',
      coverageFloor: 0.7,
      baselines: ['persistence', 'seasonal-naive'],
      confidence: 0.9,
      shadowPeriods: 0,
      activate: 'automatic',
    });
  });
});

describe('the digest of the data part of a prediction function document', () => {
  it('is one for the rows a data part folds, however it is written and whatever its window and its given features', () => {
    const reordered = weeklyOrdersWith(['  target: { as: count }', '  target:\n    as: count']);
    const rephrased = weeklyOrdersWith([
      'description: Predicts the orders of each region one and four weeks ahead',
      'description: Orders',
    ]);
    const windowed = weeklyOrdersWith(['  window: 156', '  window: 160']);
    const givenNothing = weeklyOrdersWith(['  given: [promotion]', '']);

    expect([reordered, rephrased, windowed, givenNothing].map((source) => digestOf(source))).toEqual(
      Array.from({ length: 4 }, () => digestOf(weeklyOrders)),
    );
  });

  it('is another for rows folded otherwise or at another grain', () => {
    const summed = weeklyOrdersWith(['  target: { as: count }', '  target: { of: /total, as: sum }']);
    const daily = weeklyOrdersWith(['  period: week', '  period: day']);

    expect(new Set([summed, daily, weeklyOrders].map((source) => digestOf(source))).size).toBe(3);
  });
});

describe('the data part of a prediction function document', () => {
  it('names an uploaded dataset with its features by name and no projection', () => {
    expect(documentOf(uploadedWeeklyOrders('a'.repeat(64))).data).toEqual({
      dataset: 'a'.repeat(64),
      features: ['basket', 'promotion'],
      given: ['promotion'],
      window: 156,
    });
  });

  it('names an uploaded dataset with no features and nothing given', () => {
    const bare = weeklyOrdersWith(
      ['  events:', `  dataset: ${'c'.repeat(64)}`],
      ['    - type: order.placed', ''],
      ['  time: /placed_at', ''],
      ['  series: /region', ''],
      ['  target: { as: count }', ''],
      ['  features:', ''],
      [basketLine, ''],
      [promotionLine, ''],
      ['  given: [promotion]', ''],
    );

    expect(documentOf(bare).data).toEqual({ dataset: 'c'.repeat(64), features: [], given: [], window: 156 });
  });

  it('reads a feature that counts, and the time of the event itself with a data test kept for the check', () => {
    const counted = weeklyOrdersWith([basketLine, '    - { name: lines, as: count }']);
    const tested = weeklyOrdersWith(
      ['  time: /placed_at', '  time: event'],
      ['    - type: order.placed', `    - type: order.placed\n      data: '\${ $data.region !== "test" }'`],
    );

    expect(documentOf(counted).data).toMatchObject({
      features: [{ name: 'lines', as: 'count' }, { name: 'promotion' }],
    });
    expect([documentOf(tested).data, documentOf(tested).dataExpressions]).toMatchObject([
      { time: 'event' },
      [{ source: ' $data.region !== "test" ', pointer: '/data/events/0/data', line: 12 }],
    ]);
  });
});

describe('the defaults of a prediction function document', () => {
  it('leave out the description, the features, given, the rules and the seasonal baseline when none is written', () => {
    const bare = weeklyOrdersWith(
      ['description: Predicts the orders of each region one and four weeks ahead', ''],
      ['  features:', ''],
      [basketLine, ''],
      [promotionLine, ''],
      ['  given: [promotion]', ''],
      ['  season: 52', ''],
      ['  window: 156', '  window: 40'],
      ['rules:', ''],
      ['  - Train on the rows given and on nothing else', ''],
      [
        '{% for feature in dataset.features %}{{ feature.name }} ({{ feature.as }}){% unless forloop.last %}, {% endunless %}{% endfor %}.',
        '',
      ],
    );
    const document = documentOf(bare);

    expect([document.description, document.data, document.evaluation.baselines, document.rules]).toEqual([
      undefined,
      {
        events: [{ type: 'order.placed' }],
        time: '/placed_at',
        series: '/region',
        target: { as: 'count' },
        features: [],
        given: [],
        window: 40,
      },
      ['persistence'],
      [],
    ]);
  });

  it('answer twice the longest horizon of history unless another is written, as few as none and as many as the window', () => {
    const historyOf = (history: string): number =>
      documentOf(weeklyOrdersWith(['  unit: orders', `  unit: orders\n  history: ${history}`])).predicts.history;

    expect([documentOf(weeklyOrders).predicts.history, historyOf('0'), historyOf('156')]).toEqual([8, 0, 156]);
  });

  it('send a build to the trainer unless another party is named', () => {
    expect(documentOf(weeklyOrdersWith(['  expires: P7D', '  expires: P7D\n  to: data-team'])).source).toMatchObject({
      to: 'data-team',
    });
    expect(() => weeklyOrdersWith(['no such line', ''])).toThrow('The example has no line no such line');
  });
});

describe('a text that is not a prediction function document', () => {
  it('is refused at its first line, for empty front matter, and for keys the front matter does not take', () => {
    expect(problemsOf('no front matter')).toEqual([
      'Line 1: A prediction function definition starts with a line of three dashes (---) that opens its front matter of YAML',
    ]);
    expect(problemsOf('---\n---\n')).toEqual([
      'Line 2: The front matter is empty; it names at least what it predicts, the data it learns from and how it is evaluated',
      'Line 3: The definition has no brief: write it after the front matter',
    ]);
    expect(problemsOf(weeklyOrdersWith(['source:', 'input:\n  schema: {}\nsource:']))).toEqual([
      'Line 24, /input: input is not a key of the front matter; it takes description, predicts, data, evaluation, source, rules',
    ]);
    expect(problemsOf(weeklyOrdersWith(['  period: week', '  period: fortnight']))).toEqual([periodRefused]);
  });
});
