import { describe, expect, it } from 'vitest';

import { stepsAhead, theRestOfTheWeek } from '../testing/forecast-questions.ts';
import { forecastOf } from './ladder.ts';

const days = Array.from({ length: 40 }, (_, day) => 10 + (day % 7) + Math.floor(day / 7));

function lastDays(periods: number): readonly number[] {
  return days.slice(days.length - periods);
}

const aWeekAhead = stepsAhead(7);

interface Rung {
  readonly periods: number;
  readonly method: string;
  readonly origins: number;
}

const rungsAWeekAhead: readonly Rung[] = [
  { periods: 30, method: 'level-adjusted-seasonal-naive', origins: 10 },
  { periods: 23, method: 'level-adjusted-seasonal-naive', origins: 3 },
  { periods: 22, method: 'seasonal-naive', origins: 9 },
  { periods: 16, method: 'seasonal-naive', origins: 3 },
  { periods: 15, method: 'persistence', origins: 8 },
  { periods: 10, method: 'persistence', origins: 3 },
];

const rungsForTheRestOfTheWeek: readonly Rung[] = [
  { periods: 40, method: 'level-adjusted-seasonal-naive', origins: 4 },
  { periods: 32, method: 'level-adjusted-seasonal-naive', origins: 3 },
  { periods: 31, method: 'seasonal-naive', origins: 3 },
  { periods: 28, method: 'seasonal-naive', origins: 3 },
  { periods: 27, method: 'run-rate', origins: 3 },
  { periods: 24, method: 'run-rate', origins: 3 },
];

describe('the sufficiency ladder of steps ahead', () => {
  it.each(rungsAWeekAhead)(
    'answers a week ahead from $periods days with $method, the first method whose history holds what one forecast needs, the horizon and two more periods',
    ({ periods, method, origins }) => {
      expect(forecastOf({ observed: lastDays(periods), season: 7, coverage: 0.8, asked: aWeekAhead })).toMatchObject({
        method,
        coverage: 0.8,
        history: { periods, origins },
      });
    },
  );

  it('answers persistence where the function declares no season, however long the history', () => {
    expect(forecastOf({ observed: lastDays(40), season: null, coverage: 0.8, asked: aWeekAhead })).toMatchObject({
      method: 'persistence',
      season: null,
      history: { periods: 40, origins: 33 },
    });
  });

  it('refuses a history too short to backtest persistence at three origins, naming the periods it has', () => {
    expect([
      forecastOf({ observed: lastDays(9), season: 7, coverage: 0.8, asked: aWeekAhead }),
      forecastOf({ observed: lastDays(4), season: null, coverage: 0.8, asked: aWeekAhead }),
    ]).toEqual([
      { refused: 'history_too_short', have: 9 },
      { refused: 'history_too_short', have: 4 },
    ]);
  });
});

describe('the sufficiency ladder of a total', () => {
  it.each(rungsForTheRestOfTheWeek)(
    'answers the rest of the week from $periods days with $method, the first method backtested at three past weeks at the same day',
    ({ periods, method, origins }) => {
      expect(
        forecastOf({
          observed: lastDays(periods),
          season: 7,
          coverage: 0.8,
          asked: theRestOfTheWeek(lastDays(periods)),
        }),
      ).toMatchObject({ method, history: { periods, origins } });
    },
  );

  it('refuses a total until three past enclosing periods at the same phase lie within the history', () => {
    expect([
      forecastOf({ observed: lastDays(23), season: 7, coverage: 0.8, asked: theRestOfTheWeek(lastDays(23)) }),
      forecastOf({ observed: lastDays(20), season: null, coverage: 0.8, asked: theRestOfTheWeek(lastDays(20)) }),
    ]).toEqual([
      { refused: 'history_too_short', have: 23 },
      { refused: 'history_too_short', have: 20 },
    ]);
  });
});
