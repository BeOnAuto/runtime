import type {
  AnsweredOnce,
  CalledOnce,
  NotOfferedBecause,
  RequestedOnce,
  SentCallFailedBecause,
  ServerFailedBecause,
  UnopenedOnce,
} from '@on.auto/tool-servers';
import { Data, Record as Records, Schema } from 'effect';

export type SubscriptionFailedBecause =
  | NotOfferedBecause
  | ServerFailedBecause
  | Exclude<UnopenedOnce['refused'], 'tool_not_offered' | 'tool_server_failed'>
  | 'tool_error'
  | SentCallFailedBecause
  | 'unreadable'
  | 'not_found'
  | 'not_sent';

export const SubscriptionFailureKindSchema = Schema.Literals([
  'connection_broken',
  'scope_lacking',
  'tool_error',
  'unreachable',
  'not_sent',
]);

export type SubscriptionFailureKind = typeof SubscriptionFailureKindSchema.Type;

export class SubscriptionCallFailed extends Data.TaggedError('subscription_call_failed')<{
  readonly kind: SubscriptionFailureKind;
  readonly because: SubscriptionFailedBecause;
}> {}

const kindOfEach: Readonly<Record<SubscriptionFailedBecause, SubscriptionFailureKind>> = {
  connection_pending: 'connection_broken',
  connection_broken: 'connection_broken',
  key_refused: 'connection_broken',
  tool_server_not_configured: 'connection_broken',
  scope_lacking: 'scope_lacking',
  tool_not_allowed: 'scope_lacking',
  connection_not_allowed: 'scope_lacking',
  tool_error: 'tool_error',
  arguments_refused: 'tool_error',
  tool_not_listed: 'tool_error',
  tool_not_read_only: 'tool_error',
  asset_not_sent: 'tool_error',
  too_large: 'tool_error',
  unreadable: 'tool_error',
  not_found: 'tool_error',
  unreachable: 'unreachable',
  failing: 'unreachable',
  rate_limited: 'unreachable',
  timed_out: 'unreachable',
  cancelled: 'unreachable',
  server_failure: 'unreachable',
  connection_unavailable: 'unreachable',
  not_sent: 'not_sent',
};

export const SubscriptionFailedBecauseSchema = Schema.Literals(Records.keys(kindOfEach));

export function failedBecause(because: SubscriptionFailedBecause): SubscriptionCallFailed {
  return new SubscriptionCallFailed({ kind: kindOfEach[because], because });
}

type Refused = Exclude<CalledOnce, { readonly outcome: 'result' }>;

function unopenedBecause(called: UnopenedOnce): SubscriptionFailedBecause {
  return called.refused === 'tool_not_offered' || called.refused === 'tool_server_failed'
    ? called.because
    : called.refused;
}

function answeredBecause(called: Exclude<AnsweredOnce, { readonly outcome: 'result' }>): SubscriptionFailedBecause {
  return called.outcome === 'tool_error' ? called.outcome : (called.because ?? called.outcome);
}

export function refusedAs(called: Refused): SubscriptionCallFailed {
  return failedBecause(called.kind === 'unopened' ? unopenedBecause(called) : answeredBecause(called));
}

type RequestRefused = Exclude<RequestedOnce, { readonly outcome: 'result' }>;

function requestedBecause(requested: RequestRefused): SubscriptionFailedBecause {
  return requested.kind === 'unopened' || requested.outcome === 'server_failure'
    ? requested.because
    : requested.outcome;
}

export function requestRefusedAs(requested: RequestRefused): SubscriptionCallFailed {
  return failedBecause(requestedBecause(requested));
}
