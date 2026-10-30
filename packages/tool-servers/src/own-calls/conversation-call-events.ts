import { ActedContextSchema, RunContextSchema, factOf, type Decided } from '@on.auto/operations';
import { Schema, Struct } from 'effect';

import { CallAnsweredSchema, CallFailedSchema, CallSentSchema } from '../calls/call-facts.ts';

export const conversationCallsKind = 'conversation-calls';

const ofTheCall = { call_id: Schema.String };

const sentFields = Struct.omit(CallSentSchema.fields, ['read_only']);

const answeredFields = Struct.omit(CallAnsweredSchema.fields, ['is_error', 'shown_bytes']);

function optionalOf<Field extends Schema.Top>(field: Field) {
  return Schema.optionalKey(field);
}

const answerOnAFailure = {
  result_bytes: optionalOf(answeredFields.result_bytes),
  result_sha256: answeredFields.result_sha256,
};

const callFailure = {
  detail: optionalOf(CallFailedSchema.fields.detail),
  duration_ms: optionalOf(CallFailedSchema.fields.duration_ms),
  jsonrpc_id: optionalOf(CallFailedSchema.fields.jsonrpc_id),
  server_request_id: CallFailedSchema.fields.server_request_id,
};

const TellingFailedBecauseSchema = Schema.Literals([
  'tool_error',
  'arguments_refused',
  'server_failure',
  'timed_out',
  'cancelled',
  'too_large',
  'tool_not_offered',
]);

const ReadingFailedBecauseSchema = Schema.Literals([
  'tool_error',
  'arguments_refused',
  'server_failure',
  'timed_out',
  'cancelled',
  'unreadable',
  'too_large',
  'tool_not_offered',
  'not_sent',
]);

const theConversation = {
  server: Schema.String,
  connection_id: sentFields.connection_id,
  tool: Schema.String,
  conversation: Schema.String,
  since: Schema.NullOr(Schema.String),
};

const readArguments = {
  arguments_bytes: optionalOf(sentFields.arguments_bytes),
  arguments_sha256: sentFields.arguments_sha256,
};

export const ConversationCallEventSchema = Schema.Union([
  factOf('telling_started', Schema.Struct({ ...ofTheCall, ...sentFields }), RunContextSchema),
  factOf('telling_succeeded', Schema.Struct({ ...ofTheCall, ...answeredFields }), RunContextSchema),
  factOf(
    'telling_failed',
    Schema.Struct({ ...ofTheCall, ...callFailure, because: TellingFailedBecauseSchema, ...answerOnAFailure }),
    RunContextSchema,
  ),
  factOf(
    'replies_read',
    Schema.Struct({
      ...ofTheCall,
      ...theConversation,
      ...readArguments,
      ...answeredFields,
      replies: Schema.Int,
      taken: Schema.Int,
      refused: Schema.Int,
    }),
    ActedContextSchema,
  ),
  factOf(
    'reading_failed',
    Schema.Struct({
      ...ofTheCall,
      ...theConversation,
      ...readArguments,
      ...callFailure,
      because: ReadingFailedBecauseSchema,
      retry_after_ms: Schema.optionalKey(Schema.Int),
      ...answerOnAFailure,
    }),
    ActedContextSchema,
  ),
]);

export type RecordedConversationCall = typeof ConversationCallEventSchema.Type;

export type ConversationCallEvent = Decided<RecordedConversationCall>;

export type TellingStarted = Extract<ConversationCallEvent, { readonly type: 'telling_started' }>;

export type TellingEnded = Extract<ConversationCallEvent, { readonly type: 'telling_succeeded' | 'telling_failed' }>;

export type ReadingRecorded = Extract<ConversationCallEvent, { readonly type: 'replies_read' | 'reading_failed' }>;

export type TellingFailedBecause = typeof TellingFailedBecauseSchema.Type;

export type ReadingFailedBecause = typeof ReadingFailedBecauseSchema.Type;

export function conversationCallStreamOf(callId: string): string {
  return `${conversationCallsKind}/${callId}`;
}
