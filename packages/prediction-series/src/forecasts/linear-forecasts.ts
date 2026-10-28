import { markedColumns, type Marks } from '../calendar/periods.ts';
import type { ConformalBounds } from '../intervals/conformal.ts';
import { isObserved, lastObservedAt, meanOf, observedBetween, type FedWindow, type Point } from './fed-windows.ts';
import { persistence } from './naive-forecasts.ts';

export interface LinearShape {
  readonly lags: readonly [number, ...number[]];
  readonly marks: Marks;
  readonly level: number;
}

export interface LinearModel extends LinearShape {
  readonly weights: readonly number[];
}

export interface Path {
  readonly values: readonly number[];
  readonly level: number;
}

export interface PathAsked {
  readonly y: Readonly<Float64Array>;
  readonly origin: number;
  readonly steps: number;
  readonly at: number;
}

export function levelAt(y: Readonly<Float64Array>, origin: number, periods: number): number | undefined {
  const level = meanOf(observedBetween(y, origin - periods + 1, origin).map((value) => Math.abs(value)));
  return level === undefined || level === 0 ? undefined : level;
}

export function featuresAt(
  path: Readonly<Float64Array>,
  { target, period }: { readonly target: number; readonly period: number },
  shape: LinearShape,
  level: number,
): readonly number[] {
  const lagged = shape.lags.map((lag) => {
    const value = lastObservedAt(path, target - lag);
    return isObserved(value) ? value / level : 1;
  });
  return [1, ...lagged, ...markedColumns(shape.marks, period)];
}

function dotted(weights: readonly number[], features: readonly number[]): number {
  return weights.reduce((sum, weight, at) => sum + weight * Number(features[at]), 0);
}

export function linearPath(model: LinearModel, { y, origin, steps, at }: PathAsked): Path | undefined {
  const level = levelAt(y, origin, model.level);
  if (level === undefined) {
    return undefined;
  }
  const path = new Float64Array(origin + 1 + steps).fill(Number.NaN);
  path.set(y.subarray(0, origin + 1));
  const values: number[] = [];
  for (let h = 1; h <= steps; h += 1) {
    const target = origin + h;
    const value = level * dotted(model.weights, featuresAt(path, { target, period: at + h }, model, level));
    path[target] = value;
    values.push(value);
  }
  return { values, level };
}

export interface LinearAsked {
  readonly window: FedWindow;
  readonly steps: number;
  readonly at: number;
  readonly bounds: ConformalBounds | null;
}

export function linearForecast(model: LinearModel, { window, steps, at, bounds }: LinearAsked): readonly Point[] {
  const path = linearPath(model, { y: window.y, origin: window.origin, steps, at });
  if (path === undefined || !path.values.every((value) => isObserved(value))) {
    return persistence({ window, steps, interval: bounds !== null });
  }
  return path.values.map((value, step) => ({
    value,
    low: value + path.level * (bounds?.low[step] ?? 0),
    high: value + path.level * (bounds?.high[step] ?? 0),
  }));
}
