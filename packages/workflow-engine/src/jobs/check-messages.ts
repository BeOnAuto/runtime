import { Schema } from 'effect';

const CheckedModuleSchema = Schema.Struct({
  place: Schema.Literals(['computation', 'recall']),
  source: Schema.String,
});

const CheckedExpressionSchema = Schema.Struct({
  source: Schema.String,
  names: Schema.Array(Schema.String),
});

export const CheckJobSchema = Schema.Struct({
  module: Schema.optionalKey(CheckedModuleSchema),
  schemas: Schema.Struct({
    input: Schema.optionalKey(Schema.JsonObject),
    output: Schema.optionalKey(Schema.JsonObject),
    view: Schema.optionalKey(Schema.JsonObject),
  }),
  expressions: Schema.Array(CheckedExpressionSchema),
});

export type CheckJob = typeof CheckJobSchema.Type;

const CheckIssueSchema = Schema.Struct({
  at: Schema.Union([Schema.Literal('module'), Schema.Number]),
  line: Schema.Number,
  detail: Schema.String,
});

export type CheckIssue = typeof CheckIssueSchema.Type;

const StrippedSourcesSchema = Schema.Struct({
  module: Schema.optionalKey(Schema.String),
  expressions: Schema.Array(Schema.String),
});

export type StrippedSources = typeof StrippedSourcesSchema.Type;

export const CheckAnswerSchema = Schema.Union([
  Schema.Struct({
    ran: Schema.Literal('checked'),
    issues: Schema.Array(CheckIssueSchema),
    stripped: Schema.optionalKey(StrippedSourcesSchema),
  }),
  Schema.Struct({ ran: Schema.Literal('unreadable') }),
]);

export type CheckAnswer = typeof CheckAnswerSchema.Type;
