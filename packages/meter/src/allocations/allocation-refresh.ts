import { Effect, Option } from 'effect';

import type { AccountRefusal } from '../accounts/account-failure.ts';
import { executed, meterStateOf, nowIso } from '../admission/metering.ts';
import type { Licensing } from '../licensing/licensing.ts';
import { allocationIn, type Signed } from '../licensing/signed-answers.ts';
import type { Allocation } from '../meter-stream/allocation-events.ts';
import { standingAllocation } from './allocation.ts';

interface Worded {
  readonly detail: string;
}

function recorded(licensing: Licensing, allocation: Allocation, signed: Signed): Effect.Effect<void, Worded> {
  return Option.match(
    Option.filter(
      allocationIn(signed, licensing.signers),
      ({ id, installation }) => id === allocation.id && installation === allocation.installation,
    ),
    {
      onNone: () => Effect.fail({ detail: 'the allocation it answered is not this one, signed by Auto' }),
      onSome: ({ id, refresh_by: refreshBy }) =>
        Effect.flatMap(nowIso, (at) =>
          executed(licensing, { type: 'refresh_allocation', id, refresh_by: refreshBy, allocation: signed, at }),
        ).pipe(Effect.asVoid),
    },
  );
}

function refused(
  licensing: Licensing,
  allocation: Allocation,
): (failure: AccountRefusal) => Effect.Effect<void, Worded> {
  return ({ status, kind, detail }) =>
    status === 409 && kind === 'license_invalid'
      ? Effect.flatMap(nowIso, (at) =>
          executed(licensing, { type: 'withdraw_allocation', id: allocation.id, detail, at }),
        ).pipe(Effect.asVoid)
      : Effect.fail({ detail });
}

export function allocationRefreshed(licensing: Licensing, key: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    const allocation = standingAllocation(yield* meterStateOf(licensing));
    if (allocation === undefined) return;
    yield* licensing.account.refreshAllocation(key, allocation.id).pipe(
      Effect.flatMap((signed) => recorded(licensing, allocation, signed)),
      Effect.catchTag('account_failure', refused(licensing, allocation)),
    );
  }).pipe(
    Effect.catch(({ detail }: Worded) =>
      Effect.logWarning(`This runtime could not refresh its allocation with Auto: ${detail}`),
    ),
  );
}
