import type { Conflict, Unavailable } from '@on.auto/operations';
import { Effect, Function, Option } from 'effect';

import { executed, meterStateOf, meterUnavailable, nowIso } from '../admission/metering.ts';
import { usageOf } from '../licensing/activation.ts';
import { isLiveAt, licenseInvalid, nowMs, type Licensing } from '../licensing/licensing.ts';
import { allocationIn, type AllocationPayload, type Signed } from '../licensing/signed-answers.ts';
import type { Allocation } from '../meter-stream/allocation-events.ts';
import type { MeterState } from '../meter-stream/meter-events.ts';

export interface AllocationStanding {
  readonly allocation: string;
  readonly installation: string;
  readonly credits: number;
  readonly spent: number;
  readonly refresh_by: string;
}

export function standingAllocation({ allocation }: MeterState): Allocation | undefined {
  return Option.getOrUndefined(
    Option.filter(Option.fromNullishOr(allocation), ({ withdrawn }) => withdrawn === undefined),
  );
}

function standingOf(allocation: Allocation, actions: number): AllocationStanding {
  const { id, installation, credits, refresh_by: refreshBy } = allocation;
  return {
    allocation: id,
    installation,
    credits,
    spent: Math.max(0, actions - allocation.actions),
    refresh_by: refreshBy,
  };
}

function allocationVerified(
  licensing: Licensing,
  signed: Signed,
  installation: string | undefined,
): Effect.Effect<AllocationPayload, Conflict> {
  return Effect.gen(function* () {
    const invalid = (why: string) => licenseInvalid(licensing.options, installation, why);
    const allocation = Option.getOrUndefined(allocationIn(signed, licensing.signers));
    if (allocation === undefined) return yield* invalid('its allocation is not signed by Auto');
    if (installation !== undefined && allocation.installation !== installation) {
      return yield* invalid(`its allocation is for the installation ${allocation.installation}`);
    }
    if (!isLiveAt(allocation.refresh_by, yield* nowMs)) {
      return yield* invalid(
        `its allocation ${allocation.id} was to be refreshed with Auto by ${allocation.refresh_by}`,
      );
    }
    return allocation;
  });
}

export function allocated(
  licensing: Licensing,
  signed: Signed,
): Effect.Effect<AllocationStanding, Conflict | Unavailable> {
  return Effect.gen(function* () {
    const state = yield* meterStateOf(licensing);
    const {
      id,
      installation,
      credits,
      issued_at: issuedAt,
      refresh_by: refreshBy,
    } = yield* allocationVerified(licensing, signed, state.installation);
    const { actions } = yield* usageOf(licensing, state);
    const record = { id, installation, credits, issued_at: issuedAt, refresh_by: refreshBy, actions };
    const after = yield* executed(licensing, {
      type: 'allocate',
      allocation: { ...record, allocation: signed },
      at: yield* nowIso,
    }).pipe(Effect.mapError(() => meterUnavailable));
    const recorded: Allocation = { ...record, sequence: 0, spent: 0, withdrawn: undefined };
    const standing = Option.getOrElse(Option.fromNullishOr(after.allocation), Function.constant(recorded));
    if (standing.withdrawn !== undefined) {
      return yield* licenseInvalid(
        licensing.options,
        installation,
        `its allocation ${id} was withdrawn: ${standing.withdrawn}`,
      );
    }
    return standingOf(standing, actions);
  });
}
