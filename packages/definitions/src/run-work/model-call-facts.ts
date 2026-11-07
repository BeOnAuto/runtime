import type { FactDeclaration } from '@on.auto/operations';
import { Schema } from 'effect';

export const messagesHeld: FactDeclaration = { content: { holds: ['/messages_sha256'] } };

export const responseHeld: FactDeclaration = { content: { holds: ['/response_sha256'] } };

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

const OutputModeSchema = Schema.Literals(['described']).annotate({
  description:
    'described when the call wrote the JSON Schema of the answer into the instructions rather than giving it to the provider',
});

const AskedRepairSchema = Schema.Struct({
  outcome: Schema.Literals(['repaired', 'invalid']).annotate({
    description: 'repaired when the answer the model wrote again was used, invalid when it missed the schema too',
  }),
  issues: Schema.Array(FailureIssueSchema).annotate({
    description: 'The issues of the first answer, which the model was told, at most 5',
  }),
  usage: ModelUsageSchema,
  cost_usd: Schema.optionalKey(CostSchema),
  duration_ms: Schema.Int,
});

const FailedRepairSchema = Schema.Struct({
  outcome: Schema.Literal('failed'),
  because: ModelCallFailedBecauseSchema.annotate({
    description: 'How the second request failed, as a model call fails, so the first answer stands',
  }),
  issues: Schema.Array(FailureIssueSchema).annotate({
    description: 'The issues of the first answer, which the model was told, at most 5',
  }),
  duration_ms: Schema.Int,
});

const SkippedRepairSchema = Schema.Struct({
  outcome: Schema.Literal('skipped'),
  because: Schema.Literals(['input_tokens', 'context_window', 'time']).annotate({
    description:
      "What the run had too little of to ask again: its input tokens, the model's context window, or the time left",
  }),
});

const RepairSchema = Schema.Union([AskedRepairSchema, FailedRepairSchema, SkippedRepairSchema]).annotate({
  description:
    'How a JSON answer that missed its schema was asked for once more, with its issues; usage, cost_usd and duration_ms are those of the second request alone',
});

const RefusedStatusSchema = Schema.Int.annotate({
  description: 'The HTTP status the provider refused the request with, 400 or 422',
});

const RefusedDurationSchema = Schema.Int.annotate({ description: 'How long the refused request took' });

const AskedAgainSchema = Schema.Struct({
  outcome: Schema.Literals(['described', 'refused_again']).annotate({
    description:
      'described when the answer was asked for again with its schema in the instructions; refused_again when the provider refused that request too, so the schema was not the cause',
  }),
  status: RefusedStatusSchema,
  duration_ms: RefusedDurationSchema,
});

const NotAskedAgainSchema = Schema.Struct({
  outcome: Schema.Literal('skipped'),
  because: Schema.Literal('time').annotate({
    description: 'Less time was left before the deadline of the call or the bound of the run than the refusal took',
  }),
  status: RefusedStatusSchema,
  duration_ms: RefusedDurationSchema,
});

const SchemaRefusalSchema = Schema.Union([AskedAgainSchema, NotAskedAgainSchema]).annotate({
  description:
    'How the provider refused the request that gave it the JSON Schema of the answer, and whether the answer was asked for again with the schema in the instructions',
});

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
  output_mode: Schema.optionalKey(OutputModeSchema),
  repair: Schema.optionalKey(RepairSchema),
  schema_refusal: Schema.optionalKey(SchemaRefusalSchema),
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
  output_mode: Schema.optionalKey(OutputModeSchema),
  repair: Schema.optionalKey(RepairSchema),
  schema_refusal: Schema.optionalKey(SchemaRefusalSchema),
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
