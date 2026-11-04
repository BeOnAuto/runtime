import type { MeteredRun } from '@on.auto/definitions';
import { randomUUIDv7, type Conflict, type Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import { admittedWithin } from '../admission/allowance.ts';
import { meterStateOf } from '../admission/metering.ts';
import { admittedByTheAllocation } from '../allocations/allocated-admission.ts';
import { standingAllocation } from '../allocations/allocation.ts';
import { freeRateRefusalOf } from '../standing/free-rate-refusals.ts';
import { installationOfKey, keyDigestOf } from './license-key.ts';
import type { Licensing } from './licensing.ts';

export function admittedSelfHosted(licensing: Licensing, run: MeteredRun): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const allocation = standingAllocation(yield* meterStateOf(licensing));
    if (allocation !== undefined) return yield* admittedByTheAllocation(licensing, run, allocation);
    const key = yield* licensing.keyInHand;
    const { options } = licensing;
    return yield* admittedWithin(licensing, run, {
      installation: (key === undefined ? undefined : installationOfKey(key)) ?? randomUUIDv7(),
      rule: {
        kind: 'local',
        key_sha256: key === undefined ? undefined : keyDigestOf(key),
        allowance: options.allowance,
        free_rate: options.freeRate,
        refusal: freeRateRefusalOf(options),
      },
    });
  });
}
