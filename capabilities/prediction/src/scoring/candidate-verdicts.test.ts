import { describe, expect, it } from 'vitest';

import type { Evaluation, Predicts } from '../document/prediction-document.ts';
import { baselineForecast, scaleOf } from './baselines.ts';
import { baselineWalks } from './baselines.ts';
import { seedOf } from './bootstrap.ts';
import { verdictOf, type Scoring } from './candidate-scoring.ts';
import { originDifferences, primaryOf, scoredOf } from './metrics.ts';
import { meanOf, rounded } from './score-math.ts';
import { remainingOfTheOrigins, scoringGridOf } from './scoring-grid.ts';

const daily: Predicts = { target: 'visits', period: 'day', horizons: [1, 2], unit: 'visits', history: 4 };

const grid = scoringGridOf(daily, { window: 12, holdout: 4, firstPeriod: '2026-10-01' });

const values = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 10, 9, 12, 11]);

const toTheWeek: Predicts = { ...daily, season: 7, horizons: [], accumulates: 'week', history: 14 };

const weeks = scoringGridOf(toTheWeek, { window: 21, holdout: 7, firstPeriod: '2026-10-05' });

const evaluation: Evaluation = {
  holdout: 4,
  metric: 'mase',
  coverageFloor: 0.7,
  baselines: ['persistence'],
  confidence: 0.9,
  shadowPeriods: 0,
  activate: 'automatic',
};

const north = { series: 'north', periods: [], values, features: new Float64Array(0) };

const scoring: Scoring = {
  grid,
  rows: [north],
  evaluation,
  seed: seedOf('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a'),
};

function answeredWith(spread: number, shift = 0): Float32Array {
  return Float32Array.from(
    [0, 1, 2, 3].flatMap((at) =>
      [1, 2].flatMap((horizon) => {
        const truth = values[8 + at + horizon] ?? 0;
        return [truth + shift - spread, truth + shift, truth + shift + spread];
      }),
    ),
  );
}

const underTheConfidence: unknown = expect.stringMatching(
  /^It beat persistence with a confidence of [\d.]+, under the 0\.9 asked$/u,
);

function verdictFor(q: Readonly<Float32Array>, series = 'north', given: Scoring = scoring) {
  return verdictOf(given, baselineWalks(given), { series: [series], q: [q] });
}

describe('the verdict on a candidate', () => {
  it('scores one that beats every baseline it can be compared with, with the confidence of each comparison', () => {
    expect(verdictFor(answeredWith(0.5))).toEqual({
      verdict: 'scored',
      scores: [
        { horizon: 1, pairs: 3, mase: 0, winkler: 1, quantile: 0.1 },
        { horizon: 2, pairs: 2, mase: 0, winkler: 1, quantile: 0.1 },
      ],
      coverage: 1,
      against: [{ baseline: 'persistence', p_better: 1 }],
    });
  });

  it('disqualifies one whose interval holds fewer truths than the floor, or no truth at all', () => {
    const unseen = { ...scoring, rows: [{ ...north, values: new Float64Array(12).fill(Number.NaN) }] };

    expect([verdictFor(answeredWith(0.5, 2)), verdictFor(answeredWith(0.5), 'north', unseen)]).toMatchObject([
      {
        verdict: 'disqualified',
        because: 'coverage_below_floor',
        detail: 'Its interval held 0 of the truths, under the floor of 0.7',
      },
      {
        verdict: 'disqualified',
        because: 'coverage_below_floor',
        detail: 'No held-back period had a truth to score its interval on',
      },
    ]);
  });

  it('disqualifies one that does not beat a baseline with the confidence asked', () => {
    expect(verdictFor(answeredWith(3, 2))).toMatchObject({
      verdict: 'disqualified',
      because: 'not_better',
      detail: underTheConfidence,
    });
  });
});

describe('the verdict on a candidate that answers badly', () => {
  it('disqualifies one that answers other series, another count of numbers, or a number that is not finite', () => {
    const notFinite = answeredWith(0.5);
    notFinite[5] = Number.NaN;

    expect([
      verdictFor(answeredWith(0.5), 'south'),
      verdictFor(answeredWith(0.5).subarray(0, 21)),
      verdictFor(notFinite),
    ]).toEqual([
      {
        verdict: 'disqualified',
        because: 'answered_badly',
        detail: 'The model walked other series than the scoring rows hold',
      },
      {
        verdict: 'disqualified',
        because: 'answered_badly',
        detail: 'The model answered 21 numbers for a series where 24 were expected',
      },
      { verdict: 'disqualified', because: 'answered_badly', detail: 'The model answered a number that is not finite' },
    ]);
  });

  it('disqualifies one whose low is above its likely value, or whose high is below it, at one origin alone', () => {
    const lowAbove = answeredWith(0.5);
    lowAbove[12] = Number(lowAbove[13]) + 1;
    const highBelow = answeredWith(0.5);
    highBelow[20] = Number(highBelow[19]) - 1;
    const crossed = {
      verdict: 'disqualified',
      because: 'answered_badly',
      detail: 'The model answered a low above its likely value or a high below it at a held-back origin',
    };

    expect([verdictFor(lowAbove), verdictFor(highBelow)]).toEqual([crossed, crossed]);
  });

  it('is compared with no baseline that walked no series', () => {
    const seasonal = scoringGridOf({ ...daily, season: 12 }, { window: 12, holdout: 4, firstPeriod: '2026-10-01' });
    const onlySeasonal = {
      ...scoring,
      grid: seasonal,
      evaluation: { ...evaluation, baselines: ['seasonal-naive' as const] },
    };

    expect(verdictFor(answeredWith(0.5), 'north', onlySeasonal)).toMatchObject({ verdict: 'scored', against: [] });
  });
});

describe('the figures of a series with too little to score', () => {
  it('carry no persistence forecast before the first observed value, and no mase where the scale is none', () => {
    const late = Float64Array.from([...Array.from({ length: 9 }, () => Number.NaN), 5, 6, 7]);
    const flat = new Float64Array(12).fill(4);
    const forecast = baselineForecast(grid, late, 'persistence');

    expect([...forecast.subarray(0, 3)]).toEqual([Number.NaN, Number.NaN, Number.NaN]);
    expect(
      scoredOf(grid, [
        { values: flat, forecast: baselineForecast(grid, flat, 'persistence'), scale: scaleOf(grid, flat) },
      ]).scores,
    ).toMatchObject([
      { horizon: 1, mase: null },
      { horizon: 2, mase: null },
    ]);
  });

  it('carry no run-rate for a total of a series observed on no day before an origin', () => {
    expect([...baselineForecast(weeks, new Float64Array(21).fill(Number.NaN), 'persistence').subarray(0, 3)]).toEqual([
      Number.NaN,
      Number.NaN,
      Number.NaN,
    ]);
  });

  it('give no primary figure for a metric no horizon has, no difference where a loss is not finite, and no rounding of nothing', () => {
    const flat = new Float64Array(12).fill(4);
    const persistence = { values: flat, forecast: baselineForecast(grid, flat, 'persistence'), scale: 0 };

    expect([
      primaryOf([{ horizon: 1, pairs: 0, mase: null, winkler: null, quantile: null }], 'mase'),
      originDifferences(grid, [{ candidate: persistence, baseline: persistence }], 'mase'),
      rounded(meanOf([])),
      remainingOfTheOrigins(grid),
      remainingOfTheOrigins(weeks),
    ]).toEqual([undefined, [], null, null, [6, 5, 4, 3, 2, 1, 7]]);
  });
});
