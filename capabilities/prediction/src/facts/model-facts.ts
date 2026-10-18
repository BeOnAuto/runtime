import { DefinitionContextSchema, factOf, type Decided } from '@on.auto/operations';
import { Schema } from 'effect';

import { BaselineSchema } from '../document/evaluation-names.ts';
import { AgainstSchema, ScoreSchema, TensorSchema } from './build-facts.ts';

export const modelsStreamKind = 'models';

const CardDatasetSchema = Schema.Struct({
  data_sha256: Schema.String,
  training_sha256: Schema.String,
  scoring_sha256: Schema.String,
  rows: Schema.Int,
  series: Schema.Int,
  series_left_out: Schema.Int,
  first_period: Schema.String,
  last_period: Schema.String,
  window: Schema.Int,
  holdout: Schema.Int,
  checkpoint: Schema.NullOr(Schema.String),
});

const BaselineFiguresSchema = Schema.Struct({
  baseline: BaselineSchema,
  scores: Schema.optionalKey(Schema.Array(ScoreSchema)),
  coverage: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  series_walked: Schema.Int,
});

const RuleSchema = Schema.Literals(['automatic', 'approved']);

const CardSchema = Schema.Struct({
  version: Schema.Int,
  build: Schema.String,
  trained_by: Schema.String,
  dataset: CardDatasetSchema,
  file: Schema.Struct({ sha256: Schema.String, bytes: Schema.Int, opset: Schema.Int }),
  inputs: Schema.Array(TensorSchema),
  features: Schema.optionalKey(Schema.Array(Schema.String)),
  given: Schema.optionalKey(Schema.Array(Schema.String)),
  scores: Schema.Array(ScoreSchema),
  coverage: Schema.NullOr(Schema.Number),
  against: Schema.Array(AgainstSchema),
  baselines: Schema.Array(BaselineFiguresSchema),
  rule: RuleSchema,
  recipe_sha256: Schema.optionalKey(Schema.String),
  recipe_bytes: Schema.optionalKey(Schema.Int),
  limitations_sha256: Schema.optionalKey(Schema.String),
  limitations_bytes: Schema.optionalKey(Schema.Int),
  features_sha256: Schema.optionalKey(Schema.String),
  features_bytes: Schema.optionalKey(Schema.Int),
});

export type Card = typeof CardSchema.Type;

const ShadowPredictedSchema = Schema.Struct({
  version: Schema.Int,
  of: Schema.Int,
  build: Schema.String,
  origin: Schema.String,
  count: Schema.Int,
  missing: Schema.Int,
  predictions_sha256: Schema.String,
  predictions_bytes: Schema.Int,
});

const ShadowGradedSchema = Schema.Struct({
  version: Schema.Int,
  of: Schema.Int,
  build: Schema.String,
  period: Schema.String,
  scores: Schema.Array(ScoreSchema),
  graded: Schema.Int,
  answered: Schema.Int,
  missing: Schema.Int,
});

const ShadowVerdictSchema = Schema.Struct({
  version: Schema.Int,
  build: Schema.String,
  metric: Schema.String,
  challenger: Schema.NullOr(Schema.Number),
  active: Schema.NullOr(Schema.Number),
  ungraded_closes: Schema.optionalKey(Schema.Int),
});

const ActivationRuleSchema = Schema.Literals(['automatic', 'approved', 'requested']);

const ActivatedSchema = Schema.Struct({
  version: Schema.Int,
  definition_version: Schema.Int,
  data_sha256: Schema.String,
  file_sha256: Schema.String,
  rule: ActivationRuleSchema,
  approved_by: Schema.optionalKey(Schema.String),
  build: Schema.optionalKey(Schema.String),
});

const RefusedSchema = Schema.Struct({
  version: Schema.Int,
  because: Schema.Literals(['approver_rejected', 'unanswered', 'shadow_failed', 'superseded']),
  refused_by: Schema.optionalKey(Schema.String),
  build: Schema.String,
});

const AskedSchema = Schema.Struct({ build: Schema.String, asked_at: Schema.String });

const EndedSchema = Schema.Struct({ build: Schema.String });

const context = DefinitionContextSchema;

const versionFacts = [
  factOf('version_built', CardSchema, context),
  factOf('shadow_predicted', ShadowPredictedSchema, context),
  factOf('shadow_graded', ShadowGradedSchema, context),
  factOf('shadow_passed', ShadowVerdictSchema, context),
  factOf('shadow_failed', ShadowVerdictSchema, context),
  factOf('version_activated', ActivatedSchema, context),
  factOf('activation_refused', RefusedSchema, context),
] as const;

export const VersionFactSchema = Schema.Union(versionFacts);

export type RecordedVersionFact = typeof VersionFactSchema.Type;

export const ModelFactSchema = Schema.Union([
  ...versionFacts,
  factOf('build_asked', AskedSchema, context),
  factOf('build_ended', EndedSchema, context),
]);

export type RecordedModelFact = typeof ModelFactSchema.Type;

export type ModelFact = Decided<RecordedModelFact>;

export type ModelFactOf<Type extends ModelFact['type']> = Extract<ModelFact, { readonly type: Type }>;

export const versionFactTypes: readonly ModelFact['type'][] = [
  'version_built',
  'shadow_predicted',
  'shadow_graded',
  'shadow_passed',
  'shadow_failed',
  'version_activated',
  'activation_refused',
];

export const modelFactTypes: readonly ModelFact['type'][] = [...versionFactTypes, 'build_asked', 'build_ended'];

export function modelsStreamOf(name: string): string {
  return `${modelsStreamKind}/${name}`;
}
