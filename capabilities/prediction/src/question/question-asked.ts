import { Schema } from 'effect';

import type { PredictionFunctionDefinitionDocument, Predicts } from '../document/prediction-document.ts';
import { enclosingOf, periodsToTheEnd } from '../periods/enclosing.ts';
import { periodForm } from '../periods/grains.ts';
import type { SeriesWindow } from './series-window.ts';

export const QuestionSchema = Schema.Struct({
  series: Schema.String,
  horizon: Schema.optionalKey(Schema.Int),
  given: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  marks: Schema.optionalKey(Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.Number }))),
});

export type Question = typeof QuestionSchema.Type;

interface AskedPoint {
  readonly step: number;
  readonly period: number;
}

export interface Asked {
  readonly steps: number;
  readonly summed: number | null;
  readonly points: readonly AskedPoint[];
}

type ObservedPoint = { readonly at: string; readonly value: number };

type PredictedPoint = ObservedPoint & { readonly low: number; readonly high: number };

export function askedOf({ period: grain, horizons, accumulates }: Predicts, origin: number, question: Question): Asked {
  if (accumulates === undefined) {
    const asked =
      question.horizon === undefined ? horizons.toSorted((left, right) => left - right) : [question.horizon];
    return {
      steps: Math.max(...horizons),
      summed: null,
      points: asked.map((horizon) => ({ step: horizon - 1, period: origin + horizon })),
    };
  }
  const remaining = periodsToTheEnd(grain, accumulates, origin);
  return { steps: remaining, summed: remaining, points: [{ step: 0, period: origin + remaining }] };
}

export function aheadOf({ period: grain, accumulates }: Predicts, origin: number) {
  return accumulates === undefined
    ? { line: 'predicted', record: {} }
    : { line: 'total', record: { total_to: periodForm(accumulates, enclosingOf(grain, accumulates, origin + 1)) } };
}

export function givenOf(
  document: PredictionFunctionDefinitionDocument,
  { given }: Question,
  steps: number,
): Float32Array | null {
  if (given === undefined) {
    return null;
  }
  const values = document.data.given.map((name) => Number(given[name]));
  return Float32Array.from(Array.from({ length: steps }, () => values).flat());
}

export function predictedOf(
  q: Readonly<Float32Array>,
  { period: grain }: Predicts,
  points: readonly AskedPoint[],
): readonly PredictedPoint[] | undefined {
  const predicted: readonly PredictedPoint[] = points.map(({ step, period }) => {
    const [low, value, high] = Array.from(q.subarray(step * 3, step * 3 + 3));
    return { at: periodForm(grain, period), value: Number(value), low: Number(low), high: Number(high) };
  });
  return predicted.every(({ low, value, high }) => [low, value, high].every((each) => Number.isFinite(each)))
    ? predicted
    : undefined;
}

export function observedOf(
  { y, origin }: SeriesWindow,
  { period: grain, history }: Predicts,
): readonly ObservedPoint[] {
  const first = origin - history + 1;
  const shown: readonly ObservedPoint[] = Array.from(y.subarray(y.length - history), (value, at) => ({
    at: periodForm(grain, first + at),
    value,
  }));
  return shown.filter(({ value }) => Number.isFinite(value));
}

export function originFormOf({ period }: Predicts, origin: number): string {
  return periodForm(period, origin);
}
