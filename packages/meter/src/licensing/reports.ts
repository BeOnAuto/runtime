import { Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { AccountRefusal } from '../accounts/account-failure.ts';
import {
  caughtUp,
  checkpointed,
  executed,
  meterStateOf,
  meterUnavailable,
  nowIso,
  verified,
} from '../admission/metering.ts';
import type { Counting } from '../counting/run-starts.ts';
import type { MeterState, Report } from '../meter-stream/meter-events.ts';
import { invalidated, standsFor, usageFrom, type Licensing } from './licensing.ts';

const reportUnavailable = new Unavailable({
  detail: 'This runtime could not report its actions to its account at Auto; it reports them again shortly',
  kind: 'meter_unavailable',
});

function refused(licensing: Licensing, key: string): (failure: AccountRefusal) => Effect.Effect<boolean, Unavailable> {
  return (failure) =>
    failure.kind === 'license_invalid'
      ? Effect.as(invalidated(licensing, key, failure.detail), false)
      : Effect.fail(reportUnavailable);
}

function sent(licensing: Licensing, key: string, report: Report): Effect.Effect<void, Unavailable> {
  return Effect.gen(function* () {
    const taken = yield* licensing.account
      .report(key, report)
      .pipe(Effect.as(true), Effect.catch(refused(licensing, key)));
    if (!taken) return;
    yield* executed(licensing, { type: 'report', report, at: yield* nowIso }).pipe(
      Effect.mapError(() => meterUnavailable),
    );
  });
}

function verifiedCount(licensing: Licensing, state: MeterState): Effect.Effect<Counting | undefined, Unavailable> {
  return Effect.flatMap(caughtUp(licensing, state), (counting) => verified(licensing, counting)).pipe(
    Effect.catchTag('conflict', () => Effect.undefined),
  );
}

export function reported(licensing: Licensing): Effect.Effect<void, Unavailable> {
  return Effect.gen(function* () {
    const key = yield* licensing.keyInHand;
    if (key === undefined) return;
    const state = yield* meterStateOf(licensing);
    if (!standsFor(state, key) || state.fault !== undefined) return;
    const counting = yield* verifiedCount(licensing, state);
    if (counting === undefined) return;
    yield* checkpointed(licensing, counting);
    yield* sent(licensing, key, usageFrom(counting));
  });
}
