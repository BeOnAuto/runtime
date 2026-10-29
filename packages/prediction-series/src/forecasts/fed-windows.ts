export interface FedWindow {
  readonly y: Readonly<Float64Array>;
  readonly origin: number;
  readonly first: number;
  readonly history: number;
}

export interface Point {
  readonly value: number;
  readonly low: number;
  readonly high: number;
}

export function isObserved(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

export function windowOf(y: Readonly<Float64Array>): FedWindow {
  const origin = y.length - 1;
  const first = y.findIndex((value) => isObserved(value));
  return { y, origin, first, history: first === -1 ? 0 : origin - first + 1 };
}

export function lastObservedAt(y: Readonly<Float64Array>, at: number): number {
  for (let position = Math.min(at, y.length - 1); position >= 0; position -= 1) {
    const value = y[position];
    if (isObserved(value)) {
      return value;
    }
  }
  return Number.NaN;
}

export function rootMeanSquare(errors: readonly number[]): number {
  return errors.length === 0 ? 0 : Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length);
}

export function observedBetween(y: Readonly<Float64Array>, from: number, to: number): readonly number[] {
  return [...y.subarray(Math.max(0, from), Math.max(0, to + 1))].filter((value) => isObserved(value));
}

export function meanOf(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function deviationsOf(values: readonly number[]): readonly number[] {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.map((value) => value - mean);
}

export function spreadAround(value: number, half: number): Point {
  return { value, low: value - half, high: value + half };
}
