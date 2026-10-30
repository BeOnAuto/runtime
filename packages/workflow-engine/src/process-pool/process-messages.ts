import { Schema } from 'effect';

export const ProcessJobSchema = Schema.Struct({ job: Schema.Number, kind: Schema.String, payload: Schema.Unknown });

export type ProcessMessage = typeof ProcessJobSchema.Type;

export const ProcessAnswerSchema = Schema.Union([
  Schema.Struct({ job: Schema.Number, answer: Schema.Unknown, keep: Schema.Boolean }),
  Schema.Struct({ job: Schema.Number, exhausted: Schema.Literal('memory') }),
  Schema.Struct({ job: Schema.Number, failed: Schema.String }),
]);

export type ProcessAnswer = typeof ProcessAnswerSchema.Type;
