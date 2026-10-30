import { Schema } from 'effect';

import { ExhaustedSchema, OversizedSchema, RaisedSchema, UnfitSchema } from './program-messages.ts';

export const answeredFlag = 0;

export const readyFlag = 1;

export const ProgramRunSchema = Schema.Union([
  Schema.Struct({ ran: Schema.Literal('answered'), text: Schema.String, work: Schema.Number }),
  RaisedSchema,
  ExhaustedSchema,
  UnfitSchema,
  OversizedSchema,
]);

const EvaluationSchema = Schema.Struct({ budget: Schema.Number, deadlineAt: Schema.Number, moment: Schema.Number });

export const EvaluationRequestSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('evaluate'),
    unit: Schema.Number,
    source: Schema.String,
    names: Schema.Array(Schema.String),
    texts: Schema.Array(Schema.String),
    evaluation: EvaluationSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal('prepare'),
    unit: Schema.Number,
    sources: Schema.Array(Schema.String),
    evaluation: EvaluationSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal('test'),
    unit: Schema.Number,
    test: Schema.Number,
    value: Schema.String,
    evaluation: EvaluationSchema,
  }),
  Schema.Struct({ kind: Schema.Literal('close'), unit: Schema.Number }),
]);

type EvaluationRequest = typeof EvaluationRequestSchema.Type;

export type AnsweredRequest = Exclude<EvaluationRequest, { readonly kind: 'close' }>;

export type PrepareRequest = Extract<AnsweredRequest, { readonly kind: 'prepare' }>;

export type TestRequest = Extract<AnsweredRequest, { readonly kind: 'test' }>;
