import { Schema } from 'effect';

const IssueSchema = Schema.Struct({ detail: Schema.String, line: Schema.NullOr(Schema.Number) });

export const RaisedSchema = Schema.Struct({ ran: Schema.Literal('raised'), issue: IssueSchema, work: Schema.Number });

export const ExhaustedSchema = Schema.Struct({
  ran: Schema.Literal('exhausted'),
  limit: Schema.Literals(['work', 'memory', 'stack', 'deadline']),
  issue: IssueSchema,
  work: Schema.Number,
});

export const UnfitSchema = Schema.Struct({ ran: Schema.Literal('unfit'), issue: IssueSchema, work: Schema.Number });

export const OversizedSchema = Schema.Struct({
  ran: Schema.Literal('oversized'),
  issue: IssueSchema,
  work: Schema.Number,
});

export const SettingsSchema = Schema.Struct({
  budget: Schema.Number,
  memoryBytes: Schema.Number,
  stackBytes: Schema.Number,
});

export const ProgramJobSchema = Schema.Struct({
  ...SettingsSchema.fields,
  source: Schema.String,
  entry: Schema.String,
  arguments: Schema.Array(Schema.String),
  moment: Schema.Number,
  mostOutputBytes: Schema.Number,
  deadlineAt: Schema.Number,
  context: Schema.Json,
});

export type ProgramJob = typeof ProgramJobSchema.Type;

export const ProgramAnswerSchema = Schema.Union([
  Schema.Struct({
    ran: Schema.Literal('answered'),
    output: Schema.fromJsonString(Schema.Json),
    bytes: Schema.Number,
    work: Schema.Number,
  }),
  Schema.Struct({ ran: Schema.Literal('oversized'), work: Schema.Number }),
  Schema.Struct({
    ran: Schema.Literal('mismatched'),
    issues: Schema.Array(Schema.Struct({ pointer: Schema.String, detail: Schema.String })),
    work: Schema.Number,
  }),
  RaisedSchema,
  ExhaustedSchema,
  UnfitSchema,
  Schema.Struct({ ran: Schema.Literal('refused'), issue: IssueSchema }),
]);

export type ProgramAnswer = typeof ProgramAnswerSchema.Type;
