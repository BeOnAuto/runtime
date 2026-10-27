import type { MeteredRun } from '@on.auto/definitions';
import type { Conflict, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import { admittedWithin } from '../admission/allowance.ts';
import type { Counting } from '../counting/run-starts.ts';
import { isLiveAt, licenseInvalid, nowMs, type Licensing } from '../licensing/licensing.ts';
import type { Allocation } from '../meter-stream/allocation-events.ts';

export function admittedByTheAllocation(
  licensing: Licensing,
  run: MeteredRun,
  counting: Counting,
  allocation: Allocation,
): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const { id, installation, credits, refresh_by: refreshBy } = allocation;
    if (!isLiveAt(refreshBy, yield* nowMs)) {
      return yield* licenseInvalid(
        licensing.options,
        installation,
        `its allocation ${id} was to be refreshed with Auto by ${refreshBy}; reach Auto to refresh it, or give the runtime the allocation an operator signs again`,
      );
    }
    return yield* admittedWithin(licensing, run, counting, {
      allowance: allocation.actions + credits,
      kind: 'credits_exhausted',
      refusal: () =>
        `This runtime has spent the ${credits} credits of its allocation ${id}; an owner of its org asks Auto for another`,
    });
  });
}
