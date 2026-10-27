import { Data } from 'effect';

export interface AccountRefusal {
  readonly status: number;
  readonly kind: string;
  readonly detail: string;
}

export class AccountFailure extends Data.TaggedError('account_failure')<AccountRefusal> {}

export function unreachable(detail: string): AccountFailure {
  return new AccountFailure({ status: 0, kind: 'unreachable', detail });
}
