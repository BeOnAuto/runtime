import { isObserved, lastObservedAt, type FedWindow } from './fed-windows.ts';

export interface ObservedPrefix {
  readonly sums: Readonly<Float64Array>;
  readonly counts: Readonly<Uint32Array>;
}

export interface LevelReach {
  readonly season: number;
  readonly k: number;
}

export interface LevelledStep {
  readonly origin: number;
  readonly season: number;
  readonly ratio: number;
  readonly step: number;
}

export function seasonalLagOf(season: number, periods: number): number {
  return season * Math.ceil(periods / season);
}

export function levelAdjustedAt(y: Readonly<Float64Array>, { origin, season, ratio, step }: LevelledStep): number {
  const lag = seasonalLagOf(season, step);
  const seasonal = lastObservedAt(y, origin + step - lag);
  const levelled = seasonal * ratio ** (lag / season);
  return Number.isFinite(levelled) ? levelled : seasonal;
}

export function observedPrefix(y: Readonly<Float64Array>): ObservedPrefix {
  const sums = new Float64Array(y.length + 1);
  const counts = new Uint32Array(y.length + 1);
  for (const [at, value] of y.entries()) {
    const seen = isObserved(value);
    sums[at + 1] = Number(sums[at]) + (seen ? value : 0);
    counts[at + 1] = Number(counts[at]) + (seen ? 1 : 0);
  }
  return { sums, counts };
}

function meanWithin({ sums, counts }: ObservedPrefix, from: number, to: number): number | undefined {
  const start = Math.max(0, from);
  const count = Number(counts[to + 1]) - Number(counts[start]);
  return count === 0 ? undefined : (Number(sums[to + 1]) - Number(sums[start])) / count;
}

export function ratioAt(
  prefix: ObservedPrefix,
  { origin, season, k }: LevelReach & { readonly origin: number },
): number {
  const recent = meanWithin(prefix, origin - k + 1, origin);
  const earlier = meanWithin(prefix, origin - k + 1 - season, origin - season);
  const ratio = recent === undefined || earlier === undefined || earlier === 0 ? 1 : recent / earlier;
  return Number.isFinite(ratio) && ratio >= 0 ? ratio : 1;
}

export function seasonalErrors({ y, first, origin }: FedWindow, season: number): readonly number[] {
  const errors: number[] = [];
  for (let at = Math.max(season, first + season); at <= origin; at += 1) {
    const error = Number(y[at]) - Number(y[at - season]);
    if (isObserved(error)) {
      errors.push(error);
    }
  }
  return errors;
}

export function levelErrors(
  { y, first, origin }: FedWindow,
  prefix: ObservedPrefix,
  { season, k }: LevelReach,
): readonly number[] {
  const errors: number[] = [];
  for (let at = Math.max(0, first) + season + k; at <= origin; at += 1) {
    const forecast = lastObservedAt(y, at - season) * ratioAt(prefix, { origin: at - 1, season, k });
    const error = Number(y[at]) - forecast;
    if (isObserved(error)) {
      errors.push(error);
    }
  }
  return errors;
}
