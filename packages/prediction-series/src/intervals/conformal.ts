export interface ConformalBounds {
  readonly low: readonly number[];
  readonly high: readonly number[];
}

const lowShare = 0.1;

const highShare = 0.9;

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

export function conformalBounds(residualsOfEachStep: readonly (readonly number[])[]): ConformalBounds {
  const low: number[] = [];
  const high: number[] = [];
  for (const residuals of residualsOfEachStep) {
    const lower = quantileOf(residuals, lowShare) ?? low.at(-1) ?? 0;
    const upper = quantileOf(residuals, highShare) ?? high.at(-1) ?? 0;
    low.push(Math.min(0, lower));
    high.push(Math.max(0, upper));
  }
  return { low, high };
}
