import type { MeteredRun } from '@on.auto/definitions';
import {
  Conflict,
  Unavailable,
  type AccountClosedBecause,
  type ConflictKind,
  type RejectionBecause,
} from '@on.auto/operations';
import { Effect } from 'effect';

import { actionOf } from './metering.ts';

interface Refusal {
  readonly admitted: false;
  readonly detail: string;
  readonly resolve_at?: string;
}

interface CreditOrLicenseRefusal extends Refusal {
  readonly kind: Extract<ConflictKind, 'credits_exhausted' | 'license_invalid'>;
  readonly because?: RejectionBecause;
}

interface AccountClosedRefusal extends Refusal {
  readonly kind: Extract<ConflictKind, 'account_closed'>;
  readonly because: AccountClosedBecause;
}

type AuthorityRefusal = CreditOrLicenseRefusal | AccountClosedRefusal;

export type AuthorityAnswer = { readonly admitted: true } | AuthorityRefusal;

export interface AdmissionAuthority {
  readonly admit: (run: MeteredRun, action: string) => Promise<AuthorityAnswer>;
}

const authorityUnavailable = new Unavailable({
  detail:
    "The run could not start because the runtime could not contact Auto to check the account's credits. Try again shortly.",
  kind: 'meter_unavailable',
});

function refusalOf({ kind, detail, because, resolve_at: resolveAt }: AuthorityRefusal): Conflict {
  return new Conflict({
    detail,
    kind,
    ...(because === undefined ? {} : { because }),
    ...(resolveAt === undefined ? {} : { resolve_at: resolveAt }),
  });
}

export function admittedByTheAuthority(
  authority: AdmissionAuthority,
  run: MeteredRun,
): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.tryPromise({ try: () => authority.admit(run, actionOf(run)), catch: () => authorityUnavailable }).pipe(
    Effect.flatMap((answer) => (answer.admitted ? Effect.void : Effect.fail(refusalOf(answer)))),
  );
}
