import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/document-problems.ts';
import { weeklyOrdersWith } from '../testing/weekly-orders.ts';

type Replacement = readonly [string, string];

type Refusal = readonly [string, readonly Replacement[], readonly string[]];

const predicts: readonly Refusal[] = [
  [
    'a repeated horizon',
    [['  horizons: [1, 4]', '  horizons: [1, 4, 4]']],
    ['Line 7, /predicts/horizons/2: The horizon 4 is named more than once; name each horizon once'],
  ],
  [
    'nine horizons',
    [['  horizons: [1, 4]', '  horizons: [1, 2, 3, 4, 5, 6, 7, 8, 9]']],
    ['Line 7, /predicts/horizons: A prediction function names 1 to 8 horizons; it names 9'],
  ],
  [
    'no horizon',
    [['  horizons: [1, 4]', '  horizons: []']],
    ['Line 7, /predicts/horizons: A prediction function names 1 to 8 horizons; it names 0'],
  ],
  [
    'a horizon past 52',
    [['  horizons: [1, 4]', '  horizons: [1, 53]']],
    ['Line 7, /predicts/horizons/1: A horizon is a whole number of periods from 1 to 52, not 53'],
  ],
  [
    'a season of one period',
    [['  season: 52', '  season: 1']],
    [
      'Line 6, /predicts/season: A season is a whole number of periods from 2 to 366, not 1; leave it out when the series has none',
    ],
  ],
  [
    'a target named period',
    [['  target: orders', '  target: period']],
    ['Line 4, /predicts/target: period is a column every dataset row already has; name the quantity otherwise'],
  ],
  [
    'a target that is not a column name',
    [['  target: orders', '  target: Orders']],
    [
      "Line 4, /predicts/target: Orders is not a name a dataset's column takes: 1 to 64 lowercase letters, digits and underscores, starting with a letter",
    ],
  ],
  [
    'an empty unit',
    [['  unit: orders', "  unit: ' '"]],
    ['Line 8, /predicts/unit: The unit is text of 1 to 64 characters, such as orders'],
  ],
  [
    'a history past 500 periods',
    [['  unit: orders', '  unit: orders\n  history: 501']],
    [
      'Line 9, /predicts/history: The history is a whole number of periods from 0 to 500, not 501; leave it out for twice the longest horizon',
    ],
  ],
  [
    'a history that is not whole',
    [['  unit: orders', '  unit: orders\n  history: 2.5']],
    [
      'Line 9, /predicts/history: The history is a whole number of periods from 0 to 500, not 2.5; leave it out for twice the longest horizon',
    ],
  ],
  [
    'a history longer than the window',
    [['  unit: orders', '  unit: orders\n  history: 157']],
    [
      'Line 9, /predicts/history: The history of 157 periods is more than the window of 156, which a question reads it from',
    ],
  ],
];

const coverageAndWindow: readonly Refusal[] = [
  [
    'a coverage under 0.5',
    [['  unit: orders', '  unit: orders\n  coverage: 0.4']],
    ['Line 9, /predicts/coverage: The coverage is a share from 0.5 to 0.95, not 0.4; leave it out for 0.8'],
  ],
  [
    'a coverage past 0.95',
    [['  unit: orders', '  unit: orders\n  coverage: 0.99']],
    ['Line 9, /predicts/coverage: The coverage is a share from 0.5 to 0.95, not 0.99; leave it out for 0.8'],
  ],
  [
    'a window under the longest horizon and three more periods',
    [
      ['  window: 156', '  window: 6'],
      ['  season: 52', ''],
    ],
    [
      'Line 14, /data/window: The window of 6 periods is under 7, the longest horizon and 3 more, which the forecaster needs to backtest an answer 4 periods ahead',
    ],
  ],
  [
    'a window over 1,000',
    [['  window: 156', '  window: 1001']],
    ['Line 15, /data/window: The window is a whole number of periods, at most 1,000, not 1,001'],
  ],
  [
    'a window that is not whole',
    [['  window: 156', '  window: 12.5']],
    ['Line 15, /data/window: The window is a whole number of periods, at most 1,000, not 12.5'],
  ],
];

describe('a prediction function document that differs from a valid one by one fault', () => {
  it.each([...predicts, ...coverageAndWindow])('is refused for %s, naming its line', (_fault, replaced, problems) => {
    expect(problemsOf(weeklyOrdersWith(...replaced))).toEqual(problems);
  });
});
