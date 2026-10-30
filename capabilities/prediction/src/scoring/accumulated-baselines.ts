import type { Baseline } from '../document/prediction-document.ts';
import { emptyForecast, finite, observedUpTo, placed, seasonalLagOf } from './forecast-parts.ts';
import { meanOf } from './score-math.ts';
import { originAt, placeOf, summed, type ScoringGrid } from './scoring-grid.ts';

interface Accumulated {
  readonly remaining: readonly number[];
  readonly starts: readonly number[];
}

type TotalAt = (origin: number) => number;

const totalSlot = { horizon: null, step: 0 };

interface InSample {
  readonly scaled: readonly number[];
  readonly absolute: readonly number[];
}

function observedBetween(values: Readonly<Float64Array>, from: number, to: number): readonly number[] {
  return [...values.subarray(Math.max(0, from), to + 1)].filter((value) => Number.isFinite(value));
}

function runRateOf(accumulated: Accumulated, values: Readonly<Float64Array>): TotalAt {
  return (origin) => {
    const remaining = Number(accumulated.remaining[origin]);
    const soFar = observedBetween(values, Number(accumulated.starts[origin]), origin);
    const recent = soFar.length > 0 ? soFar : observedBetween(values, origin + 1 - remaining, origin);
    const rate = meanOf(recent);
    return rate === undefined ? Number.NaN : rate * remaining;
  };
}

function seasonalSumOf(grid: ScoringGrid, accumulated: Accumulated, values: Readonly<Float64Array>): TotalAt {
  const season = Number(grid.season);
  return (origin) => {
    const remaining = Number(accumulated.remaining[origin]);
    const lag = seasonalLagOf(season, remaining);
    return observedUpTo(values, origin) < season
      ? Number.NaN
      : summed(values, origin + 1 - lag, origin + remaining - lag);
  };
}

function inSampleOf(
  grid: ScoringGrid,
  accumulated: Accumulated,
  values: Readonly<Float64Array>,
  totalAt: TotalAt,
): InSample {
  const scaled: number[] = [];
  const absolute: number[] = [];
  for (let origin = 0; origin < grid.training; origin += 1) {
    const remaining = Number(accumulated.remaining[origin]);
    const error =
      origin + remaining < grid.training
        ? summed(values, origin + 1, origin + remaining) - totalAt(origin)
        : Number.NaN;
    if (finite(error)) {
      scaled.push(error / remaining);
      absolute.push(Math.abs(error));
    }
  }
  return { scaled, absolute };
}

export function accumulatedForecast(
  grid: ScoringGrid,
  accumulated: Accumulated,
  values: Readonly<Float64Array>,
  baseline: Baseline,
): Float64Array {
  const totalAt =
    baseline === 'persistence' ? runRateOf(accumulated, values) : seasonalSumOf(grid, accumulated, values);
  const { scaled } = inSampleOf(grid, accumulated, values, totalAt);
  const forecast = emptyForecast(grid);
  for (let at = 0; at < grid.holdout; at += 1) {
    const origin = originAt(grid, at);
    placed(forecast, placeOf(grid, at, totalSlot), {
      value: totalAt(origin),
      errors: scaled,
      scale: Number(accumulated.remaining[origin]),
    });
  }
  return forecast;
}

export function runRateScale(
  grid: ScoringGrid,
  accumulated: Accumulated,
  values: Readonly<Float64Array>,
): number | undefined {
  return meanOf(inSampleOf(grid, accumulated, values, runRateOf(accumulated, values)).absolute);
}
