import { Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { AccountRefusal } from '../accounts/account-failure.ts';
import { executed, meterStateOf, meterUnavailable, nowIso } from '../admission/metering.ts';
import { footingOf } from '../meter-stream/local-admission.ts';
import { activated, licenseFrom, recordOf, refusalRecorded } from './activation.ts';
import { keyDigestOf } from './license-key.ts';
import { nowMs, usageFrom, type Licensing } from './licensing.ts';
import type { Signed } from './signed-answers.ts';

const reportUnavailable = new Unavailable({
  detail: 'The runtime could not report its runs to Auto. It will try again shortly.',
  kind: 'meter_unavailable',
});

const notAutosLicense = new Unavailable({
  detail:
    "The answer to the runtime's report wasn't a license Auto signed for it, so the runtime kept its last license.",
  kind: 'meter_unavailable',
});

function refused(
  licensing: Licensing,
  key: string,
): (failure: AccountRefusal) => Effect.Effect<undefined, Unavailable> {
  return (failure) =>
    Effect.flatMap(refusalRecorded(licensing, key, failure), (recorded) =>
      recorded ? Effect.undefined : Effect.fail(reportUnavailable),
    );
}

function activatedAsReport(licensing: Licensing, key: string): Effect.Effect<void, Unavailable> {
  return activated(licensing, key).pipe(
    Effect.catchTag('conflict', (refusal: Readonly<{ detail: string }>) =>
      Effect.logWarning(`This runtime could not activate its key with Auto: ${refusal.detail}`),
    ),
  );
}

function sent(licensing: Licensing, key: string, installation: string): Effect.Effect<void, Unavailable> {
  return Effect.gen(function* () {
    const usage = usageFrom(yield* meterStateOf(licensing));
    const signed: Signed | undefined = yield* licensing.account
      .report(key, usage)
      .pipe(Effect.catch(refused(licensing, key)));
    if (signed === undefined) return;
    const license = yield* licenseFrom(licensing, signed, installation).pipe(Effect.mapError(() => notAutosLicense));
    yield* executed(licensing, {
      type: 'report',
      report: usage,
      license: recordOf(license, signed, key, usage.licensed),
      at: yield* nowIso,
    }).pipe(Effect.mapError(() => meterUnavailable));
  });
}

function reportedWith(licensing: Licensing, key: string): Effect.Effect<void, Unavailable> {
  return Effect.flatMap(meterStateOf(licensing), ({ license }) =>
    license?.key_sha256 === keyDigestOf(key)
      ? sent(licensing, key, license.installation)
      : activatedAsReport(licensing, key),
  );
}

export function reported(licensing: Licensing): Effect.Effect<void, Unavailable> {
  return Effect.flatMap(licensing.keyInHand, (key) => (key === undefined ? Effect.void : reportedWith(licensing, key)));
}

export function reportDue(licensing: Licensing): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const key = yield* licensing.keyInHand;
    if (key === undefined) return false;
    const state = yield* meterStateOf(licensing);
    const at = new Date(yield* nowMs).toISOString();
    const footing = footingOf(state, keyDigestOf(key), at);
    if (footing.kind !== 'licensed') return false;
    const { admits_through: through, licensed_reported: reportedThen } = footing.license;
    const remainder = through - reportedThen;
    return remainder > 0 && (state.admitted.licensed - reportedThen) * 2 >= remainder;
  });
}
