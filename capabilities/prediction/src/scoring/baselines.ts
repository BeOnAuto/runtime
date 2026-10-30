import type { Baseline, Evaluation } from '../document/prediction-document.ts';
import type { SeriesRows } from '../files/series-rows.ts';
import { accumulatedForecast, runRateScale } from './accumulated-baselines.ts';
import { emptyForecast, finite, observedUpTo, placed, seasonalLagOf } from './forecast-parts.ts';
import { scoredOf, type Scored, type SeriesForecast } from './metrics.ts';
import { meanOf } from './score-math.ts';
import { originAt, placeOf, type ScoringGrid } from './scoring-grid.ts';

function lastObserved(values: Readonly<Float64Array>, origin: number): number {
  for (let position = origin; position >= 0; position -= 1) {
    const value = values[position];
    if (finite(value)) {
      return value;
    }
  }
  return Number.NaN;
}

function errorsAtLag(values: Readonly<Float64Array>, training: number, lag: number): readonly number[] {
  const errors: number[] = [];
  for (let position = lag; position < training; position += 1) {
    const error = Number(values[position]) - Number(values[position - lag]);
    if (Number.isFinite(error)) {
      errors.push(error);
    }
  }
  return errors;
}

interface Step {
  readonly origin: number;
  readonly horizon: number;
  readonly lag: number;
}

function stepValue(
  values: Readonly<Float64Array>,
  baseline: Baseline,
  season: number,
  { origin, horizon, lag }: Step,
): number {
  if (baseline === 'persistence') {
    return lastObserved(values, origin);
  }
  return observedUpTo(values, origin) < season ? Number.NaN : Number(values[origin + horizon - lag]);
}

function stepForecast(grid: ScoringGrid, values: Readonly<Float64Array>, baseline: Baseline): Float64Array {
  const forecast = emptyForecast(grid);
  const season = Number(grid.season);
  for (const slot of grid.slots) {
    const horizon = Number(slot.horizon);
    const lag = baseline === 'persistence' ? horizon : seasonalLagOf(season, horizon);
    const errors = errorsAtLag(values, grid.training, lag);
    for (let at = 0; at < grid.holdout; at += 1) {
      const value = stepValue(values, baseline, season, { origin: originAt(grid, at), horizon, lag });
      placed(forecast, placeOf(grid, at, slot), { value, errors });
    }
  }
  return forecast;
}

export function baselineForecast(grid: ScoringGrid, values: Readonly<Float64Array>, baseline: Baseline): Float64Array {
  return grid.accumulated === undefined
    ? stepForecast(grid, values, baseline)
    : accumulatedForecast(grid, grid.accumulated, values, baseline);
}

export function scaleOf(grid: ScoringGrid, values: Readonly<Float64Array>): number | undefined {
  if (grid.accumulated !== undefined) {
    return runRateScale(grid, grid.accumulated, values);
  }
  const errors = errorsAtLag(values, grid.training, grid.season ?? 1);
  return meanOf(errors.map((error) => Math.abs(error)));
}

export interface BaselineWalk {
  readonly baseline: Baseline;
  readonly forecasts: readonly SeriesForecast[];
  readonly scored: Scored;
}

interface WalkedRows {
  readonly grid: ScoringGrid;
  readonly rows: readonly SeriesRows[];
}

export function baselineWalk({ grid, rows }: WalkedRows, baseline: Baseline): BaselineWalk {
  const forecasts = rows.map(({ values }) => ({
    values,
    forecast: baselineForecast(grid, values, baseline),
    scale: scaleOf(grid, values),
  }));
  return { baseline, forecasts, scored: scoredOf(grid, forecasts) };
}

export function baselineWalks(
  walked: WalkedRows & { readonly evaluation: Pick<Evaluation, 'baselines'> },
): readonly BaselineWalk[] {
  return walked.evaluation.baselines.map((baseline) => baselineWalk(walked, baseline));
}
