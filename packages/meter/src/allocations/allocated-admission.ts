import type { MeteredRun } from '@on.auto/definitions';
import { Conflict, type Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import { admittedWithin } from '../admission/allowance.ts';
import { licensesPageOf } from '../admission/metering.ts';
import type { Counting } from '../counting/run-starts.ts';
import { isLiveAt, nowMs, offlineCreditsStopped, type Licensing } from '../licensing/licensing.ts';
import type { Allocation } from '../meter-stream/allocation-events.ts';

export function admittedByTheAllocation(
  licensing: Licensing,
  run: MeteredRun,
  counting: Counting,
  allocation: Allocation,
): Effect.Effect<void, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const { installation, credits, refresh_by: refreshBy } = allocation;
    if (!isLiveAt(refreshBy, yield* nowMs)) {
      return yield* offlineCreditsStopped(licensing.options, installation, refreshBy);
    }
    const page = licensesPageOf(licensing.options, installation);
    return yield* admittedWithin(licensing, run, counting, {
      allowance: allocation.actions + credits,
      kind: 'credits_exhausted',
      refusal: () =>
        new Conflict({
          detail: `This runtime has used all ${credits} offline credits. An owner can request more at ${page}.`,
          kind: 'credits_exhausted',
          because: 'none_left',
          resolve_at: page,
          runtime_id: installation,
        }),
    });
  });
}
