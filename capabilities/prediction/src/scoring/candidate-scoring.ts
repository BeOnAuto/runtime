import { Array } from 'effect';

import type { Baseline, Evaluation } from '../document/prediction-document.ts';
import type { Score } from '../facts/build-facts.ts';
import type { SeriesRows } from '../files/series-rows.ts';
import { scaleOf, type BaselineWalk } from './baselines.ts';
import { pBetterOf } from './bootstrap.ts';
import { originDifferences, scoredOf, type SeriesForecast } from './metrics.ts';
import { answeredInOrder } from './quantile-order.ts';
import { rounded } from './score-math.ts';
import { percentiles, type ScoringGrid } from './scoring-grid.ts';

export interface Scoring {
  readonly grid: ScoringGrid;
  readonly rows: readonly SeriesRows[];
  readonly evaluation: Evaluation;
  readonly seed: number;
}

export interface WalkedAnswer {
  readonly series: readonly string[];
  readonly q: readonly Readonly<Float32Array>[];
}

type Against = { readonly baseline: Baseline; readonly p_better: number };

export type Verdict =
  | {
      readonly verdict: 'scored';
      readonly scores: readonly Score[];
      readonly coverage: number | null;
      readonly against: readonly Against[];
    }
  | {
      readonly verdict: 'disqualified';
      readonly because: 'answered_badly' | 'coverage_below_floor' | 'not_better';
      readonly detail: string;
    };

const figures = new Intl.NumberFormat('en', { maximumFractionDigits: 4 });

function badlyOf({ grid, rows }: Scoring, answer: WalkedAnswer): string | undefined {
  const length = grid.holdout * grid.steps * percentiles;
  if (answer.series.join('\n') !== rows.map(({ series }) => series).join('\n')) {
    return 'The model walked other series than the scoring rows hold';
  }
  const wrong = answer.q.find((q) => q.length !== length);
  if (wrong !== undefined) {
    return `The model answered ${wrong.length} numbers for a series where ${length} were expected`;
  }
  if (answer.q.some((q) => q.some((value) => !Number.isFinite(value)))) {
    return 'The model answered a number that is not finite';
  }
  return answer.q.every((q) => answeredInOrder(q))
    ? undefined
    : 'The model answered a low above its likely value or a high below it at a held-back origin';
}

function againstOf(scoring: Scoring, candidate: readonly SeriesForecast[], walk: BaselineWalk): Against {
  const compared = Array.zipWith(candidate, walk.forecasts, (one, baseline) => ({ candidate: one, baseline }));
  const differences = originDifferences(scoring.grid, compared, scoring.evaluation.metric);
  return {
    baseline: walk.baseline,
    p_better: Number(rounded(pBetterOf(differences, scoring.grid.season, scoring.seed))),
  };
}

export function verdictOf(scoring: Scoring, baselines: readonly BaselineWalk[], answer: WalkedAnswer): Verdict {
  const badly = badlyOf(scoring, answer);
  if (badly !== undefined) {
    return { verdict: 'disqualified', because: 'answered_badly', detail: badly };
  }
  const candidate = Array.zipWith(scoring.rows, answer.q, ({ values }, forecast) => ({
    values,
    forecast,
    scale: scaleOf(scoring.grid, values),
  }));
  const { scores, coverage } = scoredOf(scoring.grid, candidate);
  const { coverageFloor, confidence } = scoring.evaluation;
  if (coverage === null || coverage < coverageFloor) {
    return {
      verdict: 'disqualified',
      because: 'coverage_below_floor',
      detail:
        coverage === null
          ? 'No held-back period had a truth to score its interval on'
          : `Its interval held ${figures.format(coverage)} of the truths, under the floor of ${figures.format(coverageFloor)}`,
    };
  }
  const against = baselines
    .filter(({ scored }) => scored.seriesWalked > 0)
    .map((walk) => againstOf(scoring, candidate, walk));
  const short = against.find(({ p_better: better }) => better < confidence);
  return short === undefined
    ? { verdict: 'scored', scores, coverage, against }
    : {
        verdict: 'disqualified',
        because: 'not_better',
        detail: `It beat ${short.baseline} with a confidence of ${figures.format(short.p_better)}, under the ${figures.format(confidence)} asked`,
      };
}
