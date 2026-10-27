import type { MeteredRun } from '@on.auto/definitions';
import type { Conflict, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import { admittedByTheAllowance } from '../admission/allowance.ts';
import { meterStateOf } from '../admission/metering.ts';
import { admittedByTheAllocation } from '../allocations/allocated-admission.ts';
import { standingAllocation } from '../allocations/allocation.ts';
import type { Counting } from '../counting/run-starts.ts';
import { admittedByTheAccount } from './licensed-admission.ts';
import type { Licensing } from './licensing.ts';

export function admittedSelfHosted(
  licensing: Licensing,
  run: MeteredRun,
  counting: Counting,
): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const allocation = standingAllocation(yield* meterStateOf(licensing));
    if (allocation !== undefined) return yield* admittedByTheAllocation(licensing, run, counting, allocation);
    const key = yield* licensing.keyInHand;
    if (key === undefined) return yield* admittedByTheAllowance(licensing, run, counting);
    return yield* admittedByTheAccount(licensing, { key, run, counting });
  });
}
