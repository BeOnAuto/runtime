import { outputInWords } from '@on.auto/definitions';
import { listed } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { methodNames, type MethodName } from '../forecast/methods.ts';
import { mostObservedDecimals, observedFigure } from './figures.ts';

const PredictedPointSchema = Schema.Struct({
  at: Schema.String,
  value: Schema.Number,
  low: Schema.Number,
  high: Schema.Number,
});

const PredictionSchema = Schema.Struct({
  unit: Schema.String,
  origin: Schema.String,
  lines: Schema.Tuple([
    Schema.Struct({ name: Schema.Literal('observed') }),
    Schema.Struct({
      name: Schema.Literals(['predicted', 'total']),
      points: Schema.NonEmptyArray(PredictedPointSchema),
    }),
  ]),
});

const methodWords: Readonly<Record<MethodName, string>> = {
  'level-adjusted-seasonal-naive': 'repeating the periods a season earlier at the level of the last ones',
  'seasonal-naive': 'repeating the periods a season earlier',
  persistence: 'carrying the last observed value forward',
  'run-rate': 'running the pace of the periods so far to the end',
};

const RecordSchema = Schema.Struct({
  method: Schema.optionalKey(Schema.Literals(methodNames)),
  coverage: Schema.optionalKey(Schema.Number),
  total_to: Schema.optionalKey(Schema.String),
  decimals: Schema.optionalKey(Schema.Int),
});

const decodePrediction = Schema.decodeUnknownOption(PredictionSchema);

const decodeRecord = Schema.decodeUnknownOption(RecordSchema);

const asAResult = outputInWords('result');

type PredictedPoint = typeof PredictedPointSchema.Type;

type Recorded = typeof RecordSchema.Type;

function rangeWords({ low, high }: PredictedPoint, unit: string, decimals: number): string {
  return `(${observedFigure(low, decimals)} to ${observedFigure(high, decimals)} ${unit})`;
}

function pointWords(point: PredictedPoint, unit: string, decimals: number): string {
  return `${observedFigure(point.value, decimals)} ${unit} in ${point.at} ${rangeWords(point, unit, decimals)}`;
}

function totalWords(point: PredictedPoint, unit: string, recorded: Recorded, decimals: number): string {
  const to = recorded.total_to ?? point.at;
  return `${observedFigure(point.value, decimals)} ${unit} by the end of ${to} ${rangeWords(point, unit, decimals)}`;
}

function coverageWords(coverage: number): string {
  const tenths = Math.round(coverage * 10);
  if (tenths / 10 === coverage) {
    return `${tenths} times in 10`;
  }
  const twentieths = Math.round(coverage * 20);
  return twentieths / 20 === coverage
    ? `${twentieths} times in 20`
    : `${observedFigure(coverage * 100, 1)}% of the time`;
}

function forecastWords({ method, coverage }: Recorded, ranges: string): string {
  const held = coverage === undefined ? '' : `, ${ranges} meant to hold the truth ${coverageWords(coverage)}`;
  return `${held}${method === undefined ? '' : `, by ${methodWords[method]}`}`;
}

function predictionWords({ unit, origin, lines }: typeof PredictionSchema.Type, record: unknown): string {
  const [, { name, points }] = lines;
  const recorded = Option.getOrElse(decodeRecord(record), (): Recorded => ({}));
  const decimals = recorded.decimals ?? mostObservedDecimals;
  const said =
    name === 'total'
      ? totalWords(points[0], unit, recorded, decimals)
      : listed(points.map((point) => pointWords(point, unit, decimals)));
  const ranges = points.length === 1 ? 'its range' : 'each range';
  return `From ${origin}, it predicts ${said}${forecastWords(recorded, ranges)}.`;
}

export function describeOutput(output: Schema.Json, record?: Schema.JsonObject): string {
  return Option.match(decodePrediction(output), {
    onSome: (prediction) => predictionWords(prediction, record),
    onNone: () => asAResult(output),
  });
}
