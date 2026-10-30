import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/document-problems.ts';
import { weeklyOrders, weeklyOrdersWith } from '../testing/weekly-orders.ts';
import { parsePredictionDocument } from './document-parsing.ts';

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const periodRefused: unknown = expect.stringMatching(/^Line 5, \/predicts\/period: Expected "day" \| "week"/u);

function documentOf(source: string) {
  return Result.getOrThrow(parsePredictionDocument(source));
}

function digestOf(source: string): string {
  return documentOf(source).dataSha256;
}

function coverageOf(coverage: string): number {
  return documentOf(weeklyOrdersWith(['  unit: orders', `  unit: orders\n  coverage: ${coverage}`])).predicts.coverage;
}

describe('a prediction function document', () => {
  it('reads what it predicts, with the coverage of its ranges, and the data it forecasts from', () => {
    expect(documentOf(weeklyOrders)).toMatchObject({
      description: 'Predicts the orders of each region one and four weeks ahead',
      predicts: {
        target: 'orders',
        period: 'week',
        season: 52,
        horizons: [1, 4],
        unit: 'orders',
        history: 8,
        coverage: 0.8,
      },
      data: {
        events: [{ type: 'order.placed' }],
        time: '/placed_at',
        series: '/region',
        target: { as: 'count' },
        window: 156,
      },
      dataSha256: aDigest,
      dataExpressions: [],
    });
  });

  it('takes the coverage it names, from 0.5 to 0.95', () => {
    expect([coverageOf('0.5'), coverageOf('0.9'), coverageOf('0.95')]).toEqual([0.5, 0.9, 0.95]);
  });
});

describe('the digest of the data part of a prediction function document', () => {
  it('is one for the rows a data part folds, however it is written and whatever its window', () => {
    const reordered = weeklyOrdersWith(['  target: { as: count }', '  target:\n    as: count']);
    const rephrased = weeklyOrdersWith([
      'description: Predicts the orders of each region one and four weeks ahead',
      'description: Orders',
    ]);
    const windowed = weeklyOrdersWith(['  window: 156', '  window: 160']);

    expect([reordered, rephrased, windowed].map((source) => digestOf(source))).toEqual(
      Array.from({ length: 3 }, () => digestOf(weeklyOrders)),
    );
  });

  it('is another for rows folded otherwise or at another grain', () => {
    const summed = weeklyOrdersWith(['  target: { as: count }', '  target: { of: /total, as: sum }']);
    const daily = weeklyOrdersWith(['  period: week', '  period: day']);

    expect(new Set([summed, daily, weeklyOrders].map((source) => digestOf(source))).size).toBe(3);
  });
});

describe('the data part of a prediction function document', () => {
  it('reads the time of the event itself, with a data test kept for the check', () => {
    const tested = weeklyOrdersWith(
      ['  time: /placed_at', '  time: event'],
      ['    - type: order.placed', `    - type: order.placed\n      data: '\${ $data.region !== "test" }'`],
    );

    expect([documentOf(tested).data, documentOf(tested).dataExpressions]).toMatchObject([
      { time: 'event' },
      [{ source: ' $data.region !== "test" ', pointer: '/data/events/0/data', line: 12 }],
    ]);
  });
});

describe('the defaults of a prediction function document', () => {
  it('leave out the description and the season when none is written', () => {
    const bare = weeklyOrdersWith(
      ['description: Predicts the orders of each region one and four weeks ahead', ''],
      ['  season: 52', ''],
      ['  window: 156', '  window: 40'],
    );
    const document = documentOf(bare);

    expect([document.description, document.data]).toEqual([
      undefined,
      {
        events: [{ type: 'order.placed' }],
        time: '/placed_at',
        series: '/region',
        target: { as: 'count' },
        window: 40,
      },
    ]);
  });

  it('answer twice the longest horizon of history unless another is written, as few as none and as many as the window', () => {
    const historyOf = (history: string): number =>
      documentOf(weeklyOrdersWith(['  unit: orders', `  unit: orders\n  history: ${history}`])).predicts.history;

    expect([documentOf(weeklyOrders).predicts.history, historyOf('0'), historyOf('156')]).toEqual([8, 0, 156]);
    expect(() => weeklyOrdersWith(['no such line', ''])).toThrow('The example has no line no such line');
  });
});

describe('a text that is not a prediction function document', () => {
  it('is refused at its first line, for empty front matter, for keys the front matter does not take, and for a body', () => {
    expect(problemsOf('no front matter')).toEqual([
      'Line 1: A prediction function definition starts with a line of three dashes (---) that opens its front matter of YAML',
    ]);
    expect(problemsOf('---\n---\nA note')).toEqual([
      'Line 2: The front matter is empty; it names at least what it predicts and the data it forecasts from',
      'Line 3: A prediction function has no body: leave the body after the front matter empty, and say what the function predicts in description',
    ]);
    expect(problemsOf(weeklyOrdersWith(['  window: 156', '  window: 156\ninput:\n  schema: {}']))).toEqual([
      'Line 17, /input: input is not a key of the front matter; it takes description, predicts, data',
    ]);
    expect(problemsOf(`${weeklyOrdersWith(['  period: week', '  period: fortnight'])}\n\nNotes`)).toEqual([
      periodRefused,
      'Line 18: A prediction function has no body: leave the body after the front matter empty, and say what the function predicts in description',
    ]);
  });

  it('is refused for a body beside a front matter that reads, and takes a body of blank lines', () => {
    expect([problemsOf(`${weeklyOrders}\n\nA note`), problemsOf(`${weeklyOrders}\n\n  \n`)]).toEqual([
      [
        'Line 18: A prediction function has no body: leave the body after the front matter empty, and say what the function predicts in description',
      ],
      [],
    ]);
  });
});
