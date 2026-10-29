import type { Predicts } from '../document/prediction-document.ts';
import { periodsToTheEnd, startOfEnclosing } from '../periods/enclosing.ts';
import { periodOfForm } from '../periods/grains.ts';

export interface Slot {
  readonly horizon: number | null;
  readonly step: number;
}

interface Accumulated {
  readonly remaining: readonly number[];
  readonly starts: readonly number[];
}

export interface ScoringGrid {
  readonly first: number;
  readonly window: number;
  readonly holdout: number;
  readonly training: number;
  readonly steps: number;
  readonly slots: readonly Slot[];
  readonly season: number | undefined;
  readonly accumulated: Accumulated | undefined;
}

export interface GridOf {
  readonly window: number;
  readonly holdout: number;
  readonly firstPeriod: string;
}

export const percentiles = 3;

export type GridReach = Pick<Predicts, 'period' | 'season' | 'horizons' | 'accumulates'>;

function accumulatedOf({ period, accumulates }: GridReach, first: number, window: number): Accumulated | undefined {
  if (accumulates === undefined) {
    return undefined;
  }
  const positions = Array.from({ length: window }, (_, position) => position);
  return {
    remaining: positions.map((position) => periodsToTheEnd(period, accumulates, first + position)),
    starts: positions.map((position) => startOfEnclosing(period, accumulates, first + position + 1) - first),
  };
}

export function scoringGridOf(predicts: GridReach, { window, holdout, firstPeriod }: GridOf): ScoringGrid {
  const first = Number(periodOfForm(predicts.period, firstPeriod));
  const accumulated = accumulatedOf(predicts, first, window);
  const steps = Math.max(0, ...predicts.horizons);
  return {
    first,
    window,
    holdout,
    training: window - holdout,
    steps: accumulated === undefined ? steps : 1,
    slots:
      accumulated === undefined
        ? predicts.horizons.map((horizon) => ({ horizon, step: horizon - 1 }))
        : [{ horizon: null, step: 0 }],
    season: predicts.season,
    accumulated,
  };
}

export function originAt({ window, holdout }: ScoringGrid, at: number): number {
  return window - holdout + at;
}

export function placeOf({ steps }: ScoringGrid, at: number, { step }: Slot): number {
  return (at * steps + step) * percentiles;
}

export function summed(values: Readonly<Float64Array>, from: number, to: number): number {
  let total = 0;
  for (let position = from; position <= to; position += 1) {
    total += Number(values[position]);
  }
  return total;
}

export function truthAt(grid: ScoringGrid, values: Readonly<Float64Array>, origin: number, { horizon }: Slot): number {
  if (grid.accumulated === undefined) {
    const target = origin + Number(horizon);
    return target < grid.window ? Number(values[target]) : Number.NaN;
  }
  const end = origin + Number(grid.accumulated.remaining[origin]);
  return end < grid.window ? summed(values, origin + 1, end) : Number.NaN;
}

export function remainingOfTheOrigins({ accumulated, window, holdout }: ScoringGrid): readonly number[] | null {
  return accumulated === undefined ? null : accumulated.remaining.slice(window - holdout);
}
