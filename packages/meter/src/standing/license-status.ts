import { randomUUIDv7, type Unavailable } from '@on.auto/operations';
import { Effect, Function, Option } from 'effect';

import { executed, meterStateOf, meterUnavailable, nowIso } from '../admission/metering.ts';
import { installationOfKey, keyDigestOf } from '../licensing/license-key.ts';
import type { KeyInHand, Licensing } from '../licensing/licensing.ts';
import type { MeterState } from '../meter-stream/meter-events.ts';
import { featuresInForceOf } from './features-in-force.ts';
import { statusOf, type LicenseStatus } from './status-document.ts';

export interface LicenseReading {
  readonly inForce: KeyInHand | undefined;
  readonly state: MeterState;
  readonly features: readonly string[];
  readonly at: string;
}

export function knownInstallationOf({ inForce, state }: Pick<LicenseReading, 'inForce' | 'state'>): string | undefined {
  return state.installation ?? (inForce === undefined ? undefined : installationOfKey(inForce.key));
}

export function readLicense<A>(
  licensing: Licensing,
  read: (reading: LicenseReading) => Effect.Effect<A, Unavailable>,
): Effect.Effect<A, Unavailable> {
  return Effect.gen(function* () {
    const inForce = yield* licensing.keyInForce;
    const state = yield* meterStateOf(licensing);
    const at = yield* nowIso;
    const sha256 = inForce === undefined ? undefined : keyDigestOf(inForce.key);
    return yield* read({ inForce, state, features: featuresInForceOf(state, sha256, at), at });
  }).pipe(Effect.catchDefect(() => Effect.fail(meterUnavailable)));
}

function identified(licensing: Licensing, reading: LicenseReading) {
  return Effect.gen(function* () {
    const known = knownInstallationOf(reading);
    if (known !== undefined) return known;
    const fresh = randomUUIDv7();
    const after = yield* executed(licensing, { type: 'identify', installation: fresh, at: yield* nowIso }).pipe(
      Effect.mapError(() => meterUnavailable),
    );
    return Option.getOrElse(Option.fromNullishOr(after.installation), Function.constant(fresh));
  });
}

export function licenseStatusOf(licensing: Licensing): Effect.Effect<LicenseStatus, Unavailable> {
  return readLicense(licensing, (reading) =>
    Effect.map(identified(licensing, reading), (installation) => {
      const { inForce, state, features, at } = reading;
      return statusOf({
        options: licensing.options,
        installation,
        state,
        key_sha256: inForce === undefined ? undefined : keyDigestOf(inForce.key),
        key_source: inForce?.source ?? null,
        features,
        at,
      });
    }),
  );
}
