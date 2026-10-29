import type { FunctionShape, TrainingRows } from '@on.auto/prediction-contract';

import { markColumns, marksOf } from '../calendar/periods.ts';
import { isObserved } from '../forecasts/fed-windows.ts';
import { featuresAt, levelAt, linearPath, type LinearModel, type LinearShape } from '../forecasts/linear-forecasts.ts';
import { conformalBounds, type ConformalBounds } from '../intervals/conformal.ts';
import { normalEquations, type NormalEquations } from './linear-system.ts';

export interface FittedLinear {
  readonly model: LinearModel;
  readonly bounds: ConformalBounds;
}

const penaltyAPerSample = 0.01;

const samplesAWeightNeeds = 4;

const nearestLags: readonly [number, ...number[]] = [1, 2, 3];

interface Calibrating {
  readonly model: LinearModel;
  readonly first: number;
  readonly steps: number;
}

export function linearShapeOf({ grain, season }: Pick<FunctionShape, 'grain' | 'season'>): LinearShape {
  const lags: readonly [number, ...number[]] =
    season === null || nearestLags.includes(season) ? nearestLags : [...nearestLags, season];
  return { lags, marks: marksOf(grain), level: Math.max(...lags) };
}

interface Fitting {
  readonly shape: LinearShape;
  readonly first: number;
  readonly holdout: number;
  readonly before: NormalEquations;
  readonly all: NormalEquations;
}

function addedSamplesOf(values: Readonly<Float64Array>, { shape, first, holdout, before, all }: Fitting): void {
  for (let target = 1; target < values.length; target += 1) {
    const level = levelAt(values, target - 1, shape.level);
    const truth = Number(values[target]);
    if (level !== undefined && isObserved(truth)) {
      const features = featuresAt(values, { target, period: first + target }, shape, level);
      all.add(features, truth / level);
      if (target < values.length - holdout) {
        before.add(features, truth / level);
      }
    }
  }
}

function weightsOf(training: TrainingRows, shape: LinearShape, holdout: number): readonly number[] | undefined {
  const width = 1 + shape.lags.length + markColumns(shape.marks);
  const fitting = {
    shape,
    first: training.first,
    holdout,
    before: normalEquations(width),
    all: normalEquations(width),
  };
  for (const values of training.series) {
    addedSamplesOf(values, fitting);
  }
  const equations = fitting.before.samples() >= samplesAWeightNeeds * width ? fitting.before : fitting.all;
  return equations.samples() === 0 ? undefined : equations.solved(penaltyAPerSample * equations.samples());
}

function residualsAt(
  { model, first, steps }: Calibrating,
  values: Readonly<Float64Array>,
  origin: number,
): readonly number[] {
  const path = linearPath(model, { y: values, origin, steps, at: first + origin });
  return Array.from({ length: steps }, (_, step) =>
    path === undefined ? Number.NaN : (Number(values[origin + step + 1]) - Number(path.values[step])) / path.level,
  );
}

function residualsOf(
  calibrating: Calibrating,
  training: TrainingRows,
  holdout: number,
): readonly (readonly number[])[] {
  const residuals = Array.from({ length: calibrating.steps }, (): number[] => []);
  const collected = (found: readonly number[]): void => {
    for (const [step, bucket] of residuals.entries()) {
      const residual = Number(found[step]);
      if (isObserved(residual)) {
        bucket.push(residual);
      }
    }
  };
  for (const values of training.series) {
    const last = values.length - 1;
    for (let origin = Math.max(0, last - holdout); origin < last; origin += 1) {
      collected(residualsAt(calibrating, values, origin));
    }
  }
  return residuals;
}

function precise(value: number): number {
  return Number(value.toPrecision(6));
}

export function fittedLinear(shape: FunctionShape, training: TrainingRows): FittedLinear | undefined {
  const linear = linearShapeOf(shape);
  const weights = weightsOf(training, linear, shape.holdout);
  if (weights === undefined) {
    return undefined;
  }
  const model = { ...linear, weights: weights.map((weight) => precise(weight)) };
  const calibrating = { model, first: training.first, steps: shape.fed.horizon };
  const bounds = conformalBounds(residualsOf(calibrating, training, shape.holdout));
  return {
    model,
    bounds: { low: bounds.low.map((low) => precise(low)), high: bounds.high.map((high) => precise(high)) },
  };
}
