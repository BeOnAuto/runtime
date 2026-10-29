import { outputInWords } from '@on.auto/definitions';
import { listed } from '@on.auto/operations';
import { Option, Schema } from 'effect';

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

const RecordSchema = Schema.Struct({
  version: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  default_forecast: Schema.optionalKey(Schema.Boolean),
  total_to: Schema.optionalKey(Schema.String),
  decimals: Schema.optionalKey(Schema.Int),
});

const BuildSchema = Schema.Struct({
  version: Schema.NullOr(Schema.Number),
  winner: Schema.NullOr(Schema.String),
  candidates: Schema.Array(Schema.Unknown),
});

const decodePrediction = Schema.decodeUnknownOption(PredictionSchema);

const decodeRecord = Schema.decodeUnknownOption(RecordSchema);

const decodeBuild = Schema.decodeUnknownOption(BuildSchema);

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

function versionWords({ version, default_forecast: byDefault }: Recorded): string {
  if (byDefault === true) {
    return ', from the default forecast, since no version of its model is active';
  }
  return version === undefined || version === null ? '' : `, from version ${version} of its model`;
}

function predictionWords({ unit, origin, lines }: typeof PredictionSchema.Type, record: unknown): string {
  const [, { name, points }] = lines;
  const recorded = Option.getOrElse(decodeRecord(record), (): Recorded => ({}));
  const decimals = recorded.decimals ?? mostObservedDecimals;
  const said =
    name === 'total'
      ? totalWords(points[0], unit, recorded, decimals)
      : listed(points.map((point) => pointWords(point, unit, decimals)));
  const each = points.length === 1 ? 'its range holding' : 'each range holding';
  return `From ${origin}, it predicts ${said}, ${each} the truth eight times in ten${versionWords(recorded)}.`;
}

function buildWords({ version, winner, candidates }: typeof BuildSchema.Type): string {
  const scored = candidates.length === 1 ? 'one candidate' : `${candidates.length} candidates`;
  if (version !== null && winner !== null) {
    return `The build made version ${version} of its model from ${scored}, won by ${winner.slice(0, 12)}.`;
  }
  return candidates.length === 0
    ? 'The build kept no version, since it had no candidate, uploaded or fitted, to score.'
    : `The build kept no version: none of its ${scored} passed its scoring on the held-back periods.`;
}

export function describeOutput(output: Schema.Json, record?: Schema.JsonObject): string {
  return Option.match(decodePrediction(output), {
    onSome: (prediction) => predictionWords(prediction, record),
    onNone: () => Option.match(decodeBuild(output), { onSome: buildWords, onNone: () => asAResult(output) }),
  });
}
