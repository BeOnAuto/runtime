import { describe, expect, it } from 'vitest';

import type { Aggregation, Predicts } from '../document/prediction-document.ts';
import { periodOfForm } from '../periods/grains.ts';
import type { SeriesWindow } from '../window/series-window.ts';
import { historyTooShort } from './history-refusal.ts';

const dailyVisits: Predicts = {
  target: 'visits',
  period: 'day',
  horizons: [1, 2],
  unit: 'visits',
  history: 4,
  coverage: 0.8,
};

const salesToTheEndOfTheMonth: Predicts = {
  target: 'sales',
  period: 'day',
  accumulates: 'month',
  horizons: [],
  unit: 'sales',
  history: 62,
  coverage: 0.8,
};

function windowTo(origin: string, observed: readonly (number | null)[]): SeriesWindow {
  const last = Number(periodOfForm('day', origin));
  return { observed, first: last - observed.length + 1, origin: last, checkpoint: 'a-checkpoint' };
}

function refusalOf(predicts: Predicts, as: Aggregation, window: SeriesWindow, have: number): string {
  return historyTooShort({ series: 'north', predicts, as, window }, { refused: 'history_too_short', have }).detail;
}

const unobservedUpTo = (periods: number): readonly null[] => Array.from({ length: periods }, () => null);

describe('the refusal of a series whose history is too short', () => {
  it('names the periods a count has up to its origin, one or several, and the period from which the same question answers', () => {
    expect([
      refusalOf(dailyVisits, 'count', windowTo('2024-10-04', [...unobservedUpTo(21), 4, 0, 5]), 3),
      refusalOf(dailyVisits, 'count', windowTo('2024-10-04', [...unobservedUpTo(23), 4]), 1),
    ]).toEqual([
      'The series "north" has 3 periods of history up to 2024-10-04, too few for the forecaster to backtest an answer; ask again from 2024-10-07',
      'The series "north" has one period of history up to 2024-10-04, too few for the forecaster to backtest an answer; ask again from 2024-10-09',
    ]);
  });

  it('names the periods of a mean without a value, and asks again on the condition that every period until then holds one', () => {
    expect([
      refusalOf(dailyVisits, 'mean', windowTo('2024-10-04', [...unobservedUpTo(20), 4, null, 5, null]), 4),
      refusalOf(dailyVisits, 'last', windowTo('2024-10-04', [...unobservedUpTo(21), 4, null, 5]), 3),
      refusalOf(dailyVisits, 'last', windowTo('2024-10-04', unobservedUpTo(24)), 0),
    ]).toEqual([
      'The series "north" has 4 periods of history up to 2024-10-04, 2 of them without a value, too few for the forecaster to backtest an answer; ask again from 2024-10-08, if every period until then holds a value',
      'The series "north" has 3 periods of history up to 2024-10-04, one of them without a value, too few for the forecaster to backtest an answer; ask again from 2024-10-08, if every period until then holds a value',
      'The series "north" has no observed period of history, too few for the forecaster to backtest an answer; ask again from 2024-10-10, if every period until then holds a value',
    ]);
  });

  it('names, for a total asked part way through its enclosing period, the first period from which it answers, however many turns of the calendar that takes', () => {
    const lastSevenWeeks = Array.from({ length: 49 }, () => 3);

    expect(
      refusalOf(
        salesToTheEndOfTheMonth,
        'sum',
        windowTo('2024-10-12', [...unobservedUpTo(124 - 49), ...lastSevenWeeks]),
        49,
      ),
    ).toBe(
      'The series "north" has 49 periods of history up to 2024-10-12, too few for the forecaster to backtest an answer; ask again from 2024-12-01',
    );
  });
});
