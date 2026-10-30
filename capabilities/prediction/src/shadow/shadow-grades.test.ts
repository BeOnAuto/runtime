import { describe, expect, it } from 'vitest';

import type { ShadowGrade } from '../models/model-state.ts';
import { gradeOf, predictionsOf, shadowVerdictOf, type Aimed } from './shadow-grades.ts';

function aimed(series: readonly (readonly [string, readonly (number | null)[]])[]): Aimed {
  return {
    predictions: { origin: '2026-10-12', series: series.map(([name, q]) => ({ series: name, q, scale: 1 })) },
    horizon: 1,
  };
}

const truthful = {
  truths: new Map([
    ['north', 11],
    ['south', 21],
    ['east', 31],
  ]),
  absentIsZero: false,
};

function graded(of: number, pairs: number, answered: number, mase: number | null): ShadowGrade {
  return {
    version: 2,
    of,
    build: 'build-2',
    period: '2026-10-13',
    scores: [{ horizon: 1, pairs, mase, winkler: mase, quantile: mase }],
    graded: pairs,
    answered,
    missing: 0,
  };
}

describe('the grade of a version in the shadow', () => {
  it('is taken over the series both versions answered with finite numbers, and counts the others apart', () => {
    const challenger = aimed([
      ['north', [9, 11, 13]],
      ['south', [19, 21, 23]],
      ['east', [Number.NaN, 31, 33]],
      ['west', [1, 2, 3]],
    ]);
    const active = aimed([
      ['north', [9, 12, 13]],
      ['east', [29, 31, 33]],
    ]);

    expect(gradeOf([challenger], [active], truthful)).toEqual({
      scores: [{ horizon: 1, pairs: 1, mase: 0, winkler: 4, quantile: 0.4 }],
      graded: 1,
      answered: 2,
      missing: 2,
    });
    expect(gradeOf([challenger], [], truthful)).toMatchObject({ graded: 0, answered: 2 });
  });

  it('reads stored numbers that are not finite as no answer, and a record it cannot read as no predictions', () => {
    const stored = predictionsOf(
      JSON.stringify({ origin: '2026-10-12', series: [{ series: 'north', q: [9, null, 13], scale: 1 }] }),
      '2026-10-12',
    );

    expect([
      gradeOf([{ predictions: stored, horizon: 1 }], [{ predictions: stored, horizon: 1 }], truthful),
      predictionsOf('not the predictions', '2026-10-11'),
    ]).toEqual([
      {
        scores: [{ horizon: 1, pairs: 0, mase: null, winkler: null, quantile: null }],
        graded: 0,
        answered: 0,
        missing: 1,
      },
      { origin: '2026-10-11', series: [] },
    ]);
  });
});

describe('the verdict of a shadow', () => {
  it('passes a challenger no worse than the active version over the pairs both answered, and fails a worse one', () => {
    expect([
      shadowVerdictOf([graded(2, 4, 4, 0.5), graded(1, 4, 4, 0.75)], 2, 'mase'),
      shadowVerdictOf([graded(2, 4, 4, 0.75), graded(1, 4, 4, 0.5)], 2, 'mase'),
    ]).toEqual([
      { passed: true, challenger: 0.5, active: 0.75 },
      { passed: false, challenger: 0.75, active: 0.5 },
    ]);
  });

  it('fails a challenger that answered nothing beside an active version that answered, and passes the reverse', () => {
    expect([
      shadowVerdictOf([graded(2, 0, 0, null), graded(1, 0, 4, null)], 2, 'mase'),
      shadowVerdictOf([graded(2, 0, 4, null), graded(1, 0, 0, null)], 2, 'mase'),
    ]).toEqual([
      { passed: false, challenger: null, active: null },
      { passed: true, challenger: null, active: null },
    ]);
  });

  it('decides nothing while neither version answered a pair with a truth, or no pair was answered by both', () => {
    expect([
      shadowVerdictOf([graded(2, 0, 0, null), graded(1, 0, 0, null)], 2, 'mase'),
      shadowVerdictOf([graded(2, 0, 3, null), graded(1, 0, 3, null)], 2, 'mase'),
    ]).toEqual([undefined, undefined]);
  });

  it('passes a challenger whose metric has no figure over the pairs both answered, as mase over series with no scale', () => {
    expect(shadowVerdictOf([graded(2, 3, 3, null), graded(1, 3, 3, null)], 2, 'mase')).toEqual({
      passed: true,
      challenger: null,
      active: null,
    });
  });
});
