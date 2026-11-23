import { Schema } from 'effect';

export const AnswerConditionsSchema = Schema.Record(
  Schema.String,
  Schema.Array(Schema.NullOr(Schema.Union([Schema.String, Schema.Boolean]))).check(Schema.isMinLength(1)),
);

export const noCondition = 'Expected at least one JSON Pointer with the values it may equal';
