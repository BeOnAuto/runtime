import { Schema } from 'effect';

const TokensSchema = Schema.NullOr(Schema.Finite);

const CostSchema = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
  description: 'What the provider said the call cost, in US dollars, where it answers a cost',
});

const DigestSchema = Schema.String.annotate({
  description: 'The SHA-256 of the content as the playbook keeps it, where the run keeps the content of its calls',
});

export const ModelUsageSchema = Schema.Struct({
  input: Schema.Struct({
    total: TokensSchema,
    uncached: TokensSchema,
    cache_read: TokensSchema,
    cache_write: TokensSchema,
  }),
  output: Schema.Struct({ total: TokensSchema, text: TokensSchema, reasoning: TokensSchema }),
  total: TokensSchema,
});

export const FinishReasonSchema = Schema.Literals(['stop', 'length', 'content_filter', 'tool_calls', 'error', 'other']);

export const ModelCallFailedBecauseSchema = Schema.Literals([
  'cancelled',
  'content_refused',
  'credentials_rejected',
  'definition_invalid',
  'interrupted',
  'model_not_allowed',
  'output_invalid',
  'provider_not_configured',
  'provider_unavailable',
  'rate_limited',
  'request_too_long',
  'timed_out',
]);

export const ModelWarningSchema = Schema.Struct({
  type: Schema.Literals(['unsupported', 'compatibility', 'deprecated', 'other']),
  feature: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
});

export const FailureIssueSchema = Schema.Struct({ pointer: Schema.String, detail: Schema.String });

export const ModelCallStartedSchema = Schema.Struct({
  model: Schema.String,
  messages_bytes: Schema.Int,
  messages_sha256: Schema.optionalKey(DigestSchema),
  tools_offered: Schema.Int,
});

export const AskedToolCallSchema = Schema.Struct({
  call_id: Schema.String,
  tool: Schema.String,
  server: Schema.String,
  arguments_sha256: Schema.optionalKey(DigestSchema),
});

export const ModelCallAnsweredSchema = Schema.Struct({
  finish_reason: FinishReasonSchema,
  raw_finish_reason: Schema.NullOr(Schema.String),
  usage: ModelUsageSchema,
  cost_usd: Schema.optionalKey(CostSchema),
  response_id: Schema.NullOr(Schema.String),
  duration_ms: Schema.Int,
  request_bytes: Schema.Int.annotate({ description: 'The size of the request the model library sent, as JSON' }),
  response_bytes: Schema.Int,
  response_sha256: Schema.optionalKey(DigestSchema),
  resolved_model: Schema.String,
  answered_model: Schema.String,
  warnings: Schema.Array(ModelWarningSchema),
  tool_calls: Schema.Array(AskedToolCallSchema),
});

export const ModelCallFailedSchema = Schema.Struct({
  because: ModelCallFailedBecauseSchema,
  provider: Schema.String,
  detail: Schema.String,
  duration_ms: Schema.Int,
  usage: Schema.optionalKey(ModelUsageSchema),
  cost_usd: Schema.optionalKey(CostSchema),
  finish_reason: Schema.optionalKey(FinishReasonSchema),
  retry_after_ms: Schema.optionalKey(Schema.Int),
  provider_message: Schema.optionalKey(Schema.String),
  issues: Schema.optionalKey(Schema.Array(FailureIssueSchema)),
});

export type ModelUsage = typeof ModelUsageSchema.Type;

export type ModelCallFailedBecause = typeof ModelCallFailedBecauseSchema.Type;

export type ModelCallStartedData = typeof ModelCallStartedSchema.Type;

export type ModelCallAnsweredData = typeof ModelCallAnsweredSchema.Type;

export type ModelCallFailedData = typeof ModelCallFailedSchema.Type;

export type AskedToolCall = typeof AskedToolCallSchema.Type;

export type ModelWarning = typeof ModelWarningSchema.Type;

export type ModelCallEnded =
  | { readonly type: 'model_call_answered'; readonly data: ModelCallAnsweredData }
  | { readonly type: 'model_call_failed'; readonly data: ModelCallFailedData };
