import { RunContextSchema, factOf } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { BaselineSchema } from '../document/evaluation-names.ts';

export const TensorSchema = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  shape: Schema.Array(Schema.Union([Schema.Int, Schema.String])),
});

export type TensorSignature = typeof TensorSchema.Type;

export const ScoreSchema = Schema.Struct({
  horizon: Schema.NullOr(Schema.Int),
  pairs: Schema.Int,
  mase: Schema.NullOr(Schema.Number),
  winkler: Schema.NullOr(Schema.Number),
  quantile: Schema.NullOr(Schema.Number),
});

export type Score = typeof ScoreSchema.Type;

export const AgainstSchema = Schema.Struct({ baseline: BaselineSchema, p_better: Schema.Number });

const RefusedBecauseSchema = Schema.Literals(['failed_to_load', 'wrong_signature', 'too_many']);

const DisqualifiedBecauseSchema = Schema.Literals([
  'timed_out',
  'out_of_memory',
  'crashed',
  'not_loaded',
  'answered_badly',
  'coverage_below_floor',
  'not_better',
]);

const AssembledSchema = Schema.Struct({
  data_sha256: Schema.String,
  training_sha256: Schema.String,
  training_bytes: Schema.Int,
  scoring_sha256: Schema.String,
  scoring_bytes: Schema.Int,
  rows: Schema.Int,
  series: Schema.Int,
  series_left_out: Schema.Int,
  first_period: Schema.String,
  last_period: Schema.String,
  window: Schema.Int,
  holdout: Schema.Int,
  checkpoint: Schema.NullOr(Schema.String),
});

export type Assembled = typeof AssembledSchema.Type;

const UploadedSchema = Schema.Struct({
  sha256: Schema.String,
  bytes: Schema.Int,
  opset: Schema.Int,
  inputs: Schema.Array(TensorSchema),
  outputs: Schema.Array(TensorSchema),
});

const RefusedSchema = Schema.Struct({
  sha256: Schema.String,
  bytes: Schema.Int,
  because: RefusedBecauseSchema,
  detail: Schema.String,
});

const ScoredSchema = Schema.Struct({
  sha256: Schema.String,
  scores: Schema.Array(ScoreSchema),
  coverage: Schema.NullOr(Schema.Number),
  against: Schema.Array(AgainstSchema),
  duration_ms: Schema.Int,
});

const DisqualifiedSchema = Schema.Struct({
  sha256: Schema.String,
  because: DisqualifiedBecauseSchema,
  detail: Schema.optionalKey(Schema.String),
});

const BaselineScoredSchema = Schema.Struct({
  baseline: BaselineSchema,
  scores: Schema.Array(ScoreSchema),
  coverage: Schema.NullOr(Schema.Number),
  series_walked: Schema.Int,
});

const NotWalkedSchema = Schema.Struct({ baseline: BaselineSchema, because: Schema.Literal('too_short') });

const BuildWorkSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('dataset_assembled'), data: AssembledSchema }),
  Schema.Struct({ type: Schema.Literal('candidate_uploaded'), data: UploadedSchema }),
  Schema.Struct({ type: Schema.Literal('candidate_refused'), data: RefusedSchema }),
  Schema.Struct({ type: Schema.Literal('candidate_scored'), data: ScoredSchema }),
  Schema.Struct({ type: Schema.Literal('candidate_disqualified'), data: DisqualifiedSchema }),
  Schema.Struct({ type: Schema.Literal('baseline_scored'), data: BaselineScoredSchema }),
  Schema.Struct({ type: Schema.Literal('baseline_not_walked'), data: NotWalkedSchema }),
]);

export type BuildWork = typeof BuildWorkSchema.Type;

export type BuildWorkOf<Type extends BuildWork['type']> = Extract<BuildWork, { readonly type: Type }>;

export const buildFactSchemas = {
  dataset_assembled: factOf('dataset_assembled', AssembledSchema, RunContextSchema),
  candidate_uploaded: factOf('candidate_uploaded', UploadedSchema, RunContextSchema),
  candidate_refused: factOf('candidate_refused', RefusedSchema, RunContextSchema),
  candidate_scored: factOf('candidate_scored', ScoredSchema, RunContextSchema),
  candidate_disqualified: factOf('candidate_disqualified', DisqualifiedSchema, RunContextSchema),
  baseline_scored: factOf('baseline_scored', BaselineScoredSchema, RunContextSchema),
  baseline_not_walked: factOf('baseline_not_walked', NotWalkedSchema, RunContextSchema),
};

const decodeWork = Schema.decodeUnknownOption(BuildWorkSchema);

export function buildWorkIn(work: { readonly type: string; readonly data: unknown }): readonly BuildWork[] {
  return Option.toArray(decodeWork({ type: work.type, data: work.data }));
}
