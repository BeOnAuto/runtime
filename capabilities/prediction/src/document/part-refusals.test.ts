import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/document-problems.ts';
import { weeklyOrdersWith } from '../testing/weekly-orders.ts';

type Replacement = readonly [string, string];

type Refusal = readonly [string, readonly Replacement[], readonly string[]];

const rangeWords = 'A build waits for its trainer from one minute to thirty days, such as P7D or PT12H';

const nameWords =
  'is not the name of a function: 3 to 48 lowercase letters, digits and hyphens, starting with a letter';

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

const evaluation: readonly Refusal[] = [
  [
    'a holdout under twice the longest horizon',
    [['  horizons: [1, 4]', '  horizons: [1, 8]']],
    [
      'Line 21, /evaluation/holdout: The holdout holds back 12 periods, fewer than 16: at least twice the longest horizon, 16, and at least 8',
    ],
  ],
  [
    'a holdout under 8',
    [['  holdout: 12', '  holdout: 6']],
    [
      'Line 21, /evaluation/holdout: The holdout holds back 6 periods, fewer than 8: at least twice the longest horizon, 8, and at least 8',
    ],
  ],
  [
    'a holdout over half the window',
    [
      ['  season: 52', '  season: 2'],
      ['  holdout: 12', '  holdout: 80'],
    ],
    ['Line 21, /evaluation/holdout: The holdout of 80 periods is more than half the window of 156'],
  ],
  [
    'a holdout that is not whole',
    [['  holdout: 12', '  holdout: 12.5']],
    ['Line 21, /evaluation/holdout: The holdout is a whole number of periods, not 12.5'],
  ],
  [
    'a window under the holdout plus two seasons',
    [['  window: 156', '  window: 100']],
    ['Line 19, /data/window: The window of 100 periods is under the holdout plus two seasons, 12 + 2 × 52 = 116'],
  ],
  [
    'a window under the holdout plus twice the longest horizon',
    [
      ['  season: 52', ''],
      ['  window: 156', '  window: 15'],
      ['  holdout: 12', '  holdout: 8'],
    ],
    [
      'Line 18, /data/window: The window of 15 periods is under the holdout plus twice the longest horizon, 8 + 2 × 4 = 16',
      'Line 20, /evaluation/holdout: The holdout of 8 periods is more than half the window of 15',
    ],
  ],
  [
    'a window over 1,000',
    [['  window: 156', '  window: 1001']],
    ['Line 19, /data/window: The window is a whole number of periods from 1 to 1,000, not 1,001'],
  ],
  [
    'seasonal-naive named without a season',
    [
      ['  season: 52', ''],
      ['  holdout: 12', '  holdout: 12\n  baselines: [persistence, seasonal-naive]'],
    ],
    [
      'Line 21, /evaluation/baselines/1: seasonal-naive takes the value one season earlier, and predicts names no season',
    ],
  ],
  [
    'a baseline named twice',
    [['  holdout: 12', '  holdout: 12\n  baselines: [persistence, persistence]']],
    ['Line 22, /evaluation/baselines/1: persistence is named more than once'],
  ],
  [
    'no baseline',
    [['  holdout: 12', '  holdout: 12\n  baselines: []']],
    ['Line 22, /evaluation/baselines: Name at least one baseline a candidate must beat'],
  ],
  [
    'a coverage floor of 1',
    [['  holdout: 12', '  holdout: 12\n  coverage_floor: 1']],
    ['Line 22, /evaluation/coverage_floor: A share from 0.5 to 0.99 is expected, not 1'],
  ],
  [
    'a confidence of 0.4',
    [['  holdout: 12', '  holdout: 12\n  confidence: 0.4']],
    ['Line 22, /evaluation/confidence: A share from 0.5 to 0.99 is expected, not 0.4'],
  ],
  [
    'a shadow of 53 periods',
    [['  holdout: 12', '  holdout: 12\n  shadow_periods: 53']],
    ['Line 22, /evaluation/shadow_periods: A shadow lasts a whole number of periods from 0 to 52, not 53'],
  ],
  [
    'an approver that is not a function name',
    [['  activate: automatic', '  activate: { approved: Approve }']],
    [`Line 22, /evaluation/activate/approved: Approve ${nameWords}`],
  ],
];

const source: readonly Refusal[] = [
  [
    'an expiry past thirty days',
    [['  expires: P7D', '  expires: P31D']],
    [`Line 24, /source/expires: P31D is not a time a build may wait. ${rangeWords}`],
  ],
  [
    'an expiry in months',
    [['  expires: P7D', '  expires: P1M']],
    [
      `Line 24, /source/expires: P1M counts years or months, which have no fixed length; use weeks, days or less. ${rangeWords}`,
    ],
  ],
  [
    'a party beside a function to send the build through',
    [['  expires: P7D', '  expires: P7D\n  to: someone\n  through: send-builds']],
    [
      'Line 25, /source/to: to names the party of a build asked in the inbox; a build sent through a function goes to the party that function names',
    ],
  ],
  [
    'a function to send through that is not a name',
    [['  expires: P7D', '  expires: P7D\n  through: X']],
    [`Line 25, /source/through: X ${nameWords}`],
  ],
  [
    'an empty party',
    [['  expires: P7D', "  expires: P7D\n  to: ' '"]],
    ['Line 25, /source/to: to is the party a build goes to, text of 1 to 256 characters'],
  ],
  [
    'rules past 32',
    [
      [
        '  - Train on the rows given and on nothing else',
        Array.from({ length: 33 }, (_, rule) => `  - Rule ${rule}`).join('\n'),
      ],
    ],
    ['Line 26, /rules: A prediction function states at most 32 rules; it states 33'],
  ],
  [
    'a rule past 256 bytes',
    [['  - Train on the rows given and on nothing else', `  - ${'é'.repeat(129)}`]],
    ['Line 26, /rules/0: A rule is one line of at most 256 bytes; this one takes 258 bytes'],
  ],
  [
    'a rule of two lines',
    [['  - Train on the rows given and on nothing else', '  - "one\\ntwo"']],
    ['Line 26, /rules/0: A rule is one line of at most 256 bytes; this one takes 7 bytes'],
  ],
  [
    'an empty rule',
    [['  - Train on the rows given and on nothing else', "  - ''"]],
    ['Line 26, /rules/0: A rule is a line in words; this one is empty'],
  ],
];

describe('a prediction function document that differs from a valid one by one fault', () => {
  it.each([...predicts, ...evaluation, ...source])(
    'is refused for %s, naming its line',
    (_fault, replaced, problems) => {
      expect(problemsOf(weeklyOrdersWith(...replaced))).toEqual(problems);
    },
  );
});
