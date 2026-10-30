import { residualHalfWidth } from '../intervals/residual-constants.ts';
import {
  deviationsOf,
  lastObservedAt,
  meanOf,
  observedBetween,
  rootMeanSquare,
  spreadAround,
  type FedWindow,
  type Point,
} from './fed-windows.ts';
import {
  levelAdjustedAt,
  levelErrors,
  observedPrefix,
  ratioAt,
  seasonalErrors,
  seasonalLagOf,
} from './seasonal-parts.ts';

export interface TotalAsked {
  readonly window: FedWindow;
  readonly periods: number;
  readonly soFar: number;
  readonly interval: boolean;
}

export interface SeasonalTotalAsked extends TotalAsked {
  readonly season: number;
}

export interface LevelTotalAsked extends SeasonalTotalAsked {
  readonly k: number;
}

export function runRate({ window, periods, soFar, interval }: TotalAsked): Point {
  const { y, origin } = window;
  const rated = observedBetween(y, origin - (soFar > 0 ? soFar : periods) + 1, origin);
  const rate = meanOf(rated);
  if (rate === undefined) {
    return spreadAround(0, 0);
  }
  const sigma = interval
    ? rootMeanSquare(deviationsOf(observedBetween(y, origin - Math.max(soFar, periods) + 1, origin)))
    : 0;
  const half = residualHalfWidth(sigma, 'drift', { h: periods, periods: rated.length + 1, season: 1 });
  return spreadAround(rate * periods, half);
}

function seasonalSum({ window, periods, season }: SeasonalTotalAsked): number {
  const lag = seasonalLagOf(season, periods);
  let total = 0;
  for (let step = 1; step <= periods; step += 1) {
    total += lastObservedAt(window.y, window.origin + step - lag);
  }
  return total;
}

function levelAdjustedSum({ window, periods, season }: SeasonalTotalAsked, ratio: number): number {
  let total = 0;
  for (let step = 1; step <= periods; step += 1) {
    total += levelAdjustedAt(window.y, { origin: window.origin, season, ratio, step });
  }
  return total;
}

function totalHalf(asked: SeasonalTotalAsked, sigma: number): number {
  const { window, periods, season } = asked;
  const reach = { h: seasonalLagOf(season, periods), periods: window.history, season };
  return residualHalfWidth(sigma, 'seasonal-naive', reach) * Math.sqrt(periods);
}

export function seasonalTotal(asked: SeasonalTotalAsked): Point {
  const { window, periods, season, interval } = asked;
  if (window.history < season + periods) {
    return runRate(asked);
  }
  const sigma = interval ? rootMeanSquare(seasonalErrors(window, season)) : 0;
  return spreadAround(seasonalSum(asked), totalHalf(asked, sigma));
}

export function levelAdjustedTotal(asked: LevelTotalAsked): Point {
  const { window, periods, season, k, interval } = asked;
  if (window.history < season + k + periods) {
    return seasonalTotal(asked);
  }
  const prefix = observedPrefix(window.y);
  const ratio = ratioAt(prefix, { origin: window.origin, season, k });
  const sigma = interval ? rootMeanSquare(levelErrors(window, prefix, { season, k })) : 0;
  return spreadAround(levelAdjustedSum(asked, ratio), totalHalf(asked, sigma));
}
