import { randomUUIDv7, type Unavailable } from '@on.auto/operations';
import { Effect, Function, Option } from 'effect';

import { executed, meterStateOf, meterUnavailable, nowIso } from '../admission/metering.ts';
import { installationOfKey, keyDigestOf } from '../licensing/license-key.ts';
import type { KeyInHand, Licensing } from '../licensing/licensing.ts';
import type { MeterState } from '../meter-stream/meter-events.ts';
import { statusOf, type LicenseStatus } from './status-document.ts';

function identified(licensing: Licensing, state: MeterState, inForce: KeyInHand | undefined) {
  return Effect.gen(function* () {
    const known = state.installation ?? (inForce === undefined ? undefined : installationOfKey(inForce.key));
    if (known !== undefined) return known;
    const fresh = randomUUIDv7();
    const after = yield* executed(licensing, { type: 'identify', installation: fresh, at: yield* nowIso }).pipe(
      Effect.mapError(() => meterUnavailable),
    );
    return Option.getOrElse(Option.fromNullishOr(after.installation), Function.constant(fresh));
  });
}

export function licenseStatusOf(licensing: Licensing): Effect.Effect<LicenseStatus, Unavailable> {
  return Effect.gen(function* () {
    const inForce = yield* licensing.keyInForce;
    const state = yield* meterStateOf(licensing);
    return statusOf({
      options: licensing.options,
      installation: yield* identified(licensing, state, inForce),
      state,
      key_sha256: inForce === undefined ? undefined : keyDigestOf(inForce.key),
      key_source: inForce?.source ?? null,
      at: yield* nowIso,
    });
  }).pipe(Effect.catchDefect(() => Effect.fail(meterUnavailable)));
}
