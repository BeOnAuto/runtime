import { Option, Schema } from 'effect';

import type { Predicts } from '../document/prediction-document.ts';
import { isObserved } from '../forecast/history.ts';
import { forecastOf, type Forecast, type HistoryTooShort } from '../forecast/ladder.ts';
import type { Asked, PastTotal } from '../forecast/methods.ts';
import type { Point } from '../forecast/quantiles.ts';
import { longestSpanOf, periodsToTheEnd, startOfEnclosing, type Enclosing } from '../periods/enclosing.ts';
import { periodForm, type Grain } from '../periods/grains.ts';
import type { SeriesWindow } from '../window/series-window.ts';

export const QuestionSchema = Schema.Struct({
  series: Schema.String,
  horizon: Schema.optionalKey(Schema.Int),
  marks: Schema.optionalKey(Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.Number }))),
});

export type Question = typeof QuestionSchema.Type;

type ObservedPoint = { readonly at: string; readonly value: number };

type PredictedPoint = ObservedPoint & { readonly low: number; readonly high: number };

const enclosingPeriodsBeforeTheWindow = 4;

interface Calendar {
  readonly grain: Grain;
  readonly accumulates: Enclosing;
  readonly first: number;
  readonly reach: number;
  readonly periodsSoFar: number;
}

function pastTotalsBefore(calendar: Calendar, end: number): readonly PastTotal[] {
  const { grain, accumulates, first, reach, periodsSoFar } = calendar;
  const start = startOfEnclosing(grain, accumulates, end - 1);
  if (start < reach) {
    return [];
  }
  const origin = Math.min(start + periodsSoFar, end - 1) - 1;
  return [
    { origin: origin - first, periodsToTheEnd: periodsToTheEnd(grain, accumulates, origin) },
    ...pastTotalsBefore(calendar, start),
  ];
}

function forecastAskedOf({ period: grain, horizons, accumulates }: Predicts, window: SeriesWindow): Asked {
  if (accumulates === undefined) {
    return { kind: 'steps', steps: Math.max(...horizons) };
  }
  const start = startOfEnclosing(grain, accumulates, window.origin + 1);
  const periodsSoFar = window.origin + 1 - start;
  const reach = window.first - enclosingPeriodsBeforeTheWindow * Number(longestSpanOf(grain, accumulates));
  return {
    kind: 'total',
    periodsToTheEnd: periodsToTheEnd(grain, accumulates, window.origin),
    periodsSoFar,
    pastTotals: pastTotalsBefore({ grain, accumulates, first: window.first, reach, periodsSoFar }, start),
  };
}

export function forecastAt(predicts: Predicts, window: SeriesWindow): Forecast | HistoryTooShort {
  return forecastOf({
    observed: window.observed,
    season: predicts.season ?? null,
    coverage: predicts.coverage,
    asked: forecastAskedOf(predicts, window),
  });
}

function predictedPoint(grain: Grain, period: number, { value, low, high }: Point): PredictedPoint {
  return { at: periodForm(grain, period), value, low, high };
}

function predictedOf(
  { period: grain, horizons, accumulates }: Predicts,
  { origin }: SeriesWindow,
  question: Question,
  points: readonly Point[],
): readonly PredictedPoint[] {
  if (accumulates !== undefined) {
    return points.map((point) => predictedPoint(grain, origin + periodsToTheEnd(grain, accumulates, origin), point));
  }
  const asked = question.horizon === undefined ? horizons.toSorted((one, other) => one - other) : [question.horizon];
  return asked.map((horizon) =>
    predictedPoint(grain, origin + horizon, Option.getOrThrow(Option.fromNullishOr(points[horizon - 1]))),
  );
}

function observedOf(
  { observed, origin }: SeriesWindow,
  { period: grain, history }: Predicts,
): readonly ObservedPoint[] {
  const shownFrom = origin - history + 1;
  return observed
    .slice(observed.length - history)
    .flatMap((value, at) => (isObserved(value) ? [{ at: periodForm(grain, shownFrom + at), value }] : []));
}

export function predictionOf(
  predicts: Predicts,
  window: SeriesWindow,
  question: Question,
  points: readonly Point[],
): Schema.JsonObject {
  return {
    unit: predicts.unit,
    period: predicts.period,
    origin: periodForm(predicts.period, window.origin),
    lines: [
      { name: 'observed', points: observedOf(window, predicts) },
      {
        name: predicts.accumulates === undefined ? 'predicted' : 'total',
        points: predictedOf(predicts, window, question, points),
      },
    ],
    ...(question.marks === undefined ? {} : { marks: question.marks }),
  };
}
