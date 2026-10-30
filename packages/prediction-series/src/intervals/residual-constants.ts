export type ResidualKind = 'naive' | 'seasonal-naive' | 'drift' | 'mean';

export interface Reach {
  readonly h: number;
  readonly periods: number;
  readonly season: number;
}

export const ninetiethPercentileOfTheNormal = 1.2815515655446004;

const constants: Readonly<Record<ResidualKind, (reach: Reach) => number>> = {
  naive: ({ h }) => Math.sqrt(h),
  'seasonal-naive': ({ h, season }) => Math.sqrt(Math.floor((h - 1) / season) + 1),
  drift: ({ h, periods }) => Math.sqrt(h * (1 + h / (periods - 1))),
  mean: ({ periods }) => Math.sqrt(1 + 1 / periods),
};

export function residualConstant(kind: ResidualKind, reach: Reach): number {
  return constants[kind](reach);
}

export function residualHalfWidth(sigma: number, kind: ResidualKind, reach: Reach): number {
  return ninetiethPercentileOfTheNormal * sigma * residualConstant(kind, reach);
}
