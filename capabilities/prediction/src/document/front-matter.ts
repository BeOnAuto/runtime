import { DescriptionSchema, type FrontMatterSection, type FrontMatterShape } from '@on.auto/definitions/document';
import { Schema } from 'effect';

import { enclosings } from '../periods/enclosing.ts';
import { grains } from '../periods/grains.ts';
import { BaselineSchema, MetricSchema } from './evaluation-names.ts';

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
});

const DataSchema = Schema.Struct({
  events: Schema.optionalKey(Schema.Array(Schema.Json)),
  time: Schema.optionalKey(Schema.String),
  series: Schema.optionalKey(Schema.String),
  target: Schema.optionalKey(MeasureSchema),
  features: Schema.optionalKey(Schema.Array(Schema.Json)),
  given: Schema.optionalKey(Schema.Array(Schema.String)),
  window: Schema.Number,
  dataset: Schema.optionalKey(Schema.String),
});

const ActivationSchema = Schema.Union([Schema.Literal('automatic'), Schema.Struct({ approved: Schema.String })]);

const EvaluationSchema = Schema.Struct({
  holdout: Schema.Number,
  metric: Schema.optionalKey(MetricSchema),
  coverage_floor: Schema.optionalKey(Schema.Number),
  baselines: Schema.optionalKey(Schema.Array(BaselineSchema)),
  confidence: Schema.optionalKey(Schema.Number),
  shadow_periods: Schema.optionalKey(Schema.Number),
  activate: ActivationSchema,
});

const SourceSchema = Schema.Struct({
  through: Schema.optionalKey(Schema.String),
  to: Schema.optionalKey(Schema.String),
  expires: Schema.String,
});

const FrontMatterSchema = Schema.Struct({
  description: Schema.optionalKey(DescriptionSchema),
  predicts: PredictsSchema,
  data: DataSchema,
  evaluation: EvaluationSchema,
  source: Schema.optionalKey(SourceSchema),
  rules: Schema.optionalKey(Schema.Array(Schema.String)),
});

export type PredictionFrontMatter = typeof FrontMatterSchema.Type;

export type WrittenPredicts = PredictionFrontMatter['predicts'];

export type WrittenData = PredictionFrontMatter['data'];

export type WrittenEvaluation = PredictionFrontMatter['evaluation'];

export type WrittenSource = NonNullable<PredictionFrontMatter['source']>;

const sections: readonly FrontMatterSection[] = [
  { name: undefined, keys: Object.keys(FrontMatterSchema.fields) },
  { name: 'predicts', keys: Object.keys(PredictsSchema.fields) },
  { name: 'data', keys: Object.keys(DataSchema.fields) },
  { name: 'data.target', keys: Object.keys(MeasureSchema.fields) },
  { name: 'evaluation', keys: Object.keys(EvaluationSchema.fields) },
  { name: 'evaluation.activate', keys: ['approved'] },
  { name: 'source', keys: Object.keys(SourceSchema.fields) },
];

export const decodeFrontMatter = Schema.decodeUnknownResult(FrontMatterSchema, { errors: 'all' });

export const predictionFrontMatter: FrontMatterShape = {
  sections,
  decode: decodeFrontMatter,
  required: 'what it predicts, the data it learns from and how it is evaluated',
};
