import type { MeteredRun } from '@on.auto/definitions';
import { Conflict, type Unavailable } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { AccountRefusal } from '../accounts/account-failure.ts';
import { actionOf, checkpointed, meterStateOf } from '../admission/metering.ts';
import type { Counting } from '../counting/run-starts.ts';
import { standingFor } from './activation.ts';
import { accountUnavailable, invalidated, licenseInvalid, type Licensing } from './licensing.ts';
import { admissionIn } from './signed-answers.ts';

interface Asking {
  readonly key: string;
  readonly run: MeteredRun;
  readonly counting: Counting;
}

function refused(
  licensing: Licensing,
  key: string,
  installation: string,
): (failure: AccountRefusal) => Effect.Effect<never, Conflict | Unavailable> {
  return (failure) => {
    if (failure.kind === 'credits_exhausted') {
      return Effect.fail(new Conflict({ detail: failure.detail, kind: 'credits_exhausted' }));
    }
    if (failure.kind === 'license_invalid') {
      return Effect.andThen(
        invalidated(licensing, key, failure.detail),
        Effect.fail(licenseInvalid(licensing.options, installation, failure.detail)),
      );
    }
    return Effect.fail(accountUnavailable);
  };
}

export function admittedByTheAccount(
  licensing: Licensing,
  { key, run, counting }: Asking,
): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const license = yield* standingFor(licensing, key, yield* meterStateOf(licensing));
    const signed = yield* licensing.account
      .admit(key, run)
      .pipe(Effect.catch(refused(licensing, key, license.installation)));
    const action = `installation:${license.installation}/${actionOf(run)}`;
    const admitted = Option.filter(
      admissionIn(signed, licensing.signers),
      (admission) => admission.installation === license.installation && admission.action === action,
    );
    if (Option.isNone(admitted)) return yield* accountUnavailable;
    return yield* checkpointed(licensing, counting);
  });
}
