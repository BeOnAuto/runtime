import { Option, Schema } from 'effect';

import type { Score } from '../facts/build-facts.ts';
import type { ShadowGrade } from '../models/model-state.ts';
import type { Metric } from '../scoring/score-math.ts';
import { meanOf, quantileLoss, rounded, winklerScore, type Interval } from '../scoring/score-math.ts';
import type { Truthful } from './shadow-truths.ts';

const PredictionsSchema = Schema.fromJsonString(
  Schema.Struct({
    origin: Schema.String,
    series: Schema.Array(
      Schema.Struct({
        series: Schema.String,
        q: Schema.Array(Schema.NullOr(Schema.Number)),
        scale: Schema.NullOr(Schema.Number),
      }),
    ),
  }),
);

export type Predictions = typeof PredictionsSchema.Type;

const decodePredictions = Schema.decodeUnknownOption(PredictionsSchema);

export function predictionsOf(text: string, origin: string): Predictions {
  return Option.getOrElse(decodePredictions(text), () => ({ origin, series: [] }));
}

export interface Aimed {
  readonly predictions: Predictions;
  readonly horizon: number | null;
}

interface Losses {
  readonly mase: readonly number[];
  readonly winkler: readonly number[];
  readonly quantile: readonly number[];
}

interface Pair {
  readonly series: string;
  readonly truth: number;
  readonly found: Answered;
}

interface Answered {
  readonly interval: Interval;
  readonly scale: number | null;
}

interface AimedLosses {
  readonly horizon: number | null;
  readonly losses: Losses;
  readonly answered: number;
  readonly missing: number;
}

interface Weighted {
  readonly value: number;
  readonly pairs: number;
}

export interface Graded {
  readonly scores: readonly Score[];
  readonly graded: number;
  readonly answered: number;
  readonly missing: number;
}

function intervalAt(q: readonly (number | null)[], step: number): Interval {
  const at = (index: number) => q[index] ?? Number.NaN;
  return { low: at(step * 3), mid: at(step * 3 + 1), high: at(step * 3 + 2) };
}

function answeredOf({ predictions, horizon }: Aimed): ReadonlyMap<string, Answered> {
  const step = horizon === null ? 0 : horizon - 1;
  return new Map(
    predictions.series.flatMap(({ series, q, scale }) => {
      const interval = intervalAt(q, step);
      const finite = [interval.low, interval.mid, interval.high].every((value) => Number.isFinite(value));
      return finite ? [[series, { interval, scale }] as const] : [];
    }),
  );
}

function scored(paired: readonly Pair[]): Losses {
  return {
    mase: paired.flatMap(({ truth, found: { interval, scale } }) =>
      scale !== null && scale > 0 ? [Math.abs(truth - interval.mid) / scale] : [],
    ),
    winkler: paired.map(({ truth, found }) => winklerScore(truth, found.interval)),
    quantile: paired.map(({ truth, found }) => quantileLoss(truth, found.interval)),
  };
}

function lossesOf(own: Aimed, other: Aimed | undefined, { truths, absentIsZero }: Truthful): AimedLosses {
  const mine = answeredOf(own);
  const theirs = other === undefined ? new Map<string, Answered>() : answeredOf(other);
  const answered = own.predictions.series.flatMap(({ series }): readonly Pair[] => {
    const truth = truths.get(series) ?? (absentIsZero ? 0 : undefined);
    const found = mine.get(series);
    return truth === undefined || found === undefined ? [] : [{ series, truth, found }];
  });
  return {
    horizon: own.horizon,
    losses: scored(answered.filter(({ series }) => theirs.has(series))),
    answered: answered.length,
    missing: own.predictions.series.length - answered.length,
  };
}

function matchOf(own: Aimed, others: readonly Aimed[]): Aimed | undefined {
  return others.find(
    ({ predictions, horizon }) => predictions.origin === own.predictions.origin && horizon === own.horizon,
  );
}

export function gradeOf(aimed: readonly Aimed[], others: readonly Aimed[], truthful: Truthful): Graded {
  const each = aimed.map((own) => lossesOf(own, matchOf(own, others), truthful));
  return {
    scores: each.map(({ horizon, losses }) => ({
      horizon,
      pairs: losses.winkler.length,
      mase: rounded(meanOf(losses.mase)),
      winkler: rounded(meanOf(losses.winkler)),
      quantile: rounded(meanOf(losses.quantile)),
    })),
    graded: each.reduce((total, { losses }) => total + losses.winkler.length, 0),
    answered: each.reduce((total, { answered }) => total + answered, 0),
    missing: each.reduce((total, { missing }) => total + missing, 0),
  };
}

function figureOf(grades: readonly ShadowGrade[], metric: Metric): number | null {
  const weighted = grades.flatMap(({ scores }) =>
    scores.flatMap((score): readonly Weighted[] => {
      const value = score[metric];
      return value === null ? [] : [{ value, pairs: score.pairs }];
    }),
  );
  const pairs = weighted.reduce((total, { pairs: counted }) => total + counted, 0);
  return pairs === 0
    ? null
    : rounded(weighted.reduce((total, { value, pairs: counted }) => total + value * counted, 0) / pairs);
}

function answeredIn(grades: readonly ShadowGrade[]): number {
  return grades.reduce((total, { answered }) => total + answered, 0);
}

function pairedIn(grades: readonly ShadowGrade[]): number {
  return grades.reduce((total, { graded }) => total + graded, 0);
}

export interface Verdict {
  readonly passed: boolean;
  readonly challenger: number | null;
  readonly active: number | null;
  readonly ungradedCloses?: number;
}

export function shadowVerdictOf(grades: readonly ShadowGrade[], version: number, metric: Metric): Verdict | undefined {
  const own = grades.filter(({ version: of, of: graded }) => of === version && graded === version);
  const others = grades.filter(({ version: of, of: graded }) => of === version && graded !== version);
  const challenger = figureOf(own, metric);
  const active = figureOf(others, metric);
  if (answeredIn(own) === 0) {
    return answeredIn(others) === 0 ? undefined : { passed: false, challenger, active };
  }
  if (answeredIn(others) === 0) {
    return { passed: true, challenger, active };
  }
  if (pairedIn(own) === 0) {
    return undefined;
  }
  return { passed: challenger === null || active === null || challenger <= active, challenger, active };
}
