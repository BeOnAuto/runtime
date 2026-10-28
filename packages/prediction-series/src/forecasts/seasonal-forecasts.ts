import { residualHalfWidth } from '../intervals/residual-constants.ts';
import { rootMeanSquare, spreadAround, type Point } from './fed-windows.ts';
import { persistence, stepsOf, type StepsAsked } from './naive-forecasts.ts';
import { levelAdjustedAt, levelErrors, observedPrefix, ratioAt, seasonalErrors } from './seasonal-parts.ts';

export interface SeasonalAsked extends StepsAsked {
  readonly season: number;
}

export interface LevelAsked extends SeasonalAsked {
  readonly k: number;
}

function seasonalPoints(asked: SeasonalAsked, sigma: number, ratio: number): readonly Point[] {
  const { window, steps, season } = asked;
  return stepsOf(steps).map((h) =>
    spreadAround(
      levelAdjustedAt(window.y, { origin: window.origin, season, ratio, step: h }),
      residualHalfWidth(sigma, 'seasonal-naive', { h, periods: window.history, season }),
    ),
  );
}

export function seasonalNaive(asked: SeasonalAsked): readonly Point[] {
  const { window, steps, season, interval } = asked;
  if (window.history < season + steps) {
    return persistence(asked);
  }
  return seasonalPoints(asked, interval ? rootMeanSquare(seasonalErrors(window, season)) : 0, 1);
}

export function levelAdjustedSeasonalNaive(asked: LevelAsked): readonly Point[] {
  const { window, steps, season, k, interval } = asked;
  if (window.history < season + k + steps) {
    return seasonalNaive(asked);
  }
  const prefix = observedPrefix(window.y);
  const sigma = interval ? rootMeanSquare(levelErrors(window, prefix, { season, k })) : 0;
  return seasonalPoints(asked, sigma, ratioAt(prefix, { origin: window.origin, season, k }));
}
