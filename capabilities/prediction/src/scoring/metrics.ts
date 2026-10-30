import type { Score } from '../facts/build-facts.ts';
import { covers, meanOf, quantileLoss, rounded, winklerScore, type Interval, type Metric } from './score-math.ts';
import { originAt, placeOf, truthAt, type ScoringGrid, type Slot } from './scoring-grid.ts';

export interface SeriesForecast {
  readonly values: Readonly<Float64Array>;
  readonly forecast: Readonly<Float64Array | Float32Array>;
  readonly scale: number | undefined;
}

interface Pair {
  readonly truth: number;
  readonly interval: Interval;
}

interface SeriesPairs {
  readonly pairs: readonly Pair[];
  readonly scale: number | undefined;
}

export interface Scored {
  readonly scores: readonly Score[];
  readonly coverage: number | null;
  readonly seriesWalked: number;
}

function pairAt(grid: ScoringGrid, { values, forecast }: SeriesForecast, at: number, slot: Slot): Pair | undefined {
  const truth = truthAt(grid, values, originAt(grid, at), slot);
  const place = placeOf(grid, at, slot);
  const [low, mid, high] = [Number(forecast[place]), Number(forecast[place + 1]), Number(forecast[place + 2])];
  return [truth, low, mid, high].every((value) => Number.isFinite(value))
    ? { truth, interval: { low, mid, high } }
    : undefined;
}

function pairsOf(grid: ScoringGrid, series: SeriesForecast, slot: Slot): readonly Pair[] {
  return Array.from({ length: grid.holdout }, (_, at) => pairAt(grid, series, at, slot)).filter(
    (pair) => pair !== undefined,
  );
}

function isScale(scale: number | undefined): scale is number {
  return scale !== undefined && scale > 0;
}

function lossOf(metric: Metric, { truth, interval }: Pair, scale: number | undefined): number {
  if (metric === 'winkler') {
    return winklerScore(truth, interval);
  }
  if (metric === 'quantile') {
    return quantileLoss(truth, interval);
  }
  return isScale(scale) ? Math.abs(truth - interval.mid) / scale : Number.NaN;
}

function averaged(perSeries: readonly (number | undefined)[]): number | null {
  return rounded(meanOf(perSeries.filter((value): value is number => value !== undefined && Number.isFinite(value))));
}

function scoreOf(grid: ScoringGrid, series: readonly SeriesForecast[], slot: Slot): Score {
  const each = series.map((one): SeriesPairs => ({ pairs: pairsOf(grid, one, slot), scale: one.scale }));
  const metricOf = (metric: Metric) =>
    averaged(each.map(({ pairs, scale }) => meanOf(pairs.map((pair) => lossOf(metric, pair, scale)))));
  return {
    horizon: slot.horizon,
    pairs: each.reduce((total, { pairs }) => total + pairs.length, 0),
    mase: metricOf('mase'),
    winkler: metricOf('winkler'),
    quantile: metricOf('quantile'),
  };
}

export function scoredOf(grid: ScoringGrid, series: readonly SeriesForecast[]): Scored {
  const pairs = series.map((one): readonly Pair[] => grid.slots.flatMap((slot) => pairsOf(grid, one, slot)));
  const all = pairs.flat();
  return {
    scores: grid.slots.map((slot) => scoreOf(grid, series, slot)),
    coverage: rounded(meanOf(all.map(({ truth, interval }) => (covers(truth, interval) ? 1 : 0)))),
    seriesWalked: pairs.filter((ofOne) => ofOne.length > 0).length,
  };
}

function finiteLossesOf(grid: ScoringGrid, series: SeriesForecast, metric: Metric): readonly number[] {
  return grid.slots
    .flatMap((slot) => pairsOf(grid, series, slot).map((pair) => lossOf(metric, pair, series.scale)))
    .filter((loss) => Number.isFinite(loss));
}

export function losesNothing(grid: ScoringGrid, series: readonly SeriesForecast[], metric: Metric): boolean {
  const losses = series.flatMap((one) => finiteLossesOf(grid, one, metric));
  return losses.length > 0 && losses.every((loss) => loss === 0);
}

function holdsATruth(grid: ScoringGrid, values: Readonly<Float64Array>): boolean {
  return grid.slots.some((slot) =>
    Array.from({ length: grid.holdout }, (_, at) => truthAt(grid, values, originAt(grid, at), slot)).some((truth) =>
      Number.isFinite(truth),
    ),
  );
}

export function judgesNoPeriodHeldBack(
  grid: ScoringGrid,
  series: readonly Pick<SeriesForecast, 'values' | 'scale'>[],
  metric: Metric,
): boolean {
  return !series.some(({ values, scale }) => holdsATruth(grid, values) && (metric !== 'mase' || isScale(scale)));
}

export function primaryOf(scores: readonly Score[], metric: Metric): number | undefined {
  return meanOf(
    scores.flatMap((score) => {
      const value = score[metric];
      return value === null ? [] : [value];
    }),
  );
}

export interface Compared {
  readonly candidate: SeriesForecast;
  readonly baseline: SeriesForecast;
}

interface Comparing {
  readonly grid: ScoringGrid;
  readonly metric: Metric;
}

function differenceAt({ grid, metric }: Comparing, at: number, slot: Slot, compared: Compared): readonly number[] {
  const ofCandidate = pairAt(grid, compared.candidate, at, slot);
  const ofBaseline = pairAt(grid, compared.baseline, at, slot);
  if (ofCandidate === undefined || ofBaseline === undefined) {
    return [];
  }
  const difference =
    lossOf(metric, ofCandidate, compared.candidate.scale) - lossOf(metric, ofBaseline, compared.baseline.scale);
  return Number.isFinite(difference) ? [difference] : [];
}

export function originDifferences(grid: ScoringGrid, compared: readonly Compared[], metric: Metric): readonly number[] {
  const differences: number[] = [];
  for (let at = 0; at < grid.holdout; at += 1) {
    const mean = meanOf(
      compared.flatMap((pair) => grid.slots.flatMap((slot) => differenceAt({ grid, metric }, at, slot, pair))),
    );
    if (mean !== undefined) {
      differences.push(mean);
    }
  }
  return differences;
}
