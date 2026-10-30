import { quantileOf } from './score-math.ts';
import { percentiles, type ScoringGrid } from './scoring-grid.ts';

export function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

export function observedUpTo(values: Readonly<Float64Array>, origin: number): number {
  return values.subarray(0, origin + 1).filter((value) => Number.isFinite(value)).length;
}

export function emptyForecast({ holdout, steps }: ScoringGrid): Float64Array {
  return new Float64Array(holdout * steps * percentiles).fill(Number.NaN);
}

export function seasonalLagOf(season: number, periods: number): number {
  return season * Math.ceil(periods / season);
}

export interface Placing {
  readonly value: number;
  readonly errors: readonly number[];
  readonly scale?: number;
}

export function placed(forecast: Readonly<Float64Array>, at: number, { value, errors, scale = 1 }: Placing): void {
  if (!finite(value)) {
    return;
  }
  const low = quantileOf(errors, 0.1) ?? 0;
  const high = quantileOf(errors, 0.9) ?? 0;
  forecast.set([value + scale * low, value, value + scale * high], at);
}
