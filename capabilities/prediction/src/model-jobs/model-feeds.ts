import type { FedTensor, ModelFeeds } from '@on.auto/prediction-contract';
import { Schema } from 'effect';

import { BaselineSchema, MetricSchema } from '../document/evaluation-names.ts';
import { enclosings } from '../periods/enclosing.ts';
import { grains } from '../periods/grains.ts';

const Floats = Schema.declare((value: unknown): value is Float32Array => value instanceof Float32Array);

const Whole = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const FedShapeSchema = Schema.Struct({ features: Whole, given: Whole, horizon: Whole, totals: Schema.Boolean });

export const CheckJobSchema = Schema.Struct({
  runtime: Schema.String,
  model: Schema.String,
  threads: Whole,
  fed: FedShapeSchema,
});

export const RunJobSchema = Schema.Struct({
  runtime: Schema.String,
  model: Schema.String,
  threads: Whole,
  y: Floats,
  x: Schema.NullOr(Floats),
  given: Schema.NullOr(Floats),
  h: Schema.NullOr(Whole),
  at: Schema.NullOr(Schema.Int),
  features: Whole,
  givens: Whole,
});

export const WalkJobSchema = Schema.Struct({
  runtime: Schema.String,
  model: Schema.String,
  threads: Whole,
  rows: Schema.String,
  window: Whole,
  holdout: Whole,
  steps: Whole,
  features: Whole,
  given: Schema.Array(Whole),
  remaining: Schema.NullOr(Schema.Array(Whole)),
  first: Schema.NullOr(Schema.Int),
});

export type WalkJob = typeof WalkJobSchema.Type;

const FunctionShapeSchema = Schema.Struct({
  fed: FedShapeSchema,
  grain: Schema.Literals(grains),
  season: Schema.NullOr(Whole),
  accumulates: Schema.NullOr(Schema.Literals(enclosings)),
  holdout: Whole,
});

export const FitJobSchema = Schema.Struct({ runtime: Schema.String, rows: Schema.String, shape: FunctionShapeSchema });

export type FitJob = typeof FitJobSchema.Type;

export const DefaultJobSchema = Schema.Struct({ runtime: Schema.String, shape: FunctionShapeSchema });

export const WindowJobSchema = Schema.Struct({
  rows: Schema.String,
  series: Schema.String,
  features: Whole,
  grain: Schema.Literals(['day', 'week', 'month', 'quarter', 'year']),
  window: Whole,
});

export type WindowJob = typeof WindowJobSchema.Type;

export const BaselinesJobSchema = Schema.Struct({
  rows: Schema.String,
  period: Schema.Literals(grains),
  horizons: Schema.Array(Whole),
  accumulates: Schema.NullOr(Schema.Literals(enclosings)),
  season: Schema.NullOr(Whole),
  window: Whole,
  holdout: Whole,
  firstPeriod: Schema.String,
  baselines: Schema.Array(BaselineSchema),
  metric: MetricSchema,
});

export type BaselinesJob = typeof BaselinesJobSchema.Type;

export interface Fed {
  readonly y: Readonly<Float32Array>;
  readonly x: Readonly<Float32Array> | null;
  readonly given: Readonly<Float32Array> | null;
  readonly h: number | null;
  readonly at: number | null;
  readonly features: number;
  readonly givens: number;
}

function lastOf(values: Readonly<Float32Array>, periods: number, width: number): Float32Array {
  const taken = new Float32Array(periods * width).fill(Number.NaN);
  const kept = values.subarray(Math.max(0, values.length - periods * width));
  taken.set(kept, taken.length - kept.length);
  return taken;
}

function periodTensor(value: number): FedTensor {
  return { data: BigInt64Array.of(BigInt(value)), dims: [1] };
}

export function feedsOf({ y, x, given, h, at, features, givens }: Fed, length?: number): ModelFeeds {
  const periods = length ?? y.length;
  return {
    y: { data: lastOf(y, periods, 1), dims: [1, periods] },
    ...(x === null ? {} : { x: { data: lastOf(x, periods, features), dims: [1, periods, features] } }),
    ...(given === null ? {} : { given: { data: given, dims: [1, given.length / givens, givens] } }),
    ...(h === null ? {} : { h: periodTensor(h) }),
    ...(at === null ? {} : { at: periodTensor(at) }),
  };
}
