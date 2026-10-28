import type { Conflict, Unavailable } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { AccountRefusal } from '../accounts/account-failure.ts';
import type { Usage } from '../accounts/account-service.ts';
import { caughtUp, checkpointed, executed, meterStateOf, meterUnavailable, nowIso } from '../admission/metering.ts';
import type { License, MeterState } from '../meter-stream/meter-events.ts';
import { installationOfKey, keyDigestOf } from './license-key.ts';
import {
  activationUnavailable,
  invalidated,
  invalidityOf,
  isLiveAt,
  licenseInvalid,
  licenseInvalidated,
  licenseNotRenewed,
  nowMs,
  refusedAsAnswered,
  termsRequired,
  usageFrom,
  type Licensing,
} from './licensing.ts';
import { repairedBy } from './repairs.ts';
import { entitlementIn, type Entitlement, type Signed } from './signed-answers.ts';

const notAKey = 'its key is not a license key of Studio, which reads alk.<org>.<installation>.<secret>';

function installationFor(licensing: Licensing, key: string, state: MeterState): Effect.Effect<string, Conflict> {
  const named = installationOfKey(key);
  if (named === undefined) {
    return Effect.fail(licenseInvalid(licensing.options, state.installation, notAKey));
  }
  const installation = state.installation ?? named;
  return named === installation
    ? Effect.succeed(installation)
    : Effect.fail(
        licenseInvalid(
          licensing.options,
          installation,
          `its key registers the installation ${named}, and this runtime is the installation ${installation}`,
        ),
      );
}

export function usageOf(licensing: Licensing, state: MeterState): Effect.Effect<Usage> {
  const kept = usageFrom(state.checkpoint);
  return state.fault === undefined
    ? caughtUp(licensing, state).pipe(
        Effect.tap((counting) => checkpointed(licensing, counting)),
        Effect.map(usageFrom),
        Effect.orElseSucceed(() => kept),
      )
    : Effect.succeed(kept);
}

function refused(
  licensing: Licensing,
  key: string,
  installation: string,
): (failure: AccountRefusal) => Effect.Effect<never, Conflict | Unavailable> {
  return (failure) => {
    if (failure.kind === 'account_closed') return Effect.fail(refusedAsAnswered('account_closed', failure));
    if (failure.kind === 'terms_required') return Effect.fail(termsRequired(licensing.options, installation, failure));
    if (failure.kind !== 'license_invalid') return Effect.fail(activationUnavailable);
    const invalidity = invalidityOf(failure);
    return Effect.andThen(
      invalidated(licensing, key, invalidity),
      Effect.fail(licenseInvalidated(licensing.options, installation, invalidity)),
    );
  };
}

function entitlementFrom(
  licensing: Licensing,
  signed: Signed,
  installation: string,
): Effect.Effect<Entitlement, Conflict> {
  return Effect.gen(function* () {
    const invalid = (why: string) => licenseInvalid(licensing.options, installation, why);
    const entitlement = Option.getOrUndefined(entitlementIn(signed, licensing.signers));
    if (entitlement === undefined) return yield* invalid('its entitlement is not signed by Auto');
    if (entitlement.installation !== installation) {
      return yield* invalid(`its entitlement is for the installation ${entitlement.installation}`);
    }
    if (!isLiveAt(entitlement.expires_at, yield* nowMs)) {
      return yield* invalid(`its entitlement expired at ${entitlement.expires_at}`);
    }
    return entitlement;
  });
}

export function activated(licensing: Licensing, key: string): Effect.Effect<License, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const state = yield* meterStateOf(licensing);
    const installation = yield* installationFor(licensing, key, state);
    const usage = yield* usageOf(licensing, state);
    const answer = yield* licensing.account
      .activate(key, { installation, ...usage })
      .pipe(Effect.catch(refused(licensing, key, installation)));
    const {
      org,
      org_name: orgName,
      plan,
      issued_at: issuedAt,
      expires_at: expiresAt,
    } = yield* entitlementFrom(licensing, answer.entitlement, installation);
    const sha256 = keyDigestOf(key);
    const license = {
      installation,
      org,
      ...(orgName === null ? {} : { org_name: orgName }),
      plan,
      issued_at: issuedAt,
      expires_at: expiresAt,
      key_sha256: sha256,
    };
    yield* executed(licensing, {
      type: 'license',
      license: { ...license, entitlement: answer.entitlement },
      at: yield* nowIso,
    }).pipe(Effect.mapError(() => meterUnavailable));
    yield* repairedBy(licensing, answer.repair, installation);
    yield* licensing.keyHeld(key);
    return {
      installation,
      org,
      org_name: orgName,
      plan,
      issued_at: issuedAt,
      expires_at: expiresAt,
      key_sha256: sha256,
      invalid: undefined,
    };
  });
}

export function standingFor(
  licensing: Licensing,
  key: string,
  { license }: MeterState,
): Effect.Effect<License, Conflict | Unavailable> {
  if (license === undefined || license.key_sha256 !== keyDigestOf(key)) {
    return activated(licensing, key);
  }
  if (license.invalid !== undefined) {
    return Effect.fail(licenseInvalidated(licensing.options, license.installation, license.invalid));
  }
  return Effect.flatMap(nowMs, (now) =>
    isLiveAt(license.expires_at, now)
      ? Effect.succeed(license)
      : activated(licensing, key).pipe(
          Effect.catchTag('unavailable', () =>
            Effect.fail(licenseNotRenewed(licensing.options, license.installation, license.expires_at)),
          ),
        ),
  );
}
