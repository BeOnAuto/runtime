import { Schema } from 'effect';

export const RejectionBecauseSchema = Schema.Literals([
  'provider_not_configured',
  'model_not_allowed',
  'tool_server_not_configured',
  'tool_not_allowed',
  'tool_not_listed',
  'connection_pending',
  'connection_broken',
  'connection_not_allowed',
  'connection_unavailable',
  'failing',
  'rate_limited',
  'unreachable',
  'key_refused',
  'server_failed',
  'tool_error',
  'model_unavailable',
  'run_bound',
  'no_answer',
  'only_read',
  'builds_of_the_day',
  'stalled',
  'not_finite',
  'not_in_order',
  'baseline_check',
]);

export type RejectionBecause = typeof RejectionBecauseSchema.Type;
