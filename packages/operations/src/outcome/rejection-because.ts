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
  'scope_lacking',
  'server_failed',
  'tool_error',
  'model_unavailable',
  'definition_refused',
  'run_bound',
  'no_answer',
  'restarted_without_content',
  'call_outcome_unknown',
  'only_read',
  'builds_of_the_day',
  'stalled',
  'not_finite',
  'not_in_order',
  'baseline_check',
  'no_model_runtime',
  'none_left',
  'free_daily_limit',
  'free_month_used',
  'key_rotated',
  'installation_revoked',
  'org_deleted',
  'org_purged',
]);

export type RejectionBecause = typeof RejectionBecauseSchema.Type;

export const CreditsExhaustedBecauseSchema = RejectionBecauseSchema.pick([
  'none_left',
  'free_daily_limit',
  'free_month_used',
]);

export type CreditsExhaustedBecause = typeof CreditsExhaustedBecauseSchema.Type;

export const AccountClosedBecauseSchema = RejectionBecauseSchema.pick(['org_deleted', 'org_purged']);

export type AccountClosedBecause = typeof AccountClosedBecauseSchema.Type;

export const LimitedBecauseSchema = Schema.Literals([
  'credits',
  'cap',
  'out_of_touch',
  'key_rotated',
  'key_revoked',
  'org_closed',
  'not_activated',
]);

export type LimitedBecause = typeof LimitedBecauseSchema.Type;
