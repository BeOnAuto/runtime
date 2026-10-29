import {
  IssueSchema,
  RunContextSchema,
  factOf,
  factReaderOf,
  type Decided,
  type FactReader,
} from '@on.auto/operations';
import { CallAnsweredSchema, CallSentSchema } from '@on.auto/tool-servers';
import { Schema, Struct } from 'effect';

import { DeliveredAsSchema, RepliesInSchema } from '../tool-blocks/tool-block-schemas.ts';

const numbered = { number: Schema.Int };

const sent = Struct.omit(CallSentSchema.fields, ['read_only']);

const answered = Struct.omit(CallAnsweredSchema.fields, ['is_error', 'shown_bytes']);

const DeliveryFailedBecauseSchema = Schema.Literals([
  'tool_error',
  'arguments_refused',
  'server_failure',
  'timed_out',
  'too_large',
  'tool_not_offered',
  'lost',
]);

const DeliveryRefusedBecauseSchema = Schema.Literals(['too_large', 'unworkable']);

const DeliveryStartedSchema = Schema.Struct({
  ...numbered,
  target: Schema.String,
  server: sent.server,
  connection_id: sent.connection_id,
  tool: sent.tool,
  arguments_bytes: Schema.optionalKey(sent.arguments_bytes),
  arguments_sha256: sent.arguments_sha256,
});

const DeliverySucceededSchema = Schema.Struct({
  ...numbered,
  ...answered,
  delivered_as: Schema.optionalKey(DeliveredAsSchema),
  replies_in: Schema.optionalKey(RepliesInSchema),
  detail: Schema.optionalKey(Schema.String),
});

const DeliveryFailedSchema = Schema.Struct({
  ...numbered,
  because: DeliveryFailedBecauseSchema,
  detail: Schema.optionalKey(Schema.String),
  retry_after_ms: Schema.optionalKey(Schema.Int),
  result_bytes: Schema.optionalKey(answered.result_bytes),
  result_sha256: answered.result_sha256,
  duration_ms: Schema.Int,
  jsonrpc_id: Schema.optionalKey(answered.jsonrpc_id),
  server_request_id: answered.server_request_id,
});

const DeliveryRefusedSchema = Schema.Struct({
  ...numbered,
  because: DeliveryRefusedBecauseSchema,
  detail: Schema.optionalKey(Schema.String),
  duration_ms: Schema.Int,
});

const ReplyRefusalSchema = Schema.Literals(['not_an_answer', 'invalid', 'too_long', 'ambiguous']);

const ReplyRefusedSchema = Schema.Struct({
  server: Schema.String,
  tool: Schema.String,
  reply: Schema.Struct({ id: Schema.String, sender: Schema.String }),
  because: ReplyRefusalSchema,
  issues: Schema.optionalKey(Schema.Array(IssueSchema)),
  told: Schema.Boolean,
});

export const InteractionRunFactSchema = Schema.Union([
  factOf('delivery_started', DeliveryStartedSchema, RunContextSchema),
  factOf('delivery_succeeded', DeliverySucceededSchema, RunContextSchema),
  factOf('delivery_failed', DeliveryFailedSchema, RunContextSchema),
  factOf('delivery_refused', DeliveryRefusedSchema, RunContextSchema),
  factOf('reply_refused', ReplyRefusedSchema, RunContextSchema),
]);

export const [
  DeliveryStartedFactSchema,
  DeliverySucceededFactSchema,
  DeliveryFailedFactSchema,
  DeliveryRefusedFactSchema,
  ReplyRefusedFactSchema,
] = InteractionRunFactSchema.members;

export type RecordedInteractionFact = typeof InteractionRunFactSchema.Type;

export type InteractionFact = Decided<RecordedInteractionFact>;

type FactNamed<Type extends InteractionFact['type']> = Extract<InteractionFact, { readonly type: Type }>;

export type RecordedFactNamed<Type extends InteractionFact['type']> = Extract<
  RecordedInteractionFact,
  { readonly type: Type }
>;

export type DeliveryEvent = FactNamed<
  'delivery_started' | 'delivery_succeeded' | 'delivery_failed' | 'delivery_refused'
>;

export type DeliveryStarted = FactNamed<'delivery_started'>;

export type DeliveryEnded = FactNamed<'delivery_succeeded' | 'delivery_failed' | 'delivery_refused'>;

export type ReplyRefused = FactNamed<'reply_refused'>;

export type ReplyRefusal = typeof ReplyRefusalSchema.Type;

export type DeliveryFailedBecause = typeof DeliveryFailedBecauseSchema.Type;

export type DeliveryRefusedBecause = typeof DeliveryRefusedBecauseSchema.Type;

export const interactionFactOf: FactReader<RecordedInteractionFact> = factReaderOf(InteractionRunFactSchema);
