import { IssueSchema, RejectionCauseSchema } from '@on.auto/operations';
import { Schema } from 'effect';

export const ErrorCauseSchema = Schema.Struct({
  status: RejectionCauseSchema.fields.status,
  run_id: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.String),
  because: Schema.optionalKey(Schema.String),
});

export type ErrorCause = typeof ErrorCauseSchema.Type;

export const DslErrorSchema = Schema.Struct({
  type: Schema.String,
  status: Schema.Int,
  instance: Schema.String,
  title: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.String),
  because: Schema.optionalKey(Schema.String),
  issues: Schema.optionalKey(Schema.Array(IssueSchema)),
  cause: Schema.optionalKey(ErrorCauseSchema),
});

export type DslError = typeof DslErrorSchema.Type;
