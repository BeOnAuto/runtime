import type { Conflict, Unavailable } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { AccountRefusal } from '../accounts/account-failure.ts';
import { executed, meterStateOf, meterUnavailable, nowIso } from '../admission/metering.ts';
import type { LicenseRecord } from '../meter-stream/license-events.ts';
import type { MeterState } from '../meter-stream/meter-events.ts';
import { installationOfKey, keyDigestOf } from './license-key.ts';
import {
  accountClosed,
  activationUnavailable,
  invalidated,
  invalidityOf,
  licenseInvalid,
  licenseInvalidated,
  usageFrom,
  type Licensing,
} from './licensing.ts';
import { licenseIn, type License, type Signed } from './signed-answers.ts';

const notAKey = 'its key is not a license key of Studio, which reads alk.<org>.<runtime id>.<secret>';

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
          `its key is for the runtime ${named}, and this runtime is ${installation}`,
        ),
      );
}

function closedBecause({ because }: AccountRefusal): 'org_deleted' | 'org_purged' {
  return because === 'org_purged' ? 'org_purged' : 'org_deleted';
}

export function refusalRecorded(licensing: Licensing, key: string, failure: AccountRefusal): Effect.Effect<boolean> {
  if (failure.kind === 'account_closed') {
    return Effect.as(invalidated(licensing, key, { detail: failure.detail, because: closedBecause(failure) }), true);
  }
  if (failure.kind === 'license_invalid') return Effect.as(invalidated(licensing, key, invalidityOf(failure)), true);
  return Effect.succeed(false);
}

function refused(
  licensing: Licensing,
  key: string,
  installation: string,
): (failure: AccountRefusal) => Effect.Effect<never, Conflict | Unavailable> {
  return (failure) =>
    Effect.flatMap(
      refusalRecorded(licensing, key, failure),
      (recorded): Effect.Effect<never, Conflict | Unavailable> => {
        if (!recorded) return Effect.fail(activationUnavailable);
        return Effect.fail(
          failure.kind === 'account_closed'
            ? accountClosed(failure)
            : licenseInvalidated(licensing.options, installation, invalidityOf(failure)),
        );
      },
    );
}

export function licenseFrom(
  licensing: Licensing,
  signed: Signed,
  installation: string,
): Effect.Effect<License, Conflict> {
  const invalid = (why: string) => Effect.fail(licenseInvalid(licensing.options, installation, why));
  const license = Option.getOrUndefined(licenseIn(signed, licensing.signers));
  if (license === undefined) return invalid('its license is not one Auto signed');
  if (license.installation !== installation) return invalid(`its license is for the runtime ${license.installation}`);
  return Effect.succeed(license);
}

export function recordOf(license: License, signed: Signed, key: string, licensedReported: number): LicenseRecord {
  const { v: _version, kind: _kind, org_name: orgName, ...fields } = license;
  return {
    ...fields,
    ...(orgName === null ? {} : { org_name: orgName }),
    licensed_reported: licensedReported,
    key_sha256: keyDigestOf(key),
    license: signed,
  };
}

export function activated(licensing: Licensing, key: string): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const state = yield* meterStateOf(licensing);
    const installation = yield* installationFor(licensing, key, state);
    const usage = usageFrom(state);
    const signed = yield* licensing.account
      .activate(key, { installation, ...usage })
      .pipe(Effect.catch(refused(licensing, key, installation)));
    const license = yield* licenseFrom(licensing, signed, installation);
    yield* executed(licensing, {
      type: 'license',
      license: recordOf(license, signed, key, usage.licensed),
      at: yield* nowIso,
    }).pipe(Effect.mapError(() => meterUnavailable));
    yield* licensing.keyHeld(key);
  });
}
