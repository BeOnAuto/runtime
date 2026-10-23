import { Schema } from 'effect';

const JsonRpcIdSchema = Schema.NullOr(Schema.Union([Schema.String, Schema.Int])).annotate({
  description: 'The JSON-RPC id of the request to an MCP server; null for an HTTP API, whose requests have none',
});

export const CallSentSchema = Schema.Struct({
  server: Schema.String,
  connection_id: Schema.optionalKey(
    Schema.String.annotate({
      description: 'The id of the connection the call went through, where its tool server is one a person added',
    }),
  ),
  tool: Schema.String,
  arguments_bytes: Schema.Int,
  arguments_sha256: Schema.optionalKey(Schema.String),
  read_only: Schema.optionalKey(Schema.Literal(true)),
});

export const CallStartedSchema = Schema.Struct({ call_id: Schema.String, ...CallSentSchema.fields });

export const CallAnsweredSchema = Schema.Struct({
  is_error: Schema.Boolean,
  result_bytes: Schema.Int,
  result_sha256: Schema.optionalKey(Schema.String),
  shown_bytes: Schema.optionalKey(Schema.Int),
  duration_ms: Schema.Int,
  jsonrpc_id: JsonRpcIdSchema,
  server_request_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const sentCallFailures = ['arguments_refused', 'server_failure', 'timed_out', 'cancelled', 'too_large'] as const;

export const CallFailedBecauseSchema = Schema.Literals([...sentCallFailures, 'interrupted']);

export const CallFailedSchema = Schema.Struct({
  because: CallFailedBecauseSchema,
  detail: Schema.optionalKey(Schema.String),
  duration_ms: Schema.Int,
  jsonrpc_id: JsonRpcIdSchema,
  server_request_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  rate_limited: Schema.optionalKey(
    Schema.Literal(true).annotate({
      description: 'The server asked the run to slow down for longer than a call waits',
    }),
  ),
});

export type CallSent = typeof CallSentSchema.Type;

export type CallStarted = typeof CallStartedSchema.Type;

export type CallAnswered = typeof CallAnsweredSchema.Type;

export type CallFailed = typeof CallFailedSchema.Type;

export type CallFailedBecause = typeof CallFailedBecauseSchema.Type;

export type SentCallFailedBecause = (typeof sentCallFailures)[number];

export type CallEnded =
  | { readonly type: 'tool_call_answered'; readonly data: CallAnswered }
  | { readonly type: 'tool_call_failed'; readonly data: CallFailed };
