import type { MeteredRun } from '@on.auto/definitions';
import { Conflict, type RejectionBecause, type Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Counting } from '../counting/run-starts.ts';
import { accountUnavailable } from '../licensing/licensing.ts';
import { repairedBy } from '../licensing/repairs.ts';
import type { Signed, Signers } from '../licensing/signed-answers.ts';
import type { Fault } from '../meter-stream/meter-events.ts';
import { actionOf, checkpointed, type Metering } from './metering.ts';

interface AuthorityRefusal {
  readonly admitted: false;
  readonly kind: 'credits_exhausted' | 'license_invalid';
  readonly detail: string;
  readonly because?: RejectionBecause;
  readonly resolve_at?: string;
}

export type AuthorityAnswer = { readonly admitted: true } | AuthorityRefusal;

function refusalOf({ kind, detail, because, resolve_at: resolveAt }: AuthorityRefusal): Conflict {
  return new Conflict({
    detail,
    kind,
    ...(because === undefined ? {} : { because }),
    ...(resolveAt === undefined ? {} : { resolve_at: resolveAt }),
  });
}

export interface AdmissionAuthority {
  readonly installation: string;
  readonly admit: (run: MeteredRun, action: string) => Promise<AuthorityAnswer>;
  readonly repairFor: (fault: Fault) => Promise<Signed | null>;
}

export function admittedByTheAuthority(
  metering: Metering,
  authority: AdmissionAuthority,
  run: MeteredRun,
  counting: Counting,
): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.tryPromise({ try: () => authority.admit(run, actionOf(run)), catch: () => accountUnavailable }).pipe(
    Effect.flatMap((answer) => (answer.admitted ? checkpointed(metering, counting) : Effect.fail(refusalOf(answer)))),
  );
}

export function repairTakenFrom(
  metering: Metering,
  authority: AdmissionAuthority,
  signers: Signers,
): (fault: Fault) => Effect.Effect<void> {
  return (fault) =>
    Effect.tryPromise(() => authority.repairFor(fault)).pipe(
      Effect.flatMap((signed) => repairedBy({ ...metering, signers }, signed, authority.installation)),
      Effect.ignore,
    );
}
