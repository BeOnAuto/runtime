import type { RecordedWork } from '@on.auto/definitions';
import { RunContextSchema, factOf, factReaderOf } from '@on.auto/operations';
import { CandidateSignatureSchema } from '@on.auto/prediction-contract';
import { Schema } from 'effect';

import { BaselineSchema } from '../document/evaluation-names.ts';

export const RuntimeSchema = Schema.Struct({ name: Schema.String, version: Schema.String });

export const ScoreSchema = Schema.Struct({
  horizon: Schema.NullOr(Schema.Int),
  pairs: Schema.Int,
  mase: Schema.NullOr(Schema.Number),
  winkler: Schema.NullOr(Schema.Number),
  quantile: Schema.NullOr(Schema.Number),
});

export type Score = typeof ScoreSchema.Type;

export const AgainstSchema = Schema.Struct({ baseline: BaselineSchema, p_better: Schema.Number });

const RefusedBecauseSchema = Schema.Literals(['failed_to_load', 'wrong_signature', 'too_many', 'feature_unlicensed']);

const DisqualifiedBecauseSchema = Schema.Literals([
  'timed_out',
  'out_of_memory',
  'crashed',
  'not_loaded',
  'answered_badly',
  'coverage_below_floor',
  'not_better',
  'feature_unlicensed',
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
  format: Schema.String,
  runtime: RuntimeSchema,
  signature: CandidateSignatureSchema,
});

const RefusedSchema = Schema.Struct({
  sha256: Schema.String,
  bytes: Schema.Int,
  because: RefusedBecauseSchema,
  detail: Schema.String,
});

const ScoredSchema = Schema.Struct({
  sha256: Schema.String,
  runtime: RuntimeSchema,
  scores: Schema.Array(ScoreSchema),
  coverage: Schema.NullOr(Schema.Number),
  against: Schema.Array(AgainstSchema),
  duration_ms: Schema.Int,
});

const DisqualifiedSchema = Schema.Struct({
  sha256: Schema.String,
  because: DisqualifiedBecauseSchema,
  detail: Schema.optionalKey(Schema.String),
  feature: Schema.optionalKey(Schema.String),
});

const BaselineScoredSchema = Schema.Struct({
  baseline: BaselineSchema,
  scores: Schema.Array(ScoreSchema),
  coverage: Schema.NullOr(Schema.Number),
  series_walked: Schema.Int,
});

const NotWalkedSchema = Schema.Struct({ baseline: BaselineSchema, because: Schema.Literal('too_short') });

const FittedSchema = Schema.Struct({
  runtime: Schema.NullOr(RuntimeSchema),
  candidates: Schema.Array(Schema.String),
  detail: Schema.optionalKey(Schema.String),
});

export const buildFactSchemas = {
  dataset_assembled: factOf('dataset_assembled', AssembledSchema, RunContextSchema),
  candidate_uploaded: factOf('candidate_uploaded', UploadedSchema, RunContextSchema),
  candidate_refused: factOf('candidate_refused', RefusedSchema, RunContextSchema),
  candidate_scored: factOf('candidate_scored', ScoredSchema, RunContextSchema),
  candidate_disqualified: factOf('candidate_disqualified', DisqualifiedSchema, RunContextSchema),
  baseline_scored: factOf('baseline_scored', BaselineScoredSchema, RunContextSchema),
  baseline_not_walked: factOf('baseline_not_walked', NotWalkedSchema, RunContextSchema),
  candidates_fitted: factOf('candidates_fitted', FittedSchema, RunContextSchema),
};

export const BuildFactSchema = Schema.Union([
  buildFactSchemas.dataset_assembled,
  buildFactSchemas.candidate_uploaded,
  buildFactSchemas.candidate_refused,
  buildFactSchemas.candidate_scored,
  buildFactSchemas.candidate_disqualified,
  buildFactSchemas.baseline_scored,
  buildFactSchemas.baseline_not_walked,
  buildFactSchemas.candidates_fitted,
]);

export type BuildWork = typeof BuildFactSchema.Type;

export type BuildWorkOf<Type extends BuildWork['type']> = Extract<BuildWork, { readonly type: Type }>;

const readBuildFact = factReaderOf(BuildFactSchema);

export function buildWorkIn(work: RecordedWork): readonly BuildWork[] {
  const fact = readBuildFact(work);
  return fact === undefined ? [] : [fact];
}
