import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { dailyTotals, dailyTotalsWith } from '../testing/daily-documents.ts';
import { problemsOf } from '../testing/document-problems.ts';
import { parsePredictionDocument } from './document-parsing.ts';

type Refusal = readonly [string, readonly (readonly [string, string])[], readonly string[]];

const pairsWords =
  'a day sums to a week, a month or a quarter, a week to a quarter or a year, and a month to a quarter or a year';

const refusals: readonly Refusal[] = [
  [
    'horizons beside it',
    [['  accumulates: week', '  accumulates: week\n  horizons: [1]']],
    [
      'Line 8, /predicts/horizons: accumulates takes the place of horizons, since a total to the end of a period asks no horizon; name one or the other',
    ],
  ],
  [
    'neither it nor horizons',
    [['  accumulates: week', '']],
    ['Line 4, /predicts: predicts names its horizons, or accumulates in their place'],
  ],
  [
    'a day summed to its year',
    [['  accumulates: week', '  accumulates: year']],
    [`Line 7, /predicts/accumulates: A day does not sum to a year: ${pairsWords}`],
  ],
  [
    'a week summed to its month',
    [
      ['  period: day', '  period: week'],
      ['  season: 7', '  season: 52'],
      ['  accumulates: week', '  accumulates: month'],
    ],
    [`Line 7, /predicts/accumulates: A week does not sum to a month: ${pairsWords}`],
  ],
  [
    'a mean summed',
    [['  target: { of: /amount, as: sum }', '  target: { of: /amount, as: mean }']],
    ['Line 14, /data/target/as: A total to the end of a week is a count or a sum; a sum of mean values says nothing'],
  ],
  [
    'a window under four times the most days a week holds',
    [['  window: 56', '  window: 27']],
    [
      'Line 15, /data/window: The window of 27 periods is under 28, 4 times the 7 periods a week holds at most, which the forecaster needs to backtest a total at 3 past weeks',
    ],
  ],
];

function documentOf(source: string) {
  return Result.getOrThrow(parsePredictionDocument(source));
}

describe('a prediction function that sums its target to the end of an enclosing period', () => {
  it('reads the enclosing period in place of horizons', () => {
    expect(documentOf(dailyTotals).predicts).toEqual({
      target: 'sales',
      period: 'day',
      season: 7,
      horizons: [],
      accumulates: 'week',
      unit: 'sales',
      history: 14,
      coverage: 0.8,
    });
  });

  it.each(refusals)('is refused for %s, naming its line', (_fault, replaced, problems) => {
    expect(problemsOf(dailyTotalsWith(...replaced))).toEqual(problems);
  });

  it('takes a question of a series without a horizon, and refuses one that names a horizon', () => {
    const { schemas } = documentOf(dailyTotals);

    expect([
      Result.isSuccess(schemas.question.validate({ series: 'north' })),
      Result.isSuccess(schemas.question.validate({ series: 'north', horizon: 1 })),
    ]).toEqual([true, false]);
    expect(schemas.input).toMatchObject({
      required: ['series'],
      description:
        'A question: the series to predict the total of its sales for, in sales, from the day after its last observed one to the end of that week',
    });
  });
});
