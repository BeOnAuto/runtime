import { describe, expect, it } from 'vitest';

import { describeOutput } from './prediction-words.ts';

const observed = { name: 'observed', points: [{ at: '2026-W41', value: 118 }] };

const prediction = {
  unit: 'orders',
  period: 'week',
  origin: '2026-W41',
  lines: [
    observed,
    {
      name: 'predicted',
      points: [
        { at: '2026-W42', value: 120.5, low: 96, high: 1250 },
        { at: '2026-W45', value: 131, low: 100, high: 160 },
      ],
    },
  ],
};

const onePoint = {
  ...prediction,
  lines: [observed, { name: 'predicted', points: [{ at: '2026-W42', value: 7, low: 6, high: 8 }] }],
};

describe('the words of what a run of a prediction function answers', () => {
  it('say each predicted point with its range, from the last period observed, the coverage of its ranges and the method that made them', () => {
    expect([
      describeOutput(prediction, { method: 'level-adjusted-seasonal-naive', coverage: 0.8 }),
      describeOutput(onePoint, { method: 'persistence', coverage: 0.8 }),
      describeOutput(onePoint),
    ]).toEqual([
      'From 2026-W41, it predicts 120.5 orders in 2026-W42 (96 to 1,250 orders) and 131 orders in 2026-W45 (100 to 160 orders), each range meant to hold the truth 8 times in 10, by repeating the periods a season earlier at the level of the last ones.',
      'From 2026-W41, it predicts 7 orders in 2026-W42 (6 to 8 orders), its range meant to hold the truth 8 times in 10, by carrying the last observed value forward.',
      'From 2026-W41, it predicts 7 orders in 2026-W42 (6 to 8 orders).',
    ]);
  });

  it('say the coverage in tenths, in twentieths, or as a share of the time', () => {
    expect(
      [0.7, 0.95, 0.734].map((coverage) => describeOutput(onePoint, { method: 'seasonal-naive', coverage })),
    ).toEqual([
      'From 2026-W41, it predicts 7 orders in 2026-W42 (6 to 8 orders), its range meant to hold the truth 7 times in 10, by repeating the periods a season earlier.',
      'From 2026-W41, it predicts 7 orders in 2026-W42 (6 to 8 orders), its range meant to hold the truth 19 times in 20, by repeating the periods a season earlier.',
      'From 2026-W41, it predicts 7 orders in 2026-W42 (6 to 8 orders), its range meant to hold the truth 73.4% of the time, by repeating the periods a season earlier.',
    ]);
  });

  it('say a total by the end of the period it sums to, in its unit, from the period the record names', () => {
    const total = { name: 'total', points: [{ at: '2026-11-01', value: 78, low: 70, high: 85 }] };
    const answer = { ...prediction, unit: 'visits', origin: '2026-10-25', lines: [observed, total] };

    expect([
      describeOutput(answer, { method: 'run-rate', coverage: 0.8, total_to: '2026-W44' }),
      describeOutput(answer, { coverage: 0.8 }),
    ]).toEqual([
      'From 2026-10-25, it predicts 78 visits by the end of 2026-W44 (70 to 85 visits), its range meant to hold the truth 8 times in 10, by running the pace of the periods so far to the end.',
      'From 2026-10-25, it predicts 78 visits by the end of 2026-11-01 (70 to 85 visits), its range meant to hold the truth 8 times in 10.',
    ]);
  });
});

describe('the figures in the words of a prediction', () => {
  it('write each figure to the decimals of the values the function observed, which its record names', () => {
    const visits = {
      ...prediction,
      unit: 'visits',
      lines: [
        observed,
        {
          name: 'predicted',
          points: [{ at: '2026-W42', value: 131, low: 129.932037, high: 132.067963 }],
        },
      ],
    };

    expect([describeOutput(visits, { decimals: 0 }), describeOutput(visits, { decimals: 1 })]).toEqual([
      'From 2026-W41, it predicts 131 visits in 2026-W42 (130 to 132 visits).',
      'From 2026-W41, it predicts 131 visits in 2026-W42 (129.9 to 132.1 visits).',
    ]);
  });

  it('say any other output as a result', () => {
    expect(describeOutput({ answer: 4 })).toBe('Its result: answer: 4.');
  });
});
