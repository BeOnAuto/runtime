import type { MeteredRun } from '@on.auto/definitions';
import { Conflict, type Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Counting } from '../counting/run-starts.ts';
import { accountUnavailable } from '../licensing/licensing.ts';
import { actionOf, checkpointed, type Metering } from './metering.ts';

export type AuthorityAnswer =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly kind: 'credits_exhausted' | 'license_invalid'; readonly detail: string };

export interface AdmissionAuthority {
  readonly admit: (run: MeteredRun, action: string) => Promise<AuthorityAnswer>;
}

export function admittedByTheAuthority(
  metering: Metering,
  authority: AdmissionAuthority,
  run: MeteredRun,
  counting: Counting,
): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.tryPromise({ try: () => authority.admit(run, actionOf(run)), catch: () => accountUnavailable }).pipe(
    Effect.flatMap((answer) =>
      answer.admitted
        ? checkpointed(metering, counting)
        : Effect.fail(new Conflict({ detail: answer.detail, kind: answer.kind })),
    ),
  );
}
