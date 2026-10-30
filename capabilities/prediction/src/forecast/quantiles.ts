export interface Point {
  readonly value: number;
  readonly low: number;
  readonly high: number;
}

interface RangeRule {
  readonly coverage: number;
  readonly neverNegative: boolean;
}

function quantileOf(misses: readonly number[], share: number): number {
  const sorted = misses.toSorted((one, other) => one - other);
  const place = share * (sorted.length - 1);
  const below = Math.floor(place);
  const low = Number(sorted[below]);
  const high = Number(sorted[Math.min(below + 1, sorted.length - 1)]);
  return low + (place - below) * (high - low);
}

export function rangeAround(value: number, misses: readonly number[], { coverage, neverNegative }: RangeRule): Point {
  const low = Math.min(value + quantileOf(misses, (1 - coverage) / 2), value);
  const high = Math.max(value + quantileOf(misses, (1 + coverage) / 2), value);
  return { value, low: neverNegative ? Math.max(low, 0) : low, high };
}
