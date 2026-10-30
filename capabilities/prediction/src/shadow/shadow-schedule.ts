import { predictionBounds } from '../capability/prediction-bounds.ts';
import type { Predicts } from '../document/prediction-document.ts';
import { closeOf, enclosingOf, periodsToTheEnd } from '../periods/enclosing.ts';
import { periodForm } from '../periods/grains.ts';
import { periodOfMoment } from '../periods/moments.ts';

export const mostShadowCloses = predictionBounds.mostShadowPeriods;

export interface ShadowOrigin {
  readonly origin: number;
  readonly form: string;
  readonly closesAt: number;
}

export interface ShadowTarget {
  readonly form: string;
  readonly closesAt: number;
  readonly horizon: number | null;
  readonly first: number;
  readonly last: number;
}

function enclosingEnds({ period, accumulates }: Predicts, builtAt: number, closes: number): readonly number[] {
  if (accumulates === undefined) {
    return Array.from({ length: closes }, (_, close) => periodOfMoment(period, builtAt) + close);
  }
  const before = periodOfMoment(period, builtAt) - 1;
  return Array.from({ length: closes }).reduce<readonly number[]>((ends) => {
    const after = ends.at(-1) ?? before;
    return [...ends, after + periodsToTheEnd(period, accumulates, after)];
  }, []);
}

export function shadowOrigins(predicts: Predicts, builtAt: number, closes: number): readonly ShadowOrigin[] {
  return enclosingEnds(predicts, builtAt, closes).map((origin) => ({
    origin,
    form: periodForm(predicts.period, origin),
    closesAt: closeOf(predicts.period, origin),
  }));
}

export function targetsOf({ period, accumulates, horizons }: Predicts, origin: number): readonly ShadowTarget[] {
  if (accumulates === undefined) {
    return horizons.map((horizon) => ({
      form: periodForm(period, origin + horizon),
      closesAt: closeOf(period, origin + horizon),
      horizon,
      first: origin + horizon,
      last: origin + horizon,
    }));
  }
  const last = origin + periodsToTheEnd(period, accumulates, origin);
  return [
    {
      form: periodForm(accumulates, enclosingOf(period, accumulates, origin + 1)),
      closesAt: closeOf(period, last),
      horizon: null,
      first: origin + 1,
      last,
    },
  ];
}
