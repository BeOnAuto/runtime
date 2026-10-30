const figures = new Intl.NumberFormat('en', { maximumFractionDigits: 20 });

export const mostObservedDecimals = 2;

export function figure(count: number): string {
  return figures.format(count);
}

export function observedFigure(value: number, decimals: number): string {
  return new Intl.NumberFormat('en', { maximumFractionDigits: Math.min(decimals, mostObservedDecimals) }).format(value);
}

function decimalsOfValue(value: number): number {
  const fitting = Array.from({ length: mostObservedDecimals }, (_, at) => at).find(
    (decimals) => Number(value.toFixed(decimals)) === value,
  );
  return fitting ?? mostObservedDecimals;
}

export function decimalsObserved(values: ArrayLike<number>): number {
  return Array.from(values)
    .filter((value) => Number.isFinite(value))
    .reduce((most, value) => Math.max(most, decimalsOfValue(value)), 0);
}
