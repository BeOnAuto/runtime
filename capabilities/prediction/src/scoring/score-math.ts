export type Metric = 'mase' | 'winkler' | 'quantile';

export interface Interval {
  readonly low: number;
  readonly mid: number;
  readonly high: number;
}

const winklerAlpha = 0.2;

const significantDigits = 6;

function pinball(truth: number, forecast: number, share: number): number {
  return truth >= forecast ? share * (truth - forecast) : (1 - share) * (forecast - truth);
}

export function quantileLoss(truth: number, { low, mid, high }: Interval): number {
  return pinball(truth, low, 0.1) + pinball(truth, mid, 0.5) + pinball(truth, high, 0.9);
}

export function winklerScore(truth: number, { low, high }: Interval): number {
  const width = high - low;
  if (truth < low) {
    return width + (2 / winklerAlpha) * (low - truth);
  }
  return truth > high ? width + (2 / winklerAlpha) * (truth - high) : width;
}

export function covers(truth: number, { low, high }: Interval): boolean {
  return truth >= low && truth <= high;
}

export function meanOf(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function quantileOf(values: readonly number[], share: number): number | undefined {
  const sorted = values.toSorted((one, other) => one - other);
  const place = share * (sorted.length - 1);
  const below = Math.floor(place);
  const low = sorted[below];
  if (low === undefined) {
    return undefined;
  }
  const high = Number(sorted[Math.min(below + 1, sorted.length - 1)]);
  return low + (place - below) * (high - low);
}

export function rounded(value: number | undefined): number | null {
  return value === undefined ? null : Number(value.toPrecision(significantDigits));
}
