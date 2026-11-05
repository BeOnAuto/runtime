import { Schema } from 'effect';

export const SignInRecordSchema = Schema.Struct({
  server: Schema.String,
  site: Schema.String,
  link: Schema.String,
});

export type SignInRecord = typeof SignInRecordSchema.Type;

export const RequestRecordSchema = Schema.Struct({
  to: Schema.String,
  message: Schema.String,
  answer_schema: Schema.optionalKey(Schema.JsonObject),
  answerer: Schema.optionalKey(Schema.String),
  reply: Schema.optionalKey(Schema.JsonObject),
  expires_at: Schema.String,
  requested_at: Schema.String,
  deliver: Schema.optionalKey(Schema.JsonObject),
  replies: Schema.optionalKey(Schema.JsonObject),
  sign_in: Schema.optionalKey(SignInRecordSchema),
});

export type RequestRecord = typeof RequestRecordSchema.Type;

export const isRequestRecord: (record: unknown) => record is RequestRecord = Schema.is(RequestRecordSchema);

export function takesAnAnswer(record: unknown): boolean {
  return isRequestRecord(record) && record.answer_schema !== undefined;
}
