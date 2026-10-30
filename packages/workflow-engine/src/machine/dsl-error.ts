import { IssueSchema } from '@on.auto/operations';
import { Schema } from 'effect';

export const DslErrorSchema = Schema.Struct({
  type: Schema.String,
  status: Schema.Int,
  instance: Schema.String,
  title: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.String),
  because: Schema.optionalKey(Schema.String),
  issues: Schema.optionalKey(Schema.Array(IssueSchema)),
});

export type DslError = typeof DslErrorSchema.Type;
