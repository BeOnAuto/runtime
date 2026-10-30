import { DescriptionSchema, type FrontMatterSection, type FrontMatterShape } from '@on.auto/definitions/document';
import { Schema } from 'effect';

import { enclosings } from '../periods/enclosing.ts';
import { grains } from '../periods/grains.ts';

export const aggregations = ['count', 'sum', 'last', 'mean'] as const;

const MeasureSchema = Schema.Struct({ of: Schema.optionalKey(Schema.String), as: Schema.Literals(aggregations) });

const PredictsSchema = Schema.Struct({
  target: Schema.String,
  period: Schema.Literals(grains),
  season: Schema.optionalKey(Schema.Number),
  horizons: Schema.optionalKey(Schema.Array(Schema.Number)),
  accumulates: Schema.optionalKey(Schema.Literals(enclosings)),
  unit: Schema.String,
  history: Schema.optionalKey(Schema.Number),
  coverage: Schema.optionalKey(Schema.Number),
});

const DataSchema = Schema.Struct({
  events: Schema.Array(Schema.Json),
  time: Schema.String,
  series: Schema.String,
  target: MeasureSchema,
  window: Schema.Number,
});

const FrontMatterSchema = Schema.Struct({
  description: Schema.optionalKey(DescriptionSchema),
  predicts: PredictsSchema,
  data: DataSchema,
});

export type PredictionFrontMatter = typeof FrontMatterSchema.Type;

export type WrittenPredicts = PredictionFrontMatter['predicts'];

export type WrittenData = PredictionFrontMatter['data'];

const sections: readonly FrontMatterSection[] = [
  { name: undefined, keys: Object.keys(FrontMatterSchema.fields) },
  { name: 'predicts', keys: Object.keys(PredictsSchema.fields) },
  { name: 'data', keys: Object.keys(DataSchema.fields) },
  { name: 'data.target', keys: Object.keys(MeasureSchema.fields) },
];

export const decodeFrontMatter = Schema.decodeUnknownResult(FrontMatterSchema, { errors: 'all' });

export const predictionFrontMatter: FrontMatterShape = {
  sections,
  decode: decodeFrontMatter,
  required: 'what it predicts and the data it forecasts from',
};
