export interface History {
  readonly observed: readonly (number | null)[];
  readonly first: number;
  readonly origin: number;
  readonly periods: number;
}

export function isObserved(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function historyOf(observed: readonly (number | null)[]): History {
  const origin = observed.length - 1;
  const found = observed.findIndex((value) => isObserved(value));
  const first = found === -1 ? observed.length : found;
  return { observed, first, origin, periods: origin - first + 1 };
}

export function observedAt({ observed, first }: History, at: number): number | null {
  const value = at < first ? null : observed[at];
  return isObserved(value) ? value : null;
}

export function lastObservedAt(history: History, at: number): number {
  for (let position = at; position > history.first; position -= 1) {
    const value = observedAt(history, position);
    if (value !== null) {
      return value;
    }
  }
  return Number(observedAt(history, history.first));
}

export function sumOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function observedWithin(history: History, from: number, to: number): readonly number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, at) => from + at).flatMap((position) => {
    const value = observedAt(history, position);
    return value === null ? [] : [value];
  });
}

export function meanObservedWithin(history: History, from: number, to: number): number | null {
  const values = observedWithin(history, from, to);
  return values.length === 0 ? null : sumOf(values) / values.length;
}

export function sumWhollyObserved(history: History, from: number, to: number): number | null {
  const values = observedWithin(history, from, to);
  return values.length === to - from + 1 ? sumOf(values) : null;
}

export function isNeverNegative({ observed }: History): boolean {
  return observed.every((value) => !isObserved(value) || value >= 0);
}
