import { Schema } from 'effect';

const SignInRecordSchema = Schema.Struct({
  server: Schema.String,
  site: Schema.String,
  link: Schema.String,
});

const ApprovalRecordSchema = Schema.Struct({
  server: Schema.String,
  tool: Schema.String,
  action: Schema.String,
  site: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.String),
});

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
  approval: Schema.optionalKey(ApprovalRecordSchema),
});

export type RequestRecord = typeof RequestRecordSchema.Type;

export const isRequestRecord: (record: unknown) => record is RequestRecord = Schema.is(RequestRecordSchema);

export function takesAnAnswer(record: unknown): boolean {
  return isRequestRecord(record) && record.answer_schema !== undefined;
}
