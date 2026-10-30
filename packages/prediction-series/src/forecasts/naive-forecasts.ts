import { residualHalfWidth } from '../intervals/residual-constants.ts';
import {
  deviationsOf,
  isObserved,
  lastObservedAt,
  meanOf,
  observedBetween,
  rootMeanSquare,
  spreadAround,
  type FedWindow,
  type Point,
} from './fed-windows.ts';

export interface StepsAsked {
  readonly window: FedWindow;
  readonly steps: number;
  readonly interval: boolean;
}

export function stepsOf(steps: number): readonly number[] {
  return Array.from({ length: steps }, (_, at) => at + 1);
}

function consecutiveChanges({ y, first, origin }: FedWindow): readonly number[] {
  const changes: number[] = [];
  for (let at = Math.max(1, first + 1); at <= origin; at += 1) {
    const change = Number(y[at]) - Number(y[at - 1]);
    if (isObserved(change)) {
      changes.push(change);
    }
  }
  return changes;
}

function lastObservedIndex({ y, origin, first }: FedWindow): number {
  let at = origin;
  while (at > first && !isObserved(y[at])) {
    at -= 1;
  }
  return at;
}

export function persistence({ window, steps, interval }: StepsAsked): readonly Point[] {
  const level = lastObservedAt(window.y, window.origin);
  const value = isObserved(level) ? level : 0;
  const sigma = interval ? rootMeanSquare(consecutiveChanges(window)) : 0;
  return stepsOf(steps).map((h) =>
    spreadAround(value, residualHalfWidth(sigma, 'naive', { h, periods: window.history, season: 1 })),
  );
}

export function historicMean({ window, steps, interval }: StepsAsked): readonly Point[] {
  const values = observedBetween(window.y, 0, window.origin);
  const mean = meanOf(values) ?? 0;
  const sigma = interval ? rootMeanSquare(deviationsOf(values)) : 0;
  const half = values.length === 0 ? 0 : residualHalfWidth(sigma, 'mean', { h: 1, periods: values.length, season: 1 });
  return stepsOf(steps).map(() => spreadAround(mean, half));
}

export function drift(asked: StepsAsked): readonly Point[] {
  const { window, steps, interval } = asked;
  const { y, first, origin } = window;
  const last = lastObservedIndex(window);
  if (first === -1 || last <= first) {
    return persistence(asked);
  }
  const ending = Number(y[last]);
  const slope = (ending - Number(y[first])) / (last - first);
  const periods = last - first + 1;
  const sigma = interval ? rootMeanSquare(consecutiveChanges(window).map((change) => change - slope)) : 0;
  return stepsOf(steps).map((h) => {
    const ahead = origin - last + h;
    return spreadAround(ending + ahead * slope, residualHalfWidth(sigma, 'drift', { h: ahead, periods, season: 1 }));
  });
}
